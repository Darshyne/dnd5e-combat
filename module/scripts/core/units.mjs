/**
 * Conversion de longueurs, sans dépendance à Foundry (SPEC §5.7).
 * `factors[u]` est la longueur d'une unité `u` dans une unité de référence commune
 * (dnd5e : le pied). Convertir revient à passer par cette référence.
 */

/**
 * @param {number} value
 * @param {string} from
 * @param {string} to
 * @param {Record<string, number>} factors
 * @returns {number}
 */
export function convertLength(value, from, to, factors) {
  if ( from === to ) return value;
  const a = factors[from];
  const b = factors[to];
  if ( !Number.isFinite(a) || !Number.isFinite(b) ) {
    throw new Error(`Unknown length unit: ${Number.isFinite(a) ? to : from}`);
  }
  return value * a / b;
}

/**
 * Une distance mesurée sur la scène est-elle dans une portée exprimée dans une autre unité ?
 * dnd5e convertit en simplifié (5 ft = 1,5 m, facteur 10/3) : 30 ft valent exactement 9 m.
 * L'epsilon n'absorbe que l'erreur de virgule flottante, pas une case de plus.
 * @param {{value: number, units: string}} measured   distance mesurée, unité de la grille
 * @param {{value: number, units: string}} range      portée de l'activité
 * @param {Record<string, number>} factors
 */
export function isWithinRange(measured, range, factors) {
  const limit = convertLength(range.value, range.units, measured.units, factors);
  return measured.value <= limit + 1e-6;
}
