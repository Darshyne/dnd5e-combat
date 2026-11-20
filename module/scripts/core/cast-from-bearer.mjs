/**
 * Lancer ses sorts depuis l'espace d'une créature liée (clé de contenu `castFromBearer`) : Regard de deux esprits — « vous pouvez
 * lancer des sorts comme si vous étiez dans votre espace ou dans celui de l'autre créature si vous êtes tous deux à 18 m ou moins
 * l'un de l'autre ». Le lien est l'effet de l'item porté par la créature touchée. Fonctions pures.
 */

/** Le lien vaut-il ? La créature porte l'effet, sur la même scène, à cette distance ou moins du lanceur (mêmes unités). */
export function linkHolds(measured, limit) {
  return Number.isFinite(measured) && Number.isFinite(limit) && (measured <= limit + 1e-6);
}

/** Les erreurs de la clé. Vide = valide. */
export function validateCastFromBearer(rule, at) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && Number.isFinite(rule.distance) && (rule.distance > 0)
    && (typeof rule.units === "string") && rule.units && Object.keys(rule).every(k => ["distance", "units"].includes(k));
  return ok ? [] : [`${at}castFromBearer: { distance, units }`];
}
