/**
 * Règles de sorts (SPEC §16.47), par identifiant dnd5e : valent pour toute créature qui a le sort, PJ ou PNJ, quel que
 * soit le format de l'item (PHB premium 5.x ou compendium 6.x — aucune ne dépend d'un id d'activité).
 */

/** Les effets du sort cessent quand leur porteur attaque, inflige des dégâts ou lance un sort (Invisibilité, PHB 2024). */
export const BREAKS_ON = Object.freeze({
  "invisibility": ["attack", "damage", "spell"],
  // §53 : Potion d'invisibilité — « l'effet prend fin si vous faites un jet d'attaque, infligez des dégâts ou lancez un sort ».
  "potion-of-invisibility": ["attack", "damage", "spell"],
  // §42.2 : Sanctuaire — « le sort prend fin si la créature protégée fait un jet d'attaque, lance un sort ou inflige des
  // dégâts » ; Double illusoire — « prend fin aussitôt après que vous avez fait un jet d'attaque, infligé des dégâts ou
  // lancé un sort ».
  "sanctuary": ["attack", "damage", "spell"],
  "mislead": ["attack", "damage", "spell"]
});

/** Le porteur d'un effet du sort ne peut pas prendre de Réaction (Tentacules de Hadar : jusqu'au début du tour suivant de la cible). */
export const NO_REACTIONS = Object.freeze(["arms-of-hadar"]);

/**
 * §19 : effets posés seulement sur une sauvegarde RÉUSSIE. Rayon affaiblissant — « sur une réussite, la cible a le Désavantage
 * à son prochain jet d'attaque avant le début de votre prochain tour » (« Brief Enfeeblement », yril8uhQgO1dR507, PHB 2.2.0).
 */
export const SAVED_EFFECTS = Object.freeze({
  "ray-of-enfeeblement": ["yril8uhQgO1dR507"],
  // §43.1 : Pétrification — sur une sauvegarde réussie, « sa Vitesse est de 0 jusqu'au début de votre prochain tour »
  // (« Unable to Move », que `effectEnds` fait tomber : content/spell-rules.mjs).
  "flesh-to-stone": ["sFyjp6wt9bjyIl9W"],
  // §43.2 : Danse irrésistible d'Otto — sur une réussite, « elle danse jusqu'à la fin de son prochain tour » (« Short Dance »).
  "ottos-irresistible-dance": ["UhFtBDEZEDpVgz9G"]
});

/** Le sort fait cesser UN de ces états sur sa cible, au choix (Restauration partielle). */
export const CURES = Object.freeze({
  "lesser-restoration": ["blinded", "deafened", "paralyzed", "poisoned"],
  // Protection contre le poison : « si la cible est Empoisonnée, cet état prend fin ».
  "protection-from-poison": ["poisoned"],
  // Ramener un mort : l'état Mort cesse, quelle que soit la façon dont il a été posé (le moteur ne retire de lui-même que
  // la Mort qu'il a posée, quand les PV remontent — adapter/death.mjs).
  "revivify": ["dead"],
  "raise-dead": ["dead"],
  "resurrection": ["dead"],
  "true-resurrection": ["dead"]
});

/** « Elle a l'Avantage au jet de sauvegarde si vous ou vos alliés la combattez. » */
export const FIGHTING_ADVANTAGE = Object.freeze([
  "charm-person", "charm-monster", "dominate-beast", "dominate-person", "dominate-monster"
]);

/**
 * Changer de taille (§16.58, `resize`) : par l'id de l'effet de l'item, le nombre de catégories. Agrandissement/rapetissement
 * — « la taille de la cible augmente (ou diminue) d'une catégorie » ; mêmes ids dans le PHB et dans le SRD de dnd5e 6.
 */
export const SIZE_CHANGES = Object.freeze({
  "enlarge-reduce": { "Wi2E10l7n6Ka8k6u": 1, "NXdtOxX4HvPeodml": -1 }
});

/**
 * Ordre imposé (§16.59, `orders`) : Injonction — « Approche, Lâche, Fuis, Rampe, Halte » (PHB 2024), au choix de l'auteur ;
 * sur une sauvegarde de Sagesse ratée, joué au prochain tour de la cible (runtime/orders.mjs).
 */
export const ORDER_LISTS = Object.freeze({ "command": ["approach", "drop", "flee", "grovel", "halt"] });
