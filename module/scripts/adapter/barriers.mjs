/**
 * §163 : les émanations qui protègent ou interdisent, tenues par un effet de leur lanceur (concentration comprise) et centrées sur lui —
 * elles le suivent :
 *  - `globe: { radius, units, maxLevel, everywhere? }` (adapter/eligibility.mjs, §161) ; `everywhere` — Champ antimagie : aucun sort
 *    n'y affecte personne, d'où qu'il soit lancé, et on n'y lance aucun sort ;
 *  - `barrier: { radius, units, exceptTypes? }` — Coquille antivie : une créature (hors `exceptTypes`) ne peut pas y entrer, ni frapper
 *    au corps à corps à travers sans arme à allonge.
 * Lecture seulement : la légalité (runtime/turn.mjs, runtime/actions.mjs) et l'éligibilité décident.
 */

import { contentOf } from "./content.mjs";
import { originItemOf, creatureTypeOf } from "./facts.mjs";
import { distanceBetween } from "./turn.mjs";
import { lengthIn } from "./units.mjs";

/** Les émanations `key` de la scène : `{ holder, item, rule }`, une par lanceur et par item. */
export function zonesOf(scene, key) {
  const out = [];
  for ( const holder of scene?.tokens ?? [] ) {
    const seen = new Set();
    for ( const effect of holder.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.isSuppressed ) continue;
      const item = originItemOf(effect);
      const rule = item ? contentOf(item).entry?.[key] : null;
      if ( !rule || seen.has(item.uuid) ) continue;
      seen.add(item.uuid);
      out.push({ holder, item, rule });
    }
  }
  return out;
}

/** Le rayon d'une émanation, dans l'unité de la grille. */
function radiusOf(scene, rule) {
  return lengthIn(rule.radius, rule.units, scene.grid.units);
}

/** Le token (à sa position, ou à `pos`) est-il dans l'émanation de `holder` ? */
export function insideZone(holder, token, rule, pos=undefined) {
  if ( !holder || !token || (holder.parent !== token.parent) ) return false;
  return distanceBetween(holder, token, pos ? { posB: pos } : {}).value <= radiusOf(token.parent, rule) + 1e-6;
}

/** §163 : le Champ antimagie dans lequel se tient ce token, ou null. */
export function antimagicAround(token) {
  return zonesOf(token?.parent, "globe").find(z => z.rule.everywhere && insideZone(z.holder, token, z.rule)) ?? null;
}

/** La créature passe-t-elle la barrière (types exemptés, le lanceur lui-même) ? */
const crosses = (zone, token) => (zone.holder === token) || (zone.rule.exceptTypes ?? []).includes(creatureTypeOf(token.actor));

/**
 * §163 : Coquille antivie — la barrière que ce déplacement franchirait de l'extérieur vers l'intérieur, ou null. `positions` : les
 * positions successives du déplacement (waypoints), la première exclue.
 */
export function barrierCrossed(token, positions) {
  for ( const zone of zonesOf(token?.parent, "barrier") ) {
    if ( crosses(zone, token) || insideZone(zone.holder, token, zone.rule) ) continue;
    if ( positions.some(pos => insideZone(zone.holder, token, zone.rule, pos)) ) return zone;
  }
  return null;
}

/**
 * §163 : Coquille antivie — « empêche les créatures … d'atteindre à travers » : une attaque au corps à corps sans allonge, de l'extérieur
 * vers une cible à l'intérieur. Rend la barrière, ou null.
 */
export function barrierBetween(attacker, target, activity) {
  if ( (activity?.type !== "attack") || (activity.attack?.type?.value !== "melee") ) return null;
  if ( activity.item?.system?.properties?.has?.("rch") ) return null;
  for ( const zone of zonesOf(attacker?.parent, "barrier") ) {
    if ( crosses(zone, attacker) || insideZone(zone.holder, attacker, zone.rule) ) continue;
    if ( insideZone(zone.holder, target, zone.rule) ) return zone;
  }
  return null;
}
