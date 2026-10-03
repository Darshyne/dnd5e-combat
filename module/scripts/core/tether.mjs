/**
 * Lien entre un lanceur et une créature (SPEC §16.43, clé `tether` de core/content.mjs) : Trait ensorcelé — « à chacun de vos
 * tours suivants, vous pouvez faire une action Bonus pour infliger automatiquement 1d12 dégâts de foudre à la cible, même si
 * la première attaque a raté ; le sort prend fin dès que la cible sort de sa portée ou bénéficie d'un abri total vis-à-vis de
 * vous ». Fonctions pures.
 */

/**
 * Le lien se rompt-il ? « sa portée » : au-delà de `maxRange` (même unité que `distance`) ; « abri total ».
 * @param {{distance: number|null, maxRange: number|null, totalCover: boolean}} state
 * @returns {"range"|"cover"|null}
 */
export function tetherBreak({ distance, maxRange, totalCover }) {
  if ( Number.isFinite(distance) && Number.isFinite(maxRange) && (distance > maxRange + 1e-6) ) return "range";
  if ( totalCover ) return "cover";
  return null;
}
