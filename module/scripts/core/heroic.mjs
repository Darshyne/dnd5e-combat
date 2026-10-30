/**
 * §282 : l'Inspiration héroïque (PHB 2024, Règles, « Inspiration héroïque ») — « si vous (un personnage joueur) avez l'Inspiration
 * héroïque, vous pouvez la dépenser pour relancer n'importe quel dé juste après l'avoir lancé, et vous devez utiliser le nouveau jet ».
 * Avec Avantage ou Désavantage, « vous ne relancez qu'un seul des d20, au choix » (Tests d20, « Interactions avec les relances »).
 *
 * Ce qui se calcule sans Foundry : faut-il proposer, ce que vaut le jet après la relance.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** Les trois réglages du client : jamais, à chaque jet, seulement sur un échec. */
export const HEROIC_MODES = Object.freeze(["on", "failure", "off"]);

/**
 * Faut-il proposer la relance, d'après le réglage de celui qui répond ? `failed` : le jet est raté (true), réussi (false), ou d'issue
 * inconnue (null : un test libre dont le moteur ignore le DD — proposé, au joueur de juger, comme l'Inspiration bardique).
 */
export function heroicWanted(mode, failed) {
  if ( mode === "off" ) return false;
  if ( mode === "failure" ) return failed !== false;
  return true;
}

/**
 * Le d20 que garde un jet : le seul, ou le plus haut (Avantage) / le plus bas (Désavantage) de deux.
 * @param {number[]} values
 * @param {"advantage"|"disadvantage"|null} mode
 */
export function keptOf(values, mode) {
  if ( !values.length ) return null;
  if ( mode === "advantage" ) return Math.max(...values);
  if ( mode === "disadvantage" ) return Math.min(...values);
  return values[0];
}

/**
 * Le jet après la relance d'un de ses d20 : le d20 `index` devient `value`, le d20 gardé est recalculé, et le total bouge de la
 * différence (les bonus restent). `critical` / `fumble` : seuils du dé (20 et 1 par défaut ; 19 pour un Champion).
 * @param {{values: number[], mode: string|null, total: number, criticalSuccess?: number, criticalFailure?: number}} roll
 * @param {number} index
 * @param {number} value
 * @returns {{values: number[], old: number, kept: number, total: number, delta: number, critical: boolean, fumble: boolean}}
 */
export function rerolledD20({ values, mode=null, total, criticalSuccess=20, criticalFailure=1 }, index, value) {
  const old = keptOf(values, mode);
  const after = values.map((v, i) => (i === index ? value : v));
  const kept = keptOf(after, mode);
  const delta = kept - old;
  return { values: after, old, kept, total: total + delta, delta, critical: kept >= criticalSuccess, fumble: kept <= criticalFailure };
}

/**
 * En mode « seulement sur un échec », un jet de dégâts n'a pas d'échec : il est proposé quand au moins un dé a fait la moitié de son
 * maximum ou moins (choix de l'utilisateur, 2026-10-30 : 1 à 3 sur un d6).
 * @param {Array<{faces: number, value: number}>} dice
 */
export function damageDiceLow(dice) {
  return dice.some(d => d.value <= d.faces / 2);
}

/**
 * Le total d'un type de dégâts après la relance d'un de ses dés (jamais sous zéro).
 * @param {number} value  Le total de ce type avant.
 * @param {number} old    Le dé avant.
 * @param {number} now    Le dé après.
 */
export function rerolledDamage(value, old, now) {
  return Math.max(0, value + now - old);
}
