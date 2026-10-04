/**
 * À 0 point de vie, lu et écrit dans Foundry pour le cœur (core/death.mjs). Vérifié dans dnd5e 6.0.3 :
 *  - `Actor5e#applyDamage` appelle `dnd5e.preApplyDamage(actor, amount, updates, options)` avec `Hooks.call`
 *    AVANT l'écriture, sur le client qui applique : ajouter une clé à `updates` l'écrit dans la même mise à jour
 *    (documents/actor/actor.mjs, `applyDamage`). `amount` : dégâts après résistances, avant PV temporaires ;
 *    `options.origin` ou `options.originatingMessage` : le message de dégâts, qui porte le critique.
 *  - à 0 PV, une mise à jour qui ne change que les PV ne change rien (PV bornés à 0) : sans cette clé, rien n'est
 *    écrit, et `updateDowned` (qui pose Inconscient / Mort) ne tourne que si les PV changent.
 *  - `rollDeathSave` compte succès et échecs et appelle `dnd5e.rollDeathSaveV2(rolls, { outcome, updates, subject })`
 *    (`outcome` : "stable", "death", "revive" ou null), mais ne pose pas Stabilisé ; Mort, oui, quand l'écriture
 *    des trois échecs passe par `onUpdateDeathSaves` (data/actor/templates/attributes.mjs) et que le réglage le permet.
 *  - le réglage de monde `autoApplyDowned` ("none", "deadOnly", "npcs", "all") dit si le système pose ces états ;
 *    le moteur suit la même règle pour Mort (actor.mjs, `updateDowned`). Stabilisé est toujours posé : c'est ce qui
 *    dit au moteur de ne plus demander de jet.
 * Les états posés ici portent `flags["dnd5e-combat"].death` : le moteur les retire quand les PV remontent.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { makesDeathSaves, damageAtZero, needsDeathSave, statusAfterDeathSave, downedStatus, isDead, canStabilize } from "../core/death.mjs";
import { rollerFor } from "./concentration.mjs";
import { closeRollDialogAfter } from "./dialogs.mjs";
import { transformsAtZero, standsAtZero } from "./coven.mjs";
import { regenerationOf } from "./regeneration.mjs";
import { relentlessAtZero } from "./rage.mjs";
import { endureAtZero } from "./species.mjs";
import { wardAtZero } from "./ward.mjs";
import { planFortitude, pendingFortitude } from "./fortitude.mjs";

export const DEATH_QUERY = `${MODULE_ID}.deathSave`;
const DEATH_TIMEOUT = 40000;

const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Mort.${key}`, data ?? {});

function savesOf(actor) {
  return makesDeathSaves({ type: actor?.type, important: !!actor?.system?.traits?.important });
}

/** §18.13 : une Régénération qui fait survivre à 0 PV jusqu'au début du tour (Troll, Revenant). */
const regeneratesAtZero = actor => !!regenerationOf(actor)?.survivesZero;

/**
 * §71 : tombée à 0 PV sous une arme `stableAtZero` (Dague des ombres du Familier de vampire : « elle se retrouve Stabilisée ») —
 * flag écrit dans la MÊME mise à jour que les PV (`planDamageAtZero`), lu par tous les clients avant de poser Mort ou Inconscient.
 */
const keptStable = actor => !!actor?.getFlag?.(MODULE_ID, "stableAtZero");

/** Survit à 0 PV sans jets contre la mort : Régénération, ou stabilisée par l'arme qui l'y a fait tomber. */
const survivesZero = actor => regeneratesAtZero(actor) || keptStable(actor);

/** L'item des dégâts (message de dégâts de dnd5e, `options.originatingMessage`), ou null. */
function damageItemOf(options) {
  const message = options?.originatingMessage ?? options?.origin;
  return message?.getAssociatedActivity?.()?.item ?? message?.getAssociatedItem?.() ?? null;
}

/** L'acteur est-il mort ? (core/death.mjs, `isDead`) — pour l'abri et le tir au contact. */
export function isDeadActor(actor) {
  const hp = actor?.system?.attributes?.hp;
  if ( !actor || !hp ) return !!actor?.statuses?.has("dead");
  return isDead({ hp: hp.value, saves: savesOf(actor) || survivesZero(actor) || transformsAtZero(actor) || standsAtZero(actor) || !!pendingFortitude(actor), statuses: Array.from(actor.statuses) });
}

/** Le message de dégâts est-il un coup critique ? */
function isCriticalDamage(options) {
  const message = options?.originatingMessage ?? options?.origin;
  return !!message?.rolls?.some?.(r => r.isCritical || r.options?.isCritical);
}

