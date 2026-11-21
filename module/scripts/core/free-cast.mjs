/**
 * Intervention divine (Clerc 10, SRD 5.2) : « par une action Magie, choisissez un sort de clerc de niveau 5 ou moins qui ne se
 * lance pas par une Réaction ; dans la même action, vous le lancez sans dépenser d'emplacement ni avoir besoin de composantes
 * matérielles ». L'activité de l'aptitude retient le lancement gratuit ; le sort suivant qui convient le prend. Fonction pure.
 */

/**
 * Ce sort prend-il le lancement gratuit retenu ?
 * @param {{maxLevel: number, class?: string}} rule
 * @param {{isSpell: boolean, level: number, activation?: string|null, sourceClass?: string|null}} spell  `level` : le niveau du
 *   sort ; `sourceClass` vide : inconnu, admis
 */
export function freeCastApplies(rule, { isSpell, level, activation=null, sourceClass=null }) {
  if ( !rule || !isSpell || !(level >= 1) || (level > rule.maxLevel) || (activation === "reaction") ) return false;
  return !rule.class || !sourceClass || (sourceClass === rule.class);
}

/** Le lancement retenu vaut-il encore ? Jusqu'à la fin du tour où il a été pris ; hors combat, une minute. */
export function freeCastHeld(held, { turn=null, now=0 }={}) {
  if ( !held ) return false;
  if ( held.turn || turn ) return held.turn === turn;
  return (now - (Number(held.at) || 0)) <= 60;
}
