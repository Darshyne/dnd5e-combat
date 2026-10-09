/**
 * Cercles (SPEC §19.5), lus et écrits dans Foundry : PV partagés (contenu `sharedHp`) et seconde phase (`secondPhase`).
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - `dnd5e.damageActor` / `dnd5e.healActor` (data/actor/templates/attributes.mjs:679-716, `onUpdateHP`) : sur tous les clients,
 *    avec l'écart de PV (`changes.hp`) et la mise à jour d'origine (`changed`) ; `options.dnd5e.concentrationCheck === false`
 *    évite le jet de concentration (ligne 700) — chaque membre d'un cercle maintient sa propre concentration ;
 *  - l'activité « transform » (data/activity/transform-data.mjs) : `profiles[].uuid` (la forme) — la donnée native qui dit
 *    « devient cette créature ». Le moteur ne passe pas par `Actor5e#transformInto` (documents/actor/actor.mjs:2846) : pour un
 *    acteur lié (un PNJ unique), il crée un nouvel acteur « X (Y) » à chaque fois.
 */

import { MODULE_ID } from "../constants.mjs";
import { sharedValue } from "../core/coven.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { tokenOf } from "./facts.mjs";

/** Le flag que porte une écriture de PV reportée : elle ne se reporte pas à son tour. */
const SYNC = "hpSync";

/** L'item qui fait partager les PV (`sharedHp`), ou null. */
export function sharedHpItemOf(actor) {
  return actor?.items?.find(i => contentOf(i).entry?.sharedHp === true) ?? null;
}

/** La seconde phase d'un acteur : l'item, son activité « transform », la forme (uuid) ; ou null. */
export function secondPhaseOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.secondPhase;
    if ( !rule ) continue;
    const activity = item.system.activities?.get(rule.activity);
    const uuid = activity?.profiles?.[0]?.uuid;
    if ( (activity?.type === "transform") && uuid ) return { item, activity, uuid, keepConditions: rule.keepConditions !== false, keepHp: rule.keepHp === true };
  }
  return null;
}

/** §76 : le changement de forme à volonté que déclare l'item de cette activité (`changesForm`, l'activité elle-même), ou null. */
export function formChangeOf(activity) {
  const item = activity?.item;
  const rule = contentOf(item).entry?.changesForm;
  if ( !rule || (rule.activity !== activity.id) || (activity.type !== "transform") ) return null;
  const uuid = activity.profiles?.[0]?.uuid;
  return uuid ? { item, activity, uuid, keepConditions: rule.keepConditions !== false, keepHp: rule.keepHp === true } : null;
}

/** À 0 PV, la créature change-t-elle de forme au lieu de tomber ? */
export const transformsAtZero = actor => !!secondPhaseOf(actor);

/** Une écriture que le partage a faite lui-même, ou la transformation (qui réécrit les PV de la forme) : à ne pas reporter. */
export function isSharedWrite(changed) {
  return foundry.utils.hasProperty(changed ?? {}, `flags.${MODULE_ID}.${SYNC}`)
    || foundry.utils.hasProperty(changed ?? {}, "flags.dnd5e.isPolymorphed");
}

/** Les autres membres du cercle de cet acteur, sur la scène de son token : un acteur par membre. */
export function covenMembers(actor) {
  const item = sharedHpItemOf(actor);
  const token = tokenOf(actor);
  const scene = (token?.document ?? token)?.parent;
  if ( !item || !scene ) return [];
  const group = identifierOf(item).id;
  const seen = new Set([actor.uuid]);
  const out = [];
  for ( const t of scene.tokens ) {
    const other = t.actor;
    if ( !other || seen.has(other.uuid) ) continue;
    const mine = sharedHpItemOf(other);
    if ( !mine || (identifierOf(mine).id !== group) ) continue;
    seen.add(other.uuid);
    out.push(other);
  }
  return out;
}

/**
 * Reporte sur les autres membres l'écart de PV que `actor` vient de subir. MJ actif. `members` : relevés au moment du coup — à 0 PV,
 * la seconde phase peut avoir déjà rendu le token de `actor` à sa nouvelle forme (vu en jeu le 2026-09-26 : le coup fatal
 * porté à un membre ne passait plus aux autres).
 * @returns {Promise<Array<{name: string, before: number, after: number}>>}
 */
