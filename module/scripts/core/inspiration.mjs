/**
 * §148 : faut-il proposer un dé ajouté après le jet (Inspiration bardique) ? Ce qui se calcule sans Foundry.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * « Quand la créature rate un Test d20, elle peut lancer le dé et l'ajouter. » Sans seuil connu (test libre), la question se pose
 * toujours (« Raté ? ») ; avec un seuil : rien sur une réussite, rien non plus quand même le plus haut résultat du dé n'y suffirait
 * (le dé ne se gâche pas).
 * @param {{total: number, needed: number|null, max: number|null}} c  `max` : le plus haut résultat du dé (6 pour 1d6).
 * @returns {"offer"|"success"|"hopeless"}
 */
export function inspirationOffer({ total, needed, max }) {
  if ( !Number.isFinite(needed) ) return "offer";
  if ( total >= needed ) return "success";
  if ( Number.isFinite(max) && (total + max < needed) ) return "hopeless";
  return "offer";
}
