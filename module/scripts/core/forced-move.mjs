/**
 * Une Réaction qui raccourcit un déplacement subi (clé de contenu `reducesForcedMove` : Harnois nain — « si un effet vous déplace contre
 * votre gré sur le sol, vous pouvez utiliser votre Réaction pour réduire la distance de 3 m au plus »). Fonctions pures.
 */

/**
 * De combien la règle peut raccourcir ce déplacement : au plus sa distance, jamais plus que le déplacement lui-même. Unités
 * différentes : rien (la règle se déclare dans l'unité des poussées du contenu).
 * @param {{distance: number, units: string}|null|undefined} rule
 * @param {number} distance  Le déplacement subi.
 * @param {string} units     Son unité.
 */
export function braceCut(rule, distance, units) {
  if ( !rule || !(rule.distance > 0) || !(distance > 0) || (rule.units !== units) ) return 0;
  return Math.min(rule.distance, distance);
}

/** Les erreurs de la clé. Vide = valide. */
export function validateReducesForcedMove(rule, at) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && Number.isFinite(rule.distance) && (rule.distance > 0)
    && (typeof rule.units === "string") && rule.units && Object.keys(rule).every(k => ["distance", "units"].includes(k));
  return ok ? [] : [`${at}reducesForcedMove: { distance, units }`];
}
