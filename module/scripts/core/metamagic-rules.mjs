/**
 * Les règles de la Métamagie qui dépendent de la Sorcellerie innée (SRD 5.2). Fonctions pures.
 *  - Métamagie : « vous ne pouvez utiliser qu'une option de Métamagie sur un sort quand vous le lancez, sauf mention contraire ».
 *  - Sorcellerie incarnée (Ensorceleur 7) : « tant que votre Sorcellerie innée est active, vous pouvez utiliser jusqu'à deux de vos
 *    options de Métamagie sur chaque sort que vous lancez ».
 *  - Apothéose arcanique (Ensorceleur 20) : « tant que votre Sorcellerie innée est active, vous pouvez utiliser une option de
 *    Métamagie à chacun de vos tours sans dépenser de points de sorcellerie ».
 */

/**
 * Combien d'options un sort peut porter : la plus haute limite que les règles actives du lanceur donnent, une sinon.
 * @param {Array<{limit?: number, active: boolean}>} rules  les `metamagicRules` des items du lanceur, et si leur effet est actif
 */
export function metamagicLimit(rules) {
  return Math.max(1, ...(rules ?? []).filter(r => r.active && Number.isInteger(r.limit)).map(r => r.limit));
}

/**
 * Cette option peut-elle encore être retenue pour le prochain sort ? Déjà retenue : oui (rien ne change).
 * @param {string[]} held  les options déjà retenues
 * @param {string} kind
 * @param {number} limit
 */
export function mayHold(held, kind, limit) {
  return (held ?? []).includes(kind) || ((held ?? []).length < limit);
}

/**
 * L'option se prend-elle sans rien dépenser ? Une règle `freePerTurn` active, et pas d'option gratuite déjà prise à ce tour (hors
 * combat, pas de tour : toujours).
 * @param {Array<{freePerTurn?: true, active: boolean}>} rules
 * @param {{usedTurn: string|null, turn: string|null}} state  le tour de la dernière option gratuite, le tour en cours
 */
export function freeOption(rules, { usedTurn=null, turn=null }={}) {
  if ( !(rules ?? []).some(r => r.active && (r.freePerTurn === true)) ) return false;
  return (turn === null) || (usedTurn !== turn);
}
