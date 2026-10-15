import { convertLength } from "../core/units.mjs";

/**
 * Facteurs de conversion de longueur lus dans la configuration du système
 * (CONFIG.DND5E.movementUnits.<unité>.conversion, exprimés par rapport au pied).
 * Seul endroit qui connaît la forme de cette configuration ; le cœur ne reçoit qu'une table.
 * @returns {Record<string, number>}
 */
export function readUnitFactors() {
  const factors = {};
  for ( const [unit, config] of Object.entries(CONFIG.DND5E.movementUnits ?? {}) ) {
    if ( Number.isFinite(config?.conversion) ) factors[unit] = config.conversion;
  }
  return factors;
}

/**
 * Une longueur exprimée dans l'unité `to` (celle de la grille, d'ordinaire) ; la valeur telle quelle si une unité est inconnue ou
 * absente (`convertLength` lève alors une erreur). `factors` : déjà lus, pour une boucle.
 * @param {number} value
 * @param {string} from
 * @param {string} to
 * @param {Record<string, number>} [factors]
 */
export function lengthIn(value, from, to, factors=readUnitFactors()) {
  try { return convertLength(value, from, to, factors); }
  catch { return value; }
}
