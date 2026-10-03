/**
 * La Rage du Barbare (SPEC §22) lue et écrite dans dnd5e 6.0. L'item Rage du Manuel des joueurs porte un effet transféré,
 * désactivé au repos (résistances contondant / perforant / tranchant, bonus aux dégâts de mêlée, Avantage aux tests et
 * sauvegardes de Force) ; l'activité « Expend Rage » l'active, pour 10 minutes. dnd5e ne tient ni la fin de la Rage à la fin du
 * tour suivant faute de l'avoir entretenue (règle 2024), ni sa fin quand le barbare est Neutralisé : le moteur le fait.
 *
 * Vu en jeu le 2026-09-28 : le moteur applique l'effet de l'activité comme le plateau d'effets de dnd5e, en COPIE sur l'acteur
 * (origine : l'item, `_stats.duplicateSource` : l'effet de l'item) ; l'effet de l'item, lui, peut aussi être activé à la main
 * depuis la fiche. La Rage est active si l'un ou l'autre l'est.
 */

import { MODULE_ID } from "../constants.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { contentOf } from "./content.mjs";
import { currentTurnKey } from "./turn.mjs";
import { comesFromItemEffect } from "./triggers.mjs";
import { originItemOf } from "./facts.mjs";

/** L'item de Rage de l'acteur, sa règle et son effet, ou null. */
export function rageOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.rage;
    const effect = rule ? item.effects.get(rule.effect) : null;
    if ( effect ) return { item, rule, effect };
  }
  return null;
}

/** Les effets actifs de la Rage : la copie sur l'acteur, et l'effet de l'item s'il est activé. */
function rageEffects(actor) {
  const rage = rageOf(actor);
  if ( !rage ) return [];
  const copies = Array.from(actor.effects ?? []).filter(e => !e.disabled
    && (comesFromItemEffect(e, rage.rule.effect) || (originItemOf(e) === rage.item)));
  return rage.effect.disabled ? copies : [...copies, rage.effect];
}

/** L'acteur est-il en Rage ? */
export function isRaging(actor) {
  return rageEffects(actor).length > 0;
}

/** Une règle du contenu portée par un item de l'acteur (Rage persistante, Rage implacable…), ou null. */
export function barbarianRule(actor, key) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.[key];
    if ( rule ) return { item, rule };
  }
  return null;
}

/** La Rage cesse-t-elle avec cet état ? Neutralisé (et ce qui le donne) ; Inconscient seulement, avec Rage persistante. */
export function statusEndsRage(actor, statuses) {
  const list = barbarianRule(actor, "persistentRage") ? ["unconscious", "dead"] : INCAPACITATING;
  return [...statuses].some(s => list.includes(s));
}

/** Met fin à la Rage (l'effet de l'item désactivé). Rend true si elle était active. */
export async function endRage(actor) {
  const effects = rageEffects(actor);
  if ( !effects.length ) return false;
  const copies = effects.filter(e => e.parent === actor).map(e => e.id).filter(id => actor.effects.has(id));
  if ( copies.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies);
  const own = effects.find(e => e.parent !== actor);
  if ( own ) await own.update({ disabled: true });
  return true;
}

/** La Rage vient d'être entretenue (ou prise) à ce tour de combat. */
export async function keepRage(actor) {
  const key = currentTurnKey();
  if ( key && actor?.isOwner && (actor.getFlag(MODULE_ID, "rageKept") !== key) ) await actor.setFlag(MODULE_ID, "rageKept", key);
}

/** La dernière fois que la Rage a été entretenue (clé de tour), ou null. */
export const rageKeptOn = actor => actor?.getFlag(MODULE_ID, "rageKept") ?? null;

/** Rage implacable : à 0 PV, en Rage, pas mort ; l'item et son activité de sauvegarde. */
export function relentlessAtZero(actor) {
  if ( !isRaging(actor) || actor.statuses?.has("dead") ) return null;
  const found = barbarianRule(actor, "relentless");
  const activity = found ? found.item.system.activities?.get(found.rule.activity) : null;
  return activity ? { item: found.item, activity } : null;
}

/** Témérité : la décision prise à ce tour (true, false), ou null si elle n'a pas encore été prise. */
export function recklessChoice(actor) {
  const c = actor?.getFlag(MODULE_ID, "recklessTurn");
  return (c && (c.key === currentTurnKey())) ? c.reckless : null;
}
