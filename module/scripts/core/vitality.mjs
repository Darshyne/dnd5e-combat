/**
 * Frappes bénies améliorées (Clerc 14, SRD 5.2), Incantation puissante : « quand vous lancez un sort mineur de clerc et infligez
 * des dégâts à une créature avec lui, vous pouvez insuffler de la vitalité à vous-même ou à une autre créature à 18 m ou moins :
 * elle gagne un nombre de points de vie temporaires égal à deux fois votre modificateur de Sagesse ». Fonctions pures.
 */

/**
 * La règle vaut-elle pour ce lancement ? Un sort mineur de la classe, des dégâts infligés à une créature au moins, et l'option
 * choisie (un des identifiants de `requires` sur la fiche, s'il y en a).
 * @param {{class: string, requires?: string[]}} rule
 * @param {{cantripOfClass: boolean, damaged: number, features: Iterable<string>}} cast
 */
export function vitalityApplies(rule, { cantripOfClass, damaged, features }) {
  if ( !rule || !cantripOfClass || !(damaged > 0) ) return false;
  const has = new Set(features ?? []);
  return !rule.requires?.length || rule.requires.some(id => has.has(id));
}

/**
 * Qui peut recevoir la vitalité : le lanceur d'abord, puis les créatures de son camp à portée, de la plus proche à la plus
 * lointaine, `limit` au plus (la fenêtre reste lisible).
 * @param {Array<{id: string, name: string, distance: number, ally: boolean, self?: boolean}>} tokens
 * @param {number} range   dans l'unité des distances données
 * @param {number} [limit]
 */
export function vitalityRecipients(tokens, range, limit=8) {
  const self = (tokens ?? []).filter(t => t.self);
  const allies = (tokens ?? []).filter(t => !t.self && t.ally && (t.distance <= range)).sort((a, b) => a.distance - b.distance);
  return [...self, ...allies].slice(0, limit);
}

/** Les points de vie temporaires ne se cumulent pas : la valeur ne sert que si elle dépasse ceux que la créature a déjà. */
export function vitalityGain(amount, current) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  return (value > (Number(current) || 0)) ? value : 0;
}
