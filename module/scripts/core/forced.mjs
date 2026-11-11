/**
 * §408 (issue #44, lot 1) : ce qu'un joueur a passé outre en confirmant la fenêtre de légalité. Pur : aucune dépendance à Foundry.
 */

/**
 * Les raisons vraiment passées outre. « Utiliser ma Réaction » hors de son tour (une attaque d'opportunité) règle les soucis de budget :
 * ce n'est pas forcer. Les autres raisons (portée, état, vue…) restent passées outre. Doublons retirés, ordre gardé.
 * @param {object} choice
 * @param {string[]} choice.lines         Toutes les raisons de la fenêtre.
 * @param {string[]} [choice.budgetLines] Celles qui viennent du budget du tour (tour, action dépensée…).
 * @param {string} choice.action          Le bouton choisi : "go", "reaction", autre (renoncé).
 * @returns {string[]}  vide quand rien n'a été passé outre.
 */
export function forcedReasons({ lines, budgetLines=[], action }) {
  if ( (action !== "go") && (action !== "reaction") ) return [];
  const skip = (action === "reaction") ? new Set(budgetLines) : new Set();
  return [...new Set((lines ?? []).filter(l => l && !skip.has(l)))];
}
