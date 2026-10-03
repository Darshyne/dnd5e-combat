/**
 * Concentration. dnd5e 6.0.3 en gère déjà l'essentiel (vérifié dans la source) :
 *  - début de concentration à l'utilisation, remplacement de la précédente (activity/mixin.mjs:500)
 *  - à la perte de PV, carte `type: "prompt"` chuchotée aux propriétaires, avec un bouton de
 *    sauvegarde de concentration au bon DD (data/actor/templates/attributes.mjs:699-703,
 *    documents/actor/actor.mjs:1184-1199, DD par getConcentrationDC : actor.mjs:551)
 *  - sur la carte d'une sauvegarde ratée, bouton « Rompre la concentration »
 *    (data/chat-message/save-message-data.mjs:162-167)
 *  - état mort ou neutralisé : carte proposant de mettre fin à la concentration
 *    (documents/active-effect.mjs:964-969, actor.mjs:1205-1216)
 *  - fin de concentration : l'effet est supprimé, et avec lui les effets posés sur les cibles
 *    (`flags.dnd5e.dependentOn`, active-effect.mjs:836-860)
 * Ce que le système ne fait pas : cliquer. Le moteur n'ajoute donc aucune règle, il déclenche
 * les mêmes appels publics que ces boutons. Seul manque réel : les régions d'un sort à
 * concentration ne sont pas retirées (une région ne peut pas être un « dépendant » du système).
 * Le moteur les retire à la SUPPRESSION de l'effet de concentration, vue par tous les clients —
 * pas sur `dnd5e.endConcentration`, hook local émis sur le seul client qui a mis fin (actor.mjs,
 * `Hooks.callAll` en fin d'`endConcentration`) : un joueur qui y met fin lui-même laissait la zone.
 * Le réglage « Désactiver le suivi de la concentration » coupe tout cela à la source : sans
 * carte native, le moteur n'a rien à déclencher.
 */

import { MODULE_ID } from "../constants.mjs";
import { chooseRoller } from "../core/roller.mjs";

/** Le joueur connecté qui doit lancer pour cet acteur, ou null si c'est au moteur. */
export function rollerFor(actor) {
  return chooseRoller(game.users.map(u => ({
    id: u.id, active: u.active, isGM: u.isGM, owner: actor.testUserPermission(u, "OWNER")
  })));
}

/**
 * @param {ChatMessage} message  Message de type "prompt".
 * @returns {{kind: "roll"|"end", actor: Actor, dc?: number, ability?: string}|null}
 */
export function readConcentrationPrompt(message) {
  const buttons = message.system?.buttons ?? [];
  const actor = message.getAssociatedActor?.();
  if ( !actor ) return null;
  const roll = buttons.find(b => b.type === "concentration");
  if ( roll ) return { kind: "roll", actor, dc: roll.dc ?? 10, ability: roll.ability };
  if ( buttons.some(b => b.type === "endConcentration") ) return { kind: "end", actor };
  return null;
}

/** Même appel que le bouton de la carte (enrichers.mjs:878-897), sans dialogue. */
export async function rollConcentration({ actor, dc, ability }, promptId) {
  const config = { target: dc };
  if ( ability ) config.ability = ability;
  return actor.rollConcentration(config, { configure: false }, {
    data: { flags: { [MODULE_ID]: { concentrationPrompt: promptId } } }
  });
}

/**
 * @param {ChatMessage} message  Message de type "save".
 * @returns {{actor: Actor, failed: boolean, prompt: string|null}|null}  null si ce n'est pas une sauvegarde de concentration.
 */
export function readConcentrationSave(message) {
  if ( message.system?.type !== "concentration" ) return null;
  const actor = message.getAssociatedActor?.();
  if ( !actor ) return null;
  return {
    actor,
    failed: message.rolls.some(r => r.isFailure) && !message.system.forceSuccess,
    prompt: message.getFlag(MODULE_ID, "concentrationPrompt") ?? null
  };
}

/** Même effet que le bouton « Rompre la concentration » de la carte de sauvegarde. */
export async function breakConcentration(actor, saveMessage) {
  const ended = await actor.endConcentration();
  if ( ended?.length && saveMessage ) await saveMessage.update({ "system.outcome": "broken" });
  return ended ?? [];
}

/** L'effet de concentration ouvert par un message d'utilisation, ou null. */
export function concentrationEffectOf(usageMessage) {
  const id = usageMessage?.system?.concentration;
  return id ? usageMessage.getAssociatedActor?.()?.effects.get(id) ?? null : null;
}

/** Rattache une région à l'effet de concentration qui la maintient. */
export async function tieRegionToConcentration(region, effect) {
  await region.setFlag(MODULE_ID, "concentration", effect.uuid);
}

/** L'effet est-il une concentration (état spécial du cœur, que dnd5e pose : actor.mjs:258, active-effect.mjs:927) ? */
export function isConcentrationEffect(effect) {
  return !!effect?.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING);
}

/**
 * Une concentration désactivée (bascule de la fiche ou du HUD) n'est plus une concentration pour dnd5e
 * (`actor.concentration.effects` ne compte que les effets actifs), mais elle ne tombe pas : ses zones, ses
 * invocations et ses effets dépendants (`flags.dnd5e.dependentOn`, retirés à la seule suppression) restent.
 * Vu le 2026-09-25 : Rayon de lune « arrêté » par la bascule, zone restée sur la scène.
 * @param {ActiveEffect} effect
 * @param {object} changes  Différentiel de `updateActiveEffect`.
 */
export function concentrationDisabled(effect, changes) {
  return isConcentrationEffect(effect) && (changes?.disabled === true);
}

/** Retire les régions maintenues par un effet de concentration qui vient de tomber. */
export async function removeRegionsOf(effectUuid) {
  let removed = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.regions.filter(r => r.getFlag(MODULE_ID, "concentration") === effectUuid).map(r => r.id);
    if ( !ids.length ) continue;
    await scene.deleteEmbeddedDocuments("Region", ids);
    removed += ids.length;
  }
  return removed;
}
