/**
 * §436 : l'antimagie de dnd5e 6.1, lue dans Foundry. Le statut `antimagic` de l'acteur est la vérité (posé et retiré par le comportement
 * de région `dnd5e.antimagic`, dnd5e.mjs `AntimagicRegionBehaviorType`) ; dnd5e suspend lui-même les effets `system.magical`
 * (`ActiveEffect5e#isSuppressed`) et les bonus des objets magiques (`magicAvailable`). Ici : qui porte le statut, d'où il vient, où sont
 * les champs, ce qu'est une utilisation magique, et la marque `system.magical` que la migration de dnd5e poserait.
 */

import { ANTIMAGIC_STATUS, ANTIMAGIC_BEHAVIOR, isMagicalSource, isMagicalUse, shouldMarkMagical } from "../core/antimagic.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { originItemOf } from "./facts.mjs";

/** dnd5e connaît-il le comportement de région de l'antimagie (6.1 et plus) ? */
export const antimagicBehaviorKnown = () => !!CONFIG.RegionBehavior?.dataModels?.[ANTIMAGIC_BEHAVIOR];

/** L'acteur porte-t-il le statut du système ? */
export const inAntimagic = actor => !!actor?.statuses?.has?.(ANTIMAGIC_STATUS);

/** Les faits purs d'un item (core/antimagic.mjs). */
export const itemFacts = item => item ? {
  type: item.type, subtype: item.system?.type?.value, properties: Array.from(item.system?.properties ?? [])
} : null;

/** Une utilisation que le champ interdit et dont il protège : un sort lancé, ou une activité d'objet magique (pas une attaque d'arme). */
export const magicalUse = activity => !!activity?.item
  && isMagicalUse({ spellCast: isSpellCast(activity.item), item: itemFacts(activity.item), activityType: activity.type });

/**
 * Le nom à montrer pour le champ où se tient cet acteur, ou null s'il ne porte pas le statut : l'item qui a créé la région (son
 * comportement est l'origine de l'effet), sinon le nom de la région, sinon celui de l'effet.
 */
export function antimagicSourceName(actor) {
  if ( !inAntimagic(actor) ) return null;
  const effect = (actor.effects ?? []).find(e => e.statuses?.has?.(ANTIMAGIC_STATUS));
  const behavior = effect?.origin ? fromUuidSync(effect.origin, { strict: false }) : null;
  const region = (behavior?.documentName === "RegionBehavior") ? behavior.parent : null;
  const itemUuid = region?.getFlag?.("dnd5e", "item");
  const item = itemUuid ? fromUuidSync(itemUuid, { strict: false }) : null;
  return item?.name ?? region?.name ?? effect?.name ?? game.i18n.localize("EFFECT.DND5E.StatusAntimagic");
}

/** Les régions de la scène qui portent un comportement antimagie actif. */
export function antimagicRegions(scene) {
  return (scene?.regions ?? []).filter(r => r.behaviors?.some(b => (b.type === ANTIMAGIC_BEHAVIOR) && !b.disabled));
}

/**
 * La région antimagie qui contient ce token à `position` (`{ x, y, elevation }`, coin haut-gauche du token comme `_source`), ou null.
 * `testInsideRegion` du cœur, comme `isInside` (adapter/areas.mjs).
 */
export function antimagicRegionAt(token, position) {
  return antimagicRegions(token?.parent).find(r => token.testInsideRegion(r, position)) ?? null;
}

/** Cette région vient-elle d'une activité qui pose déjà le comportement du système (SRD 6.1) ? */
export function regionHasAntimagic(region, activity) {
  if ( region.behaviors?.some(b => b.type === ANTIMAGIC_BEHAVIOR) ) return true;
  return Array.from(activity?.behaviors ?? []).some(b => b.type === "antimagic");
}

/**
 * La marque que la migration de dnd5e pose (`_migrateEffectMagical`) et qu'un item ajouté après elle n'a pas (Manuel des joueurs : aucun
 * des 294 effets de sorts marqués) : sur les effets d'un item magique en création. Rend le nombre d'effets marqués.
 * @param {Item} item   le document en création (`preCreateItem`)
 */
export function markItemEffects(item) {
  if ( !isMagicalSource(itemFacts(item)) ) return 0;
  const effects = item._source?.effects ?? [];
  let n = 0;
  const updated = effects.map(e => {
    if ( !shouldMarkMagical({ type: e.type, magical: e.system?.magical, statuses: e.statuses }, itemFacts(item)) ) return e;
    n += 1;
    return { ...e, system: { ...(e.system ?? {}), magical: true } };
  });
  if ( n ) item.updateSource({ effects: updated });
  return n;
}

/**
 * La même marque sur un effet posé sur un acteur dont l'item d'origine est magique (un sort appliqué, une copie d'aura, l'effet d'une
 * zone) : sans elle, dnd5e ne le suspend pas dans un champ. Rend true si l'effet est marqué.
 * @param {ActiveEffect} effect   le document en création (`preCreateActiveEffect`)
 */
export function markAppliedEffect(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return false;
  if ( !effect.system || !("magical" in effect.system) ) return false;
  const facts = { type: effect.type, magical: effect.system.magical, statuses: effect.statuses };
  if ( !shouldMarkMagical(facts, itemFacts(originItemOf(effect))) ) return false;
  effect.updateSource({ "system.magical": true });
  return true;
}
