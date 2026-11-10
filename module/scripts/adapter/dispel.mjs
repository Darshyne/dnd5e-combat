/**
 * §37.2 : Dissipation de la magie (core/dispel.mjs) côté Foundry — les sorts en cours sur une créature, et comment les faire cesser.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - un effet posé par le plateau d'effets porte `flags.dnd5e.spellLevel` (niveau de lancement), `flags.dnd5e.dependentOn` (l'effet de
 *    concentration du lanceur) et `system.origin.message` (le message d'utilisation) — effect-application.mjs, `_prepareEffectData` ;
 *  - supprimer l'effet de concentration supprime ses dépendants, chez le MJ actif (documents/active-effect.mjs:836-849,
 *    `getDependents` :1105) : faire cesser un sort de concentration, c'est retirer la concentration de son lanceur.
 */

import { MODULE_ID } from "../constants.mjs";
import { originItemOf } from "./facts.mjs";
import { zoneCenter } from "./areas.mjs";
import { isSpellCast, spellLevelOf } from "./scrolls.mjs";
import { identifierOf } from "./content.mjs";

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
    if ( !isSpellCast(item) || (except && (identifierOf(item).id === identifierOf(except).id) && (item.actor === except.actor)) ) continue;
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

/**
 * Le sort cesse : sa concentration retirée (dnd5e retire tout ce qui en dépend ; le moteur retire ses zones), sinon ses effets sur la
 * créature, ou sa zone (§403). MJ actif.
 */
export async function endSpell(group) {
  const concentration = group.concentration ? await fromUuid(group.concentration) : null;
  if ( concentration ) return concentration.delete();
  if ( group.region?.parent?.regions?.has(group.region.id) ) await group.region.delete();
  for ( const effect of group.effects ) if ( effect.parent?.effects?.has(effect.id) ) await effect.delete();
}

/** La caractéristique d'incantation du lanceur pour ce sort : celle du sort, sinon celle de l'acteur, sinon la Sagesse. */
export function castingAbilityOf(item, actor) {
  return item?.system?.ability || actor?.system?.attributes?.spellcasting || "wis";
}

/** Le test de caractéristique du lanceur contre ce DD ; son total, ou null s'il n'a pas eu lieu. */
export async function castingCheck(actor, ability, dc, { bonus=0 }={}) {
  const rolls = await actor.rollAbilityCheck({ ability, target: dc }, { configure: false });
  const total = rolls?.[0]?.total ?? null;
  return (total === null) ? null : total + bonus;
}

/**
 * §403 : les zones de sort de la scène (régions posées par une activité de sort : `flags.dnd5e.activity`) à portée du lanceur — mesurée
 * de son token au centre de la zone, dans l'unité de la grille —, chacune comme un sort en cours : son niveau de lancement
 * (`flags.dnd5e.spellLevel`, sinon celui de l'item), la concentration qui la tient (`flags.dnd5e-combat.concentration`).
 * @param {TokenDocument} caster
 * @param {number} range  Dans l'unité de la grille.
 * @param {{except?: Item|null}} [options]
 * @returns {Array<{key: string, level: number, name: string, concentration: string|null, effects: ActiveEffect[], region: RegionDocument}>}
 */
export function spellZonesNear(caster, range, { except=null }={}) {
  const scene = caster?.parent;
  if ( !scene ) return [];
  const from = caster.object?.center ?? caster.getCenterPoint?.(caster._source);
  const pxPerUnit = scene.grid.size / scene.grid.distance;
  const out = [];
  for ( const region of scene.regions ) {
    const uuid = region.getFlag?.("dnd5e", "activity");
    const item = uuid ? fromUuidSync(uuid, { strict: false })?.item : null;
    if ( !isSpellCast(item) || (except && (item === except)) ) continue;
    const center = zoneCenter(region);
    if ( from && center && (Math.hypot(center.x - from.x, center.y - from.y) / pxPerUnit > range + 1e-6) ) continue;
    const level = Number(region.getFlag("dnd5e", "spellLevel")) || spellLevelOf(item);
    out.push({ key: region.uuid, level, name: item.name, caster: item.actor?.name ?? "", concentration: region.getFlag(MODULE_ID, "concentration") ?? null, effects: [], region });
  }
  return out;
}
