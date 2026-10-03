/**
 * Changer de taille (SPEC §16.58) : « la taille de la cible augmente d'une catégorie — de Moyenne à Grande, par exemple »
 * (Agrandissement/rapetissement). Les catégories dans l'ordre de dnd5e (`CONFIG.DND5E.actorSizes.orderedKeys` : tiny, sm,
 * med, lg, huge, grg), bornées aux extrêmes.
 */

/**
 * @param {string} size             catégorie actuelle
 * @param {number} steps            crans (+1 : une catégorie au-dessus)
 * @param {string[]} orderedKeys    catégories, de la plus petite à la plus grande
 * @returns {string|null}  la nouvelle catégorie, ou null si la taille actuelle est inconnue
 */
export function shiftSize(size, steps, orderedKeys) {
  const i = orderedKeys.indexOf(size);
  if ( i < 0 ) return null;
  return orderedKeys[Math.min(orderedKeys.length - 1, Math.max(0, i + steps))];
}