export async function shareHp(actor, delta, members=covenMembers(actor)) {
  const done = [];
  for ( const other of members ) {
    const hp = other.system?.attributes?.hp;
    const next = sharedValue(hp, delta);
    if ( next === null ) continue;
    await other.update({ "system.attributes.hp.value": next, [`flags.${MODULE_ID}.${SYNC}`]: foundry.utils.randomID() },
      { dnd5e: { concentrationCheck: false } });
    done.push({ name: other.name, before: hp.value, after: next });
  }
  return done;
}

/** Les états qui disent la chute ou les PV : la nouvelle forme ne les reprend pas. */
const LEFT_BEHIND = new Set(["dead", "unconscious", "bloodied", "concentrating"]);

/**
 * Les états que la nouvelle forme garde (par défaut, elle conserve ceux de la forme précédente) : un effet à état
 * posé à la main ou par une autre créature (Paralysé d'un sort, Empoisonné…), pas un effet de ses propres items.
 */
function keptConditions(actor) {
  return actor.effects.filter(e => {
    const statuses = Array.from(e.statuses ?? []);
    if ( !statuses.length || statuses.some(id => LEFT_BEHIND.has(id)) ) return false;
    const origin = e.system?.origin?.item ?? e.system?.origin?.activity ?? e.origin ?? "";
    return !origin || !String(origin).startsWith(actor.uuid);
  }).map(e => { const data = e.toObject(); delete data._id; return data; });
}

/** L'acteur du monde de la forme : lui-même, celui importé de ce compendium, ou importé maintenant (même id). */
async function worldActorFor(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if ( !doc ) return null;
  if ( !doc.pack ) return doc;
  const found = game.actors.get(doc.id) ?? game.actors.find(a => a._stats?.compendiumSource === uuid);
  if ( found ) return found;
  return Actor.implementation.create({ ...doc.toObject(), _stats: { compendiumSource: uuid } }, { keepId: true });
}

/**
 * Seconde phase : la créature à 0 PV prend aussitôt la forme de son profil, avec ses PV au maximum ; elle garde son initiative,
 * les dégâts excédentaires sont perdus, et elle conserve ses états (sauf `keepConditions: false`). Le TOKEN change d'acteur (même document, même combattant) : ni acteur
 * « transformé » créé à chaque combat (dnd5e, `transformInto`, pour un acteur lié), ni delta perdu. MJ actif.
 * @returns {Promise<{from: string, to: string}|null>}
 */
export async function enterSecondPhase(actor) {
  const phase = secondPhaseOf(actor);
  return phase ? swapForm(actor, phase) : null;
}

/**
 * §76 : l'activité d'un changement de forme à volonté (`changesForm`) vient d'être utilisée : la créature prend sa forme, comme
 * une seconde phase. MJ actif.
 * @returns {Promise<{from: string, to: string}|null>}
 */
export async function changeForm(activity) {
  const phase = formChangeOf(activity);
  return phase ? swapForm(activity.actor, phase) : null;
}

