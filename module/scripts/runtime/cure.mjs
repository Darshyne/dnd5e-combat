/**
 * §16.47 : un sort qui fait cesser un état (`cures` : Restauration partielle — « un état parmi Aveuglé, Assourdi,
 * Paralysé ou Empoisonné »). L'interface choisit l'état (ui/cure.mjs) ; les effets qui le portent sont retirés — par le MJ
 * actif quand la cible n'appartient pas à l'auteur.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { splitPool } from "../core/pools.mjs";
import { askAllocation } from "../adapter/projectiles.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { budgetIssues, spendBudget } from "./neighbours.mjs";
import { log, loc, notice, viaOwnerOrGM } from "./shared.mjs";

export const CURE_QUERY = `${MODULE_ID}.cure`;

async function removeStatus(targetUuid, status) {
  const token = await fromUuid(targetUuid);
  const actor = token?.actor;
  if ( !actor ) return 0;
  const ids = actor.effects.filter(e => e.statuses?.has(status)).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

async function handleCure({ target, status, value=null }) {
  // §160 : « réduit d'un niveau l'Épuisement » (Restauration suprême).
  if ( status === "exhaustion-1" ) {
    const actor = (await fromUuid(target))?.actor;
    const level = Number(actor?.system?.attributes?.exhaustion) || 0;
    if ( actor && level ) await actor.update({ "system.attributes.exhaustion": level - 1 });
    return level ? 1 : 0;
  }
  // §160 : les actes sur la cible qui demandent le MJ (cible d'un autre) — PV, PV temporaires, malédictions.
  if ( status === "hp" ) { const actor = (await fromUuid(target))?.actor; if ( actor ) await actor.update({ "system.attributes.hp.value": value }); return 1; }
  if ( status === "temphp" ) {
    const actor = (await fromUuid(target))?.actor;
    if ( actor && (value > (Number(actor.system.attributes.hp.temp) || 0)) ) await actor.update({ "system.attributes.hp.temp": value });
    return 1;
  }
  if ( status === "curses" ) {
    const actor = (await fromUuid(target))?.actor;
    const ids = (actor?.effects ?? []).filter(e => value.includes(identifierOf(originItemOf(e) ?? {}).id)).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    return ids.length;
  }
  if ( status === "exhaustion" ) {
    const actor = (await fromUuid(target))?.actor;
    if ( actor ) await actor.update({ "system.attributes.exhaustion": 0 });
    return actor ? 1 : 0;
  }
  if ( status === "standReaction" ) return standWithReaction(target, value);
  return removeStatus(target, status);
}

/**
 * §401 : Mot de pouvoir guérisseur — « si la créature est À terre, elle peut utiliser sa Réaction pour se relever ». Chez le MJ actif :
 * la question va au joueur de la cible (sinon au MJ) ; oui, À terre tombe et la Réaction est dépensée (en combat). Rend 1 si elle se relève.
 */
async function standWithReaction(targetUuid, item) {
  const token = await fromUuid(targetUuid);
  const actor = token?.actor;
  if ( !actor?.statuses?.has("prone") ) return 0;
  if ( budgetIssues(actor, "reaction").includes("noReaction") ) { log(`${item}: ${actor.name} is Prone but has no Reaction left`); return 0; }
  const answer = await askChoice(actor, { actor: actor.uuid, item, prompt: loc("SeRelever.Question"), options: [
    { id: "stand", label: loc("SeRelever.Oui"), icon: "fa-solid fa-person-arrow-up-from-line" },
    { id: "stay", label: loc("SeRelever.Non"), icon: "fa-solid fa-xmark" }] });
  if ( answer?.id !== "stand" ) { log(`${item}: ${actor.name} stays Prone`); return 0; }
  await removeStatus(targetUuid, "prone");
  await spendBudget(actor, "reaction");
  notice(token, loc("SeRelever.Fait"), "reaction");
  log(`${item}: ${actor.name} stands up with their Reaction`);
  return 1;
}

/** Un acte sur la cible : ici si on la possède, sinon par le MJ actif. */
const onTarget = (target, status, value=null) =>
  viaOwnerOrGM(!!target.actor?.isOwner, CURE_QUERY, handleCure, { target: target.uuid, status, value }, { fallback: 0 });

