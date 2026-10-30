/**
 * §286 : Chaîne d'éclairs — « trois éclairs jaillissent alors de cette cible vers un maximum de trois autres cibles […] distantes de
 * 9 m ou moins de la première » (clé `chain` : `{ radius, units }`). Le nombre de cibles est celui de la donnée (`affects.count`,
 * « @item.level - 2 » : la visée de groupe le tient déjà, §16.33) ; la première cible est la première désignée.
 */

import { contentOf } from "./content.mjs";
import { distanceBetween } from "./turn.mjs";
import { lengthIn } from "./units.mjs";

/** La règle de chaîne de l'item, ou null. */
export function chainOf(item) {
  return item ? (contentOf(item).entry?.chain ?? null) : null;
}

/** La distance limite autour de la première cible, dans l'unité de sa scène. */
export function chainLimit(rule, first) {
  return lengthIn(rule.radius, rule.units, first.parent.grid.units);
}

/**
 * Les cibles secondaires trop loin de la première, dans l'ordre de la désignation.
 * @param {Activity} activity
 * @param {TokenDocument[]} targets  La première d'abord.
 * @returns {TokenDocument[]}  [] sans règle, ou avec moins de deux cibles.
 */
export function chainOutliers(activity, targets) {
  const rule = chainOf(activity?.item);
  const [first, ...others] = targets ?? [];
  if ( !rule || !first?.parent ) return [];
  const limit = chainLimit(rule, first);
  return others.filter(t => t?.parent && (distanceBetween(first, t).value > limit + 1e-6));
}
