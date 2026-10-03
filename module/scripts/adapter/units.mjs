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