/** Fait cesser `status` sur le token `target` (TokenDocument). Épuisement : un niveau de moins (§160, Restauration suprême). */
export async function cureStatus(target, status) {
  // Sans MJ actif pour une cible d'un autre, la requête ne rend rien : rien n'a cessé.
  const n = Number(await onTarget(target, (status === "exhaustion") ? "exhaustion-1" : status)) || 0;
  const label = game.i18n.localize(CONFIG.DND5E.conditionTypes[status]?.name ?? status);
  log(`${target.name}: ${label} ends (${n} effect(s))`);
  if ( n > 0 ) notice(target, label, "effectOff");
  return n;
}

/**
 * §296 : la réserve de l'activité (le jet de soin que dnd5e vient de lancer — son message `healing`, sinon la formule) répartie entre les
 * créatures choisies : en PV (`hp`), plafonnés à la moitié des PV maximum (`cap: "halfMax"` : Survivance) ou au maximum, ou en PV
 * temporaires (`temp` : Châtiment exaltant). Le jet de dnd5e n'est pas appliqué tel quel (adapter/usage.mjs, plan sans soin).
 */
async function sharePool(activity, pool, targets, results) {
  const usage = results?.message?.id ?? null;
  let total = 0;
  for ( let waited = 0; usage && !total && (waited < 4000); waited += 200 ) {
    const roll = game.messages.contents.findLast(m => (m.type === "healing") && (m._source.system?.origin === usage));
    total = (roll?.rolls ?? []).reduce((sum, r) => sum + (r.total ?? 0), 0);
    if ( !total ) await new Promise(resolve => setTimeout(resolve, 200));
  }
  if ( !total ) {
    const formula = pool.formula ?? activity.healing?.formula ?? "0";
    total = (await new Roll(formula, activity.getRollData?.() ?? {}).evaluate()).total ?? 0;
  }
  const caps = targets.map(t => {
    if ( pool.temp ) return Infinity;
    const hp = t.actor.system.attributes?.hp ?? {};
    const max = hp.effectiveMax ?? hp.max ?? 0;
    const ceiling = (pool.cap === "halfMax") ? Math.floor(max / 2) : max;
    return Math.max(0, ceiling - (hp.value ?? 0));
  });
  let shares = splitPool(total, caps.map(c => (Number.isFinite(c) ? c : total)));
  // §401 : « répartis comme vous le voulez » (`choose`) — l'auteur ajuste la répartition, plafonds tenus.
  if ( pool.choose && (targets.length > 1) ) shares = await chosenShares(activity, total, targets, shares, caps);
  for ( const [i, target] of targets.entries() ) {
    if ( !shares[i] ) continue;
    if ( pool.temp ) await onTarget(target, "temphp", shares[i]);
    else await onTarget(target, "hp", (target.actor.system.attributes.hp.value ?? 0) + shares[i]);
  }
  const detail = targets.map((t, i) => `${t.name} ${shares[i]}`).join(", ");
  log(`${activity.item.name}: pool of ${total} — ${detail}`);
  await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: activity.actor }),
    content: `<p>${foundry.utils.escapeHTML(loc("Choisir.Reserve", { item: activity.item.name, total, detail }))}</p>` });
}

/**
 * §401 : la répartition d'une réserve demandée à l'auteur (son joueur, sinon le MJ), préremplie avec `shares`. Rend les parts, chacune
 * plafonnée (`caps`) et leur somme au plus `total` ; sans réponse, `shares`.
 */
async function chosenShares(activity, total, targets, shares, caps) {
  const actor = activity.actor;
  const defaults = Object.fromEntries(targets.map((t, i) => [t.uuid, shares[i]]));
  const answer = await askAllocation(actor, { item: activity.item.name, count: total, defaults,
    text: loc("Choisir.Repartir", { total }), title: loc("Choisir.RepartirTitre", { item: activity.item.name }), targets: targets.map(t => ({ token: t.uuid, name: t.name })) });
  if ( !answer?.counts ) return shares;
  let left = total;
  return targets.map((t, i) => {
    const wanted = Math.max(0, Math.floor(Number(answer.counts[t.uuid]) || 0));
    const given = Math.min(wanted, Number.isFinite(caps[i]) ? caps[i] : wanted, left);
    left -= given;
    return given;
  });
}

/**
 * §53 : `curesAll` — tous les états listés cessent sur la cible (Élixir de santé : Aveuglé, Assourdi, Paralysé, Empoisonné ;
 * Potion de vitalité : Épuisement et Empoisonné). La cible : la première du message, sinon l'utilisateur (une potion bue).
 */
