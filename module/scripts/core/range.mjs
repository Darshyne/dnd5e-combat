/**
 * Une cible est-elle à portée ? Tout est converti dans l'unité de la grille avant de comparer
 * (SPEC §5.7) : le monde est métrique, un item peut être resté en pieds. Fonctions pures.
 */

import { convertLength } from "./units.mjs";

/**
 * @param {{value: number, units: string}} measured  Distance mesurée sur la scène, unité de la grille.
 * @param {object} range
 * @param {number|null} range.value   Portée normale (ou allonge, pour une attaque de mêlée).
 * @param {number|null} [range.long]  Portée longue d'une arme à distance.
 * @param {string} range.units        Unité de l'item ("ft", "m"…). Les portées « soi », « contact », « spéciale » n'ont pas de valeur.
 * @param {Record<string, number>} factors
 * @returns {"outOfRange"|"longRange"|null}  null = à portée, ou portée non mesurable.
 */
export function rangeIssue(measured, range, factors) {
  if ( !Number.isFinite(range?.value) || !(range.units in factors) || !(measured.units in factors) ) return null;
  const near = convertLength(range.value, range.units, measured.units, factors);
  if ( measured.value <= near + 1e-6 ) return null;
  if ( Number.isFinite(range.long) ) {
    const far = convertLength(range.long, range.units, measured.units, factors);
    if ( measured.value <= far + 1e-6 ) return "longRange";
  }
  return "outOfRange";
}

/**
 * O8h (§351) : une portée minimale — « ne peut pas toucher une cible à 18 m ou moins de lui » (Mangonneau, Trébuchet, tir en cloche).
 * @param {{value: number, units: string}} measured  Distance mesurée, unité de la grille.
 * @param {{value: number, units: string}|null} min  La portée minimale de l'arme, ou null.
 * @param {Record<string, number>} factors
 * @returns {boolean}  vrai si la cible est trop près (à la portée minimale ou moins) ; faux sans portée minimale mesurable.
 */
export function tooClose(measured, min, factors) {
  if ( !Number.isFinite(min?.value) || !(min.units in factors) || !(measured?.units in factors) ) return false;
  return measured.value <= convertLength(min.value, min.units, measured.units, factors) + 1e-6;
}
