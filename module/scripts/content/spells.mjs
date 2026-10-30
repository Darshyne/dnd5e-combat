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
export const NO_REACTIONS = Object.freeze(["arms-of-hadar", "confusion", "fetid-cloud", "slow"]);

/** §77 : « une action ou une action Bonus lors de son tour, pas les deux » — Nuage fétide (Dretch, Monster Manual 2024), Lenteur. */
export const ACTION_OR_BONUS = Object.freeze(["fetid-cloud", "slow"]);
/** §267 : « elle ne peut faire qu'une attaque si elle prend l'action Attaquer » (Lenteur). */
export const SINGLE_ATTACK = Object.freeze(["slow"]);
/** §283 : « si elle lance un sort avec une composante somatique, il y a 25 % de chances que le sort échoue » (Lenteur). */
export const SPELL_FAILURES = Object.freeze({ "slow": { chance: 25, component: "somatic" } });
/** §269 : « la cible ne peut ni attaquer ni lancer de sorts » (Forme gazeuse). */
export const NO_ATTACKS_OR_SPELLS = Object.freeze(["gaseous-form"]);
/** §284 : « ne peut pas lancer de sorts ni prendre l'action Magie » (Aliénation). */
export const NO_SPELLS = Object.freeze(["befuddlement"]);
/**
 * §284 : « vous savez toujours où se trouve la cible ; elle ne peut pas se Cacher de vous, et l'état Invisible ne lui apporte
 * rien contre vous » (Épine mentale) — vaut pour le lanceur seul.
 */
export const KNOWN_TO_ORIGIN = Object.freeze(["mind-spike"]);

/**
 * §285 : sorts de contrôle (runtime/control.mjs). Terreur — « lâche ce qu'elle tient » et, Effrayée, « prend l'action Foncer et
 * s'éloigne de vous à chacun de ses tours » ; Mauvais œil, Paniqué (Kj1GwWXD5k0Zen75) — de même, et « si elle arrive à 18 m ou plus
 * de vous, à un endroit d'où elle ne peut pas vous voir, cet effet prend fin ». Confusion (VxmsgUz9OIUet6WC, vide dans la donnée) :
 * ni action Bonus ni Réaction, 1d10 au début de chacun de ses tours. Couronne du dément (0zixJ8ZoYFgSJtMV) : l'attaque imposée avant
 * de se déplacer, et « à vos tours suivants, vous devez prendre l'action Magie pour garder le contrôle, ou le sort prend fin ».
 * Fou rire de Tasha : « elle ne peut pas mettre fin à l'état À terre » (`keepsProne`).
 */
export const CONTROL = Object.freeze({
  "fear": { panic: { drop: true } },
  "eyebite": { panic: { effect: "Kj1GwWXD5k0Zen75", endsAt: { distance: 60, units: "ft" } } },
  "confusion": { confusion: "VxmsgUz9OIUet6WC", noBonus: "VxmsgUz9OIUet6WC" },
  "crown-of-madness": { forcedAttack: "0zixJ8ZoYFgSJtMV", upkeep: true },
  "tashas-hideous-laughter": { keepsProne: true },
  "hideous-laughter": { keepsProne: true }
});

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
  // §160 : Restauration suprême — « … fait cesser l'un de ces effets : un niveau d'Épuisement, Charmé, Pétrifié » (la malédiction, la
  // réduction de caractéristique ou de PV max : au MJ).
  "greater-restoration": ["charmed", "petrified", "exhaustion"],
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
/** §147 : la cible qui rate sa sauvegarde fuit le lanceur par sa Réaction (runtime/flee.mjs). */
export const FLEE_ON_FAILED_SAVE = Object.freeze({ "dissonant-whispers": { fleeOnFailedSave: true } });

export const ORDER_LISTS = Object.freeze({ "command": ["approach", "drop", "flee", "grovel", "halt"] });