async function announce(actor, key, data, kind) {
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${t(key, { name: actor.name, ...data })}</p>`,
    flags: { [MODULE_ID]: { death: { kind, actor: actor.uuid, ...data } } }
  });
}

/**
 * Pose un état du système (« dead », « stable ») marqué par le moteur, s'il n'y est pas déjà. Le système peut
 * poser Mort au même moment (`updateDowned`, dès qu'une mise à jour des PV voit trois échecs) : l'identifiant de
 * l'état est fixe (`keepId`), la seconde création échoue, et c'est sans conséquence.
 */
export async function setDeathStatus(actor, id) {
  if ( actor.statuses.has(id) ) return null;
  const effect = await ActiveEffect.implementation.fromStatusEffect(id);
  const flags = { [MODULE_ID]: { death: true } };
  if ( id === "dead" ) flags.core = { overlay: true };
  effect.updateSource({ flags });
  try { return await ActiveEffect.implementation.create(effect, { parent: actor, keepId: true }); }
  catch(err) { if ( actor.statuses.has(id) || actor.effects.has(effect.id) ) return null; throw err; }
}

/**
 * Retire des effets un à un, sans échouer sur un effet déjà retiré ailleurs entre-temps (§18.18) : `deleteEmbeddedDocuments`
 * refuse toute l'opération si l'un d'eux n'existe plus (« ActiveEffect … does not exist »), et l'erreur partait dans la
 * console — vu quand le filet de sécurité des scénarios retirait la Mort d'un boss en même temps que le moteur (§18.7).
 */
async function deleteEffects(actor, ids) {
  for ( const id of ids ) {
    if ( !actor.effects.has(id) ) continue;
    try { await actor.deleteEmbeddedDocuments("ActiveEffect", [id]); }
    catch(err) { if ( actor.effects.has(id) ) throw err; }
  }
}

async function removeStable(actor) {
  // §16.47 : quelle que soit sa source (le moteur, ou le sort Stabilisation).
  const ids = actor.effects.filter(e => e.statuses.has("stable")).map(e => e.id);
  await deleteEffects(actor, ids);
}

async function markDead(actor, reason, data={}) {
  await announce(actor, reason === "massive" ? "SurLeCoup" : "TroisEchecs", data, reason);
  await removeStable(actor);
  await setDeathStatus(actor, "dead");
}

/**
 * §18.13 : la Mort que dnd5e pose d'office sur un PNJ à 0 PV en combat (`updateDowned`, flag `autoDowned`,
 * documents/actor/actor.mjs:3671-3682) ne vaut pas pour une créature qui peut encore régénérer. dnd5e la repose à chaque
 * écriture des PV, de façon asynchrone : on la retire aussi à sa création (runtime/regeneration.mjs). Rend true si retirée.
 */
export async function dropAutoDead(actor) {
  if ( !survivesZero(actor) ) return false;
  const auto = actor.effects.filter(e => e.getFlag("dnd5e", "autoDowned") && e.statuses.has("dead")).map(e => e.id);
  if ( !auto.length ) return false;
  await deleteEffects(actor, auto);
  return true;
}

/**
 * §17.1 : à 0 PV, Mort ou Inconscient (qui entraîne Neutralisé et À terre, `CONFIG.DND5E.conditionTypes.unconscious`,
 * riders posés par dnd5e à la création, documents/active-effect.mjs `_onCreateOperation`), quel que soit le réglage
 * « Auto-Apply Downed » et même hors combat. Marqué par le moteur : retiré quand les PV remontent. MJ actif.
 * @returns {Promise<"dead"|"unconscious"|null>}
 */
export async function ensureDowned(actor, { afterUpdate=false }={}) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp ) return null;
  // §19.5 : une créature à seconde phase ne tombe pas, elle change de forme (runtime/coven.mjs).
  // §22 : Rage implacable — la sauvegarde de Constitution décide d'abord (runtime/barbarian.mjs) ; §61 : Robustesse de la non-vie.
  if ( (hp.value <= 0) && (transformsAtZero(actor) || standsAtZero(actor) || relentlessAtZero(actor) || pendingFortitude(actor)) ) return null;
  const regenerates = (hp.value <= 0) && survivesZero(actor);
  if ( regenerates ) await dropAutoDead(actor);
  const status = downedStatus({ hp: hp.value, saves: savesOf(actor), statuses: Array.from(actor.statuses),
    failures: actor.system.attributes.death?.failure ?? 0, regenerates });
  if ( !status ) return null;
  // PV qui viennent d'être écrits, en combat : dnd5e pose lui-même cet état, avec le même id (`keepId`), sur le client qui a
  // écrit (`updateDowned`, data/actor/templates/attributes.mjs:732 ; actor.mjs:3652-3682). Les deux créations se
  // croisaient et celle de dnd5e échouait dans la console (« _id dnd5edead0000000 already exists », vu le 2026-09-26). On
  // lui laisse un instant, et on ne pose l'état que s'il manque encore : une écriture des PV dans le delta d'un token non lié
  // (outil, macro) ne passe pas par `updateDowned`, et rien d'autre ne le poserait.
  if ( afterUpdate && !regenerates && (systemDowned(actor) === status) ) {
    await new Promise(resolve => setTimeout(resolve, 400));
    if ( actor.statuses.has(status) ) return null;
  }
  await setDeathStatus(actor, status);
  return status;
}

/** L'état que dnd5e pose de lui-même à 0 PV (`updateDowned`, réglage « Auto-Apply Downed »), ou null. */
function systemDowned(actor) {
  const mode = globalThis.dnd5e?.settings?.autoApplyDowned ?? "none";
  if ( (mode === "none") || !actor.inCombat ) return null;
  const failed = (actor.system.attributes.death?.failure ?? 0) >= 3;
  if ( actor.type === "npc" ) {
    if ( !actor.system.traits?.important ) return "dead";
    return (mode !== "deadOnly") ? (failed ? "dead" : "unconscious") : null;
  }
  if ( (actor.type === "character") && (mode === "all") ) return failed ? "dead" : "unconscious";
  return null;
}

/* -------------------------------------------- */
/*  Dégâts                                      */
/* -------------------------------------------- */

/**
 * `dnd5e.preApplyDamage` (synchrone) : écrit les échecs dans la mise à jour des dégâts et garde dans
 * `options` ce qu'il faudra poser après. Sur le client qui applique les dégâts.
 */
export function planDamageAtZero(actor, amount, updates, options) {
  const hp = actor?.system?.attributes?.hp;
  const death = actor?.system?.attributes?.death;
  if ( !hp || !death || !(amount > 0) || actor.statuses.has("dead") ) return;
  if ( transformsAtZero(actor) || standsAtZero(actor) ) return;   // §19.5-6 : ni échec ni mort, la seconde phase ou l'amulette vient
  // §16.11 : ce qu'une réserve (Égide arcanique) a absorbé, inscrit plus tôt dans ce même hook, n'atteint pas la créature.
  const incoming = Math.max(0, amount - (options?.[MODULE_ID]?.absorbed ?? 0));
  const through = incoming - Math.min(hp.temp ?? 0, incoming);
  // §73 : Protection contre la mort — à 1 PV au lieu de 0 (même tuée sur le coup : elle n'y tombe pas), le sort prend fin.
  const warded = wardAtZero(actor, through, updates);
  if ( warded ) {
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), endured: warded.name };
    return;
  }
  // §31 : Acharnement (Orc) — à 1 PV au lieu de 0, sans échec ni mort (sauf tué sur le coup).
  const endured = endureAtZero(actor, through, updates);
  if ( endured ) {
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), endured: endured.name };
    return;
  }
  // §71 : une arme qui stabilise ce qu'elle fait tomber — ni échec ni mort ; flag écrit avec les PV, Stabilisé posé après.
  if ( (hp.value > 0) && (through >= hp.value) && contentOf(damageItemOf(options)).entry?.stableAtZero ) {
    updates[`flags.${MODULE_ID}.stableAtZero`] = true;
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), death: { stable: true } };
    return;
  }
  // Déjà à 0 et gardée en vie par une telle arme : de nouveaux dégâts suivent la règle ordinaire (un PNJ meurt).
  if ( (hp.value <= 0) && keptStable(actor) && (through > 0) ) updates[`flags.${MODULE_ID}.-=stableAtZero`] = null;
  const critical = isCriticalDamage(options);
  // §61 : Robustesse de la non-vie — la sauvegarde due part avec les PV ; ni échec ni mort tant qu'elle n'est pas jouée.
  const taken = incoming;
  if ( planFortitude(actor, { hp: hp.value, through, taken, types: options?.[MODULE_ID]?.takenTypes ?? [], critical }, updates) ) return;
  const outcome = damageAtZero({ hp: hp.value, max: hp.max, through, critical, failures: death.failure ?? 0, saves: savesOf(actor) });
  if ( !outcome.dead && (outcome.failures === null) ) return;
  if ( outcome.failures !== null ) updates["system.attributes.death.failure"] = outcome.failures;
  options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), death: { ...outcome, critical, through, max: hp.max, before: hp.value } };
}

/** `dnd5e.applyDamage` : pose Mort, retire Stabilisé, et le dit dans le chat. */
export async function settleDamageAtZero(actor, amount, options) {
  const outcome = options?.[MODULE_ID]?.death;
  if ( !outcome ) return null;
  if ( outcome.stable ) {
    // §71 : Stabilisé, et la Mort que dnd5e pose d'office sur un PNJ à 0 PV (`autoDowned`) retirée — Inconscient à la place.
    await setDeathStatus(actor, "stable");
    await dropAutoDead(actor);
    await ensureDowned(actor);
    await announce(actor, "Stabilise", {}, "stable");
    return outcome;
  }
  if ( outcome.dead ) {
    const data = outcome.reason === "massive"
      ? { remainder: outcome.through - outcome.before, max: outcome.max }
      : { failures: outcome.failures };
    await markDead(actor, outcome.reason, data);
    return outcome;
  }
  if ( outcome.unstable ) await removeStable(actor);
  await announce(actor, outcome.critical ? "EchecsCritique" : "Echec", { failures: outcome.failures }, "failure");
  return outcome;
}

/* -------------------------------------------- */
/*  Jet contre la mort                          */
/* -------------------------------------------- */

/**
 * §50 : stabiliser une créature à 0 PV (trousse de soins) — comme trois succès aux jets contre la mort : Stabilisé posé par le
 * moteur (retiré quand les PV remontent ou qu'elle subit des dégâts), annoncé au chat. Rend false si rien n'est à faire.
 */
export async function stabilize(actor, { by="", with: tool="" }={}) {
  const hp = actor?.system?.attributes?.hp?.value ?? 1;
  if ( !canStabilize({ hp, statuses: Array.from(actor?.statuses ?? []) }) ) return false;
  await setDeathStatus(actor, "stable");
  await announce(actor, "StabiliseSoins", { by, tool }, "stable");
  return true;
}

/** `dnd5e.rollDeathSaveV2` : Stabilisé après trois succès, Mort après trois échecs. Sur le client qui a lancé. */
export async function settleDeathSave(actor, outcome) {
  const status = statusAfterDeathSave(outcome);
  if ( status === "stable" ) {
    await setDeathStatus(actor, "stable");
    return announce(actor, "Stabilise", {}, "stable");
  }
  if ( status === "dead" ) return markDead(actor, "failures", { failures: 3 });
  return null;
}

/** La créature doit-elle lancer un jet contre la mort ? */
export function deathSaveDue(actor) {
  const hp = actor?.system?.attributes?.hp;
  const death = actor?.system?.attributes?.death;
  if ( !hp || !death ) return false;
  return needsDeathSave({ hp: hp.value, saves: savesOf(actor), statuses: Array.from(actor.statuses),
    failures: death.failure ?? 0, successes: death.success ?? 0 });
}

/**
 * Côté joueur : la fenêtre du jet contre la mort s'ouvre sur SON écran, ce sont ses dés. Le jet n'est pas
 * facultatif : fenêtre fermée ou délai écoulé, il part sans fenêtre, toujours sur son client.
 */
export async function handleDeathSaveQuery({ actor: actorUuid }) {
  const actor = await fromUuid(actorUuid);
  if ( !actor?.isOwner || !deathSaveDue(actor) ) return false;
  ui.notifications.info(t("DemandeJoueur", { name: actor.name }));
  const cancel = closeRollDialogAfter(actor, () => {});
  let rolls = await actor.rollDeathSave({}, { configure: true });
  cancel();
  if ( !rolls?.length && deathSaveDue(actor) ) rolls = await actor.rollDeathSave({}, { configure: false });
  return !!rolls?.length;
}

/**
 * Au début du tour : le joueur connecté qui possède la créature lance chez lui ; sinon (PNJ important, PJ sans
 * joueur, joueur qui ne répond pas) le moteur lance. MJ actif uniquement.
 */
export async function requestDeathSave(actor) {
  const userId = rollerFor(actor);
  if ( userId ) {
    const rolled = await game.users.get(userId).query(DEATH_QUERY, { actor: actor.uuid }, { timeout: DEATH_TIMEOUT }).catch(() => false);
    if ( rolled || !deathSaveDue(actor) ) return "player";
  }
  await actor.rollDeathSave({}, { configure: false });
  return "engine";
}

/* -------------------------------------------- */
/*  Retour à la vie                             */
/* -------------------------------------------- */

/** Les PV remontent : les états Mort et Stabilisé que le moteur avait posés tombent. MJ actif uniquement. */
export async function clearDeathMarks(actor) {
  if ( !(actor?.system?.attributes?.hp?.value > 0) ) return 0;
  // Mort et Stabilisé posés par le moteur ; Stabilisé, quelle que soit sa source (Stabilisation, §16.47).
  const ids = actor.effects.filter(e => e.getFlag(MODULE_ID, "death") || e.statuses.has("stable")).map(e => e.id);
  await deleteEffects(actor, ids);
  if ( keptStable(actor) ) await actor.unsetFlag(MODULE_ID, "stableAtZero");   // §71
  return ids.length;
}
