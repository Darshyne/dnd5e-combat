/**
 * §147 : la fuite par la Réaction (Murmures dissonants) — ce qui se calcule sans Foundry.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * Les écarts à essayer, en cases, du plus loin au plus près : « aussi loin que sa Vitesse le permet » — l'écart actuel plus la
 * Vitesse en cases, puis un de moins à chaque fois qu'un mur ou un obstacle rend l'écart visé injoignable, jusqu'à un de plus que
 * l'écart actuel.
 * @param {number} from   L'écart actuel (0 : au contact).
 * @param {number} cells  La Vitesse, en cases.
 * @returns {number[]}
 */
export function fleeGaps(from, cells) {
  const out = [];
  for ( let gap = from + cells; gap > from; gap-- ) out.push(gap);
  return out;
}