async function onPostUseAll(activity, usageConfig, results) {
  const entry = contentOf(activity?.item).entry;
  if ( !activity?.actor?.isOwner || !entry ) return;
  // §160 : toutes les cibles du message (Guérison de groupe), sinon l'utilisateur (une potion bue).
  const listed = await Promise.all((results?.message?.system?.targets ?? []).map(t => fromUuid(t.token)));
  const targets = listed.filter(t => t?.actor);
  if ( !targets.length && usageTokenOf(activity)?.actor ) targets.push(usageTokenOf(activity));
  // §160 : Délivrance des malédictions — les effets des sorts de malédiction cessent.
  if ( entry.endsCurses?.length ) for ( const target of targets ) {
    const n = await onTarget(target, "curses", entry.endsCurses);
    log(`${activity.item.name}: ${n} curse effect(s) end on ${target.name}`);
  }
  // §296 : une réserve à répartir (`healPool` : Survivance, Guérison de groupe, Cavalcade mécanique, Châtiment exaltant).
  const pool = entry.healPool;
  if ( pool?.activities?.includes(activity.id) && targets.length ) await sharePool(activity, pool, targets, results);
  // §160 : Mot de pouvoir fortifiant — « 120 PV temporaires répartis à parts égales entre les créatures choisies ».
  // §401 : « que vous répartissez » — parts égales proposées, l'auteur les ajuste.
  if ( entry.tempHpPool && targets.length ) {
    const total = entry.tempHpPool;
    let shares = targets.map(() => Math.floor(total / targets.length));
    if ( targets.length > 1 ) shares = await chosenShares(activity, total, targets, shares, targets.map(() => Infinity));
    for ( const [i, target] of targets.entries() ) if ( shares[i] ) await onTarget(target, "temphp", shares[i]);
    log(`${activity.item.name}: temporary HP — ${targets.map((t, i) => `${t.name} ${shares[i]}`).join(", ")}`);
  }
  // §401 : se relever par sa Réaction (Mot de pouvoir guérisseur) — toujours par le MJ actif (le budget est un drapeau du combattant).
  if ( entry.standsWithReaction ) for ( const target of targets ) {
    if ( target.actor.statuses?.has("prone") ) await viaOwnerOrGM(game.users.activeGM?.isSelf === true, CURE_QUERY, handleCure,
      { target: target.uuid, status: "standReaction", value: activity.item.name }, { fallback: 0, timeout: 45000 });
  }
  // §160 : Résurrection — « revient à la vie avec tous ses PV ».
  if ( entry.revivesFull ) for ( const target of targets ) {
    const hp = target.actor.system.attributes.hp;
    await onTarget(target, "hp", hp.effectiveMax ?? hp.max);
    log(`${activity.item.name}: ${target.name} back to ${hp.effectiveMax ?? hp.max} HP`);
  }
  const list = entry.curesAll;
  if ( !list?.length ) return;
  for ( const target of targets ) for ( const status of list ) {
    if ( status === "exhaustion" ) {
      const level = target.actor.system?.attributes?.exhaustion ?? 0;
      if ( level > 0 ) {
        await onTarget(target, "exhaustion");
        log(`${target.name}: Exhaustion ${level} → 0`);
      }
      continue;
    }
    if ( target.actor.statuses?.has(status) ) await cureStatus(target, status);
  }
}

/**
 * K12 (§333) : un effet d'item qui porte l'état « exhaustion » (Maléfice déformant, Poids des années, Boire la sapience) ne monte pas le
 * niveau d'Épuisement dans dnd5e 6 — seul son effet propre (`dnd5eexhaustion0`) suit `system.attributes.exhaustion`. Le MJ actif
 * monte le niveau d'un cran (6 au plus) et retire l'effet de l'item, ou seulement son état s'il porte d'autres changements ou états.
 */
async function onExhaustionEffect(effect) {
  const actor = effect.parent;
  if ( !(actor instanceof Actor) || (effect.id === "dnd5eexhaustion0") || !effect.statuses?.has("exhaustion") ) return;
  const level = Number(actor.system?.attributes?.exhaustion) || 0;
  if ( effect.changes?.length || (effect.statuses.size > 1) ) await effect.update({ statuses: [...effect.statuses].filter(s => s !== "exhaustion") });
  else await effect.delete();
  await actor.update({ "system.attributes.exhaustion": Math.min(6, level + 1) });
  log(`${actor.name}: ${effect.name} — Exhaustion ${level} → ${Math.min(6, level + 1)}`);
}

export function registerCure() {
  CONFIG.queries[CURE_QUERY] = handleCure;
  route("dnd5e.postUseActivity", onPostUseAll, { label: "potion: conditions not removed" });
  route("createActiveEffect", onExhaustionEffect, { executor: true, label: "Exhaustion: level not raised by an item effect" });
}
