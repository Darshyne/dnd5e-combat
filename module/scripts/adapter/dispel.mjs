/**
 * §37.2 : Dissipation de la magie (core/dispel.mjs) côté Foundry — les sorts en cours sur une créature, et comment les faire cesser.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - un effet posé par le plateau d'effets porte `flags.dnd5e.spellLevel` (niveau de lancement), `flags.dnd5e.dependentOn` (l'effet de
 *    concentration du lanceur) et `system.origin.message` (le message d'utilisation) — effect-application.mjs, `_prepareEffectData` ;
 *  - supprimer l'effet de concentration supprime ses dépendants, chez le MJ actif (documents/active-effect.mjs:836-849,
 *    `getDependents` :1105) : faire cesser un sort de concentration, c'est retirer la concentration de son lanceur.
 */

import { originItemOf } from "./facts.mjs";
import { isSpellCast, spellLevelOf } from "./scrolls.mjs";

const isConcentration = effect => effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration");

/**
 * Les sorts en cours sur un acteur, un par lancement : les effets venus d'un item de sort (hors la concentration que l'acteur tient
 * lui-même), groupés par la concentration dont ils dépendent, sinon par le message qui les a posés.
 * @param {Actor} actor
 * @param {{except?: Item|null}} [options]  Le sort à ne pas compter (la Dissipation elle-même).
 * @returns {Array<{key: string, level: number, name: string, concentration: string|null, effects: ActiveEffect[]}>}
 */
export function spellsOn(actor, { except=null }={}) {
  const groups = new Map();
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || isConcentration(effect) ) continue;
    const item = originItemOf(effect);
    if ( !isSpellCast(item) || (except && (item.system?.identifier === except.system?.identifier) && (item.actor === except.actor)) ) continue;
    const concentration = effect.getFlag?.("dnd5e", "dependentOn") ?? null;
    const key = concentration ?? effect.system?.origin?.message ?? effect.uuid;
    const level = Number(effect.getFlag?.("dnd5e", "spellLevel")) || spellLevelOf(item);
    const group = groups.get(key) ?? { key, level, name: item.name, concentration, effects: [] };
    group.level = Math.max(group.level, level);
    group.effects.push(effect);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Le sort cesse : sa concentration retirée (dnd5e retire tout ce qui en dépend), sinon ses effets sur la créature. MJ actif. */
export async function endSpell(group) {
  const concentration = group.concentration ? await fromUuid(group.concentration) : null;
  if ( concentration ) return concentration.delete();
  for ( const effect of group.effects ) if ( effect.parent?.effects?.has(effect.id) ) await effect.delete();
}

/** La caractéristique d'incantation du lanceur pour ce sort : celle du sort, sinon celle de l'acteur, sinon la Sagesse. */
export function castingAbilityOf(item, actor) {
  return item?.system?.ability || actor?.system?.attributes?.spellcasting || "wis";
}

/** Le test de caractéristique du lanceur contre ce DD ; son total, ou null s'il n'a pas eu lieu. */
export async function castingCheck(actor, ability, dc) {
  const rolls = await actor.rollAbilityCheck({ ability, target: dc }, { configure: false });
  return rolls?.[0]?.total ?? null;
}
