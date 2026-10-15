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
  return removeStatus(target, status);
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
  if ( n > 0 ) notice(target, loc("Retour.FinEffet", { item: label }), "ended");
  return n;
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
  // §160 : Mot de pouvoir fortifiant — « 120 PV temporaires répartis à parts égales entre les créatures choisies ».
  if ( entry.tempHpPool && targets.length ) {
    const share = Math.floor(entry.tempHpPool / targets.length);
    for ( const target of targets ) await onTarget(target, "temphp", share);
    log(`${activity.item.name}: ${share} temporary HP each to ${targets.map(t => t.name).join(", ")}`);
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

export function registerCure() {
  CONFIG.queries[CURE_QUERY] = handleCure;
  route("dnd5e.postUseActivity", onPostUseAll, { label: "potion: conditions not removed" });
}
