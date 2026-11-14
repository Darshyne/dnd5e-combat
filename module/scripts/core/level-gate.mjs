/**
 * §438 : la porte de niveau d'une activité (dnd5e 6.1, `visibility.level { min, max }`) — le Manuel des joueurs 3.0.0 range les versions
 * améliorées d'une aptitude comme des activités du même item, l'une visible jusqu'à un niveau, l'autre à partir du suivant. Pur.
 */

/**
 * L'activité est-elle cachée à ce niveau ? Sans porte (ou bornes nulles), ou sans niveau lisible : non.
 * @param {{min?: number|null, max?: number|null}|null|undefined} range
 * @param {number} level  Le niveau qui compte (`relevantLevel` de dnd5e : la classe nommée, sinon le personnage, le sort pour un sort).
 */
export function hiddenAtLevel(range, level) {
  if ( !range || ((range.min == null) && (range.max == null)) ) return false;
  if ( !Number.isFinite(level) ) return false;
  return ((range.min ?? -Infinity) > level) || ((range.max ?? Infinity) < level);
}