/** Le token de `actor` change d'acteur pour la forme `phase.uuid` (seconde phase ou changement à volonté). */
async function swapForm(actor, phase) {
  const target = await worldActorFor(phase.uuid);
  const token = tokenOf(actor);
  const document = token?.document ?? token ?? null;
  if ( !target || !document ) {
    console.warn(`${MODULE_ID} | ${actor.name}: shape change impossible (${target ? "no token" : `form not found: ${phase.uuid}`})`);
    return null;
  }
  const from = actor.name;
  // §78 : `keepHp` — les PV de la forme quittée (lus avant l'échange), dans la limite du maximum de la nouvelle.
  const kept = phase.keepHp ? Math.max(0, Number(actor.system.attributes?.hp?.value) || 0) : null;
  // `keepConditions: false` : la nouvelle forme ne reprend aucun état de l'ancienne.
  const conditions = phase.keepConditions ? keptConditions(actor) : [];
  // La concentration de l'ancienne forme prend fin (ses effets sur les autres avec elle, par dnd5e).
  // Mort ou Inconscient que dnd5e a pu poser sur l'ancienne forme (`updateDowned`) : elle ne tombe pas, elle change.
  const fallen = actor.effects.filter(e => e.statuses?.has?.("concentrating") || e.statuses?.has?.("dead") || e.statuses?.has?.("unconscious")).map(e => e.id);
  if ( fallen.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", fallen);

  const proto = target.prototypeToken.toObject();
  // Un token lié n'a pas de delta à réécrire ; un token non lié repart d'un delta vierge — complet : le cœur refuse `delta: {}`
  // (« _id, system, items, effects, flags may not be undefined », vu en jeu le 2026-09-26). §78 : un token LIÉ qui devient non lié
  // n'a pas de delta (null) — on n'en écrit pas, le cœur refuse ce delta-là comme mise à jour partielle ; il part de la fiche.
  const blank = (proto.actorLink || !document._source?.delta) ? {}
    : { delta: { _id: document.delta?.id ?? document.id, system: {}, items: [], effects: [], flags: {} } };
  await document.update({
    actorId: target.id, actorLink: proto.actorLink, name: proto.name || target.name,
    texture: proto.texture, width: proto.width, height: proto.height, ring: proto.ring, ...blank
  });
  for ( const combatant of game.combats.contents.flatMap(c => c.combatants.filter(x => x.tokenId === document.id)) ) {
    await combatant.update({ actorId: target.id });
  }
  const shaped = document.actor;
  if ( shaped ) {
    const max = Number(shaped.system.attributes.hp.max) || 0;
    const hp = (kept === null) ? max : Math.min(kept, max);
    await shaped.update({ "system.attributes.hp.value": hp, [`flags.${MODULE_ID}.${SYNC}`]: foundry.utils.randomID() },
      { dnd5e: { concentrationCheck: false } });
    // À 0 PV gardés (§78 : la forme qui meurt reprend sa forme véritable), la chute reste : la Régénération ou la mort en décident.
    const downed = (hp > 0) ? shaped.effects.filter(e => ["dead", "unconscious"].some(id => e.statuses?.has?.(id))).map(e => e.id) : [];
    if ( downed.length ) await shaped.deleteEmbeddedDocuments("ActiveEffect", downed);
    if ( conditions.length ) await shaped.createEmbeddedDocuments("ActiveEffect", conditions);
  }
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token: document }),
    content: `<p>${game.i18n.format("DND5ECOMBAT.SecondePhase", { from, to: target.name, item: phase.item.name })}</p>`,
    flags: { [MODULE_ID]: { secondPhase: { from: actor.uuid, to: target.uuid, token: document.uuid } } }
  });
  return { from, to: target.name };
}

/* -------------------------------------------- */
/*  Dernier rempart (§19.6)                     */
/* -------------------------------------------- */

/** L'item de dernier rempart d'un acteur (contenu `lastStand`) qui a encore une utilisation, ou null. */
export function lastStandOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    if ( !contentOf(item).entry?.lastStand ) continue;
    const uses = item.system?.uses;
    const left = (uses?.max ?? "") === "" ? Infinity : (uses.value ?? (Number(uses.max) - (uses.spent ?? 0)));
    if ( left > 0 ) return item;
  }
  return null;
}

/** À 0 PV, la créature reste-t-elle debout (dernier rempart encore disponible) ? */
export const standsAtZero = actor => !!lastStandOf(actor);

/**
 * Met fin à tous les effets qui affectent l'acteur : les effets posés sur l'acteur (états, sorts d'autrui, concentration, chute).
 * Les effets passifs de ses items restent sur les items (dnd5e 6, pas de recopie sur l'acteur). MJ actif.
 */
export async function purgeEffects(actor) {
  const ids = actor.effects.filter(e => !e.transfer).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

/**
 * Dernier rempart à 0 PV : la créature tombe à 1 PV au lieu de 0 — la réaction jouée d'office (le MJ la voudrait toujours), une utilisation dépensée, les effets purgés. MJ actif.
 * @returns {Promise<string|null>}  Le nom de l'item, ou null.
 */
export async function standAtOne(actor) {
  const item = lastStandOf(actor);
  if ( !item ) return null;
  const uses = item.system.uses ?? {};
  if ( (uses.max ?? "") !== "" ) await item.update({ "system.uses.spent": (uses.spent ?? 0) + 1 });
  await purgeEffects(actor);
  await actor.update({ "system.attributes.hp.value": 1, [`flags.${MODULE_ID}.${SYNC}`]: foundry.utils.randomID() },
    { dnd5e: { concentrationCheck: false } });
  const token = tokenOf(actor);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor, token: token?.document ?? token ?? undefined }),
    content: `<p>${game.i18n.format("DND5ECOMBAT.DernierRempart", { item: item.name, name: actor.name })}</p>`,
    flags: { [MODULE_ID]: { lastStand: { item: item.uuid, actor: actor.uuid } } }
  });
  return item.name;
}
