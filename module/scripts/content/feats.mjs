/**
 * Les dons du Manuel des joueurs 2024 (SPEC §129 ; relevé complet : prive/RELEVE_DONS.md), module premium `dnd-players-handbook`
 * 2.2.0, pack `feats`. Déjà ailleurs : Combat avec arme à deux mains, Combat avec arme de lancer, Interception (content/fighter.mjs),
 * Maître d'armes lourdes, Télékinésiste (content/triggers.mjs), Mage de guerre (content/bursts.mjs), Faveur du voyage dimensionnel
 * (content/teleports.mjs).
 *
 * Ce que dnd5e fait seul : la maîtrise à l'initiative de Vigilant (`initiativeAlert`), l'attaque améliorée de Bagarreur de tavernes (1d4 +
 * For, relance des 1 dans sa formule) et sa maîtrise des armes improvisées (`tavernBrawlerFeat`), les Soins de combat de Guérisseur
 * (activités, relance des 1 dans leur formule), les points de Chanceux (utilisations de l'item).
 */
export const FEATS = Object.freeze({
  // Bagarreur de tavernes : « quand vous touchez une créature d'une Attaque à mains nues dans le cadre de l'action Attaquer à votre tour,
  // vous pouvez lui infliger les dégâts et la repousser de 1,50 m. Une fois par tour. » Proposé au coup, comme une faveur.
  "tavern-brawler": { hitRider: { push: { distance: 5, units: "ft" }, unarmed: true, oncePerTurn: true } },
  // Sauvagerie martiale : « une fois par tour, quand vous touchez avec une arme, lancez ses dés de dégâts deux fois, gardez l'un ou
  // l'autre » (runtime/feats.mjs).
  "savage-attacker": { savageAttacker: true },
  // Chanceux : « quand vous lancez un d20 pour un Test d20, 1 point de chance pour l'Avantage » — proposé après le jet (attaque ratée,
  // sauvegarde ratée demandée par le moteur, test de caractéristique) : le d20 relancé, le meilleur gardé. « Quand une créature lance un
  // d20 pour une attaque contre vous, 1 point pour lui imposer le Désavantage » — avant son jet, sans coûter la Réaction (`free`).
  "lucky": {
    rollBonus: { activity: "DEX2YgxfqdMse2bT", on: ["attack", "save", "check"], luck: true },
    triggers: [{ on: "isAttacked", free: true, do: [{ type: "use", activity: "jBTnM51FdGwjlBuK", target: "source" }, { type: "disadvantage" }] }]
  },
  // Vigilant : l'échange d'initiative avec un allié, juste après le jet (runtime/roll-bonus.mjs).
  "alert": { initiativeSwap: true },
  // Guérisseur : « quand vous lancez un dé pour les PV que rend un sort… vous pouvez relancer un 1 » (runtime/feats.mjs).
  "healer": { healingRerolls: true },

  // §130 — effets que les données appliquent sans leur condition (runtime/effect-while.mjs).
  // Défense : « tant que vous portez une armure légère, intermédiaire ou lourde, +1 à la CA ».
  "defense": { effectWhile: { W0ObItz7sS8ZJ09Y: { if: { armor: ["light", "medium", "heavy"] } } } },
  // Duel : « quand vous maniez une arme de corps à corps dans une main et aucune autre arme, +2 aux dégâts avec elle ».
  "dueling": { effectWhile: { VEodDUQvYPHhl0Ya: { if: { oneHanded: true } } } },
  // Maître des armures lourdes : « touché par une attaque alors que vous portez une armure lourde » — la réduction, en armure lourde.
  "heavy-armor-master": { effectWhile: { bADQON2o52cOL6WI: { if: { armor: ["heavy"] } } } },
  // Maître des armures intermédiaires : « en armure intermédiaire, +3 au lieu de +2 de Dextérité à la CA si vous avez 16 ou plus en
  // Dextérité » — soit +1 à la CA ; la clé des données (`system.attributes.bonus`) n'existe pas.
  "medium-armor-master": { effectWhile: { r6D3Ach1DcRanNcj: { if: { armor: ["medium"], abilityAtLeast: { dex: 16 } },
    changes: [{ key: "system.attributes.ac.bonus", type: "add", value: "1" }] } } },
  // Rôdeur furtif, Brouillard de guerre : « l'Avantage aux tests de Dextérité (Discrétion) de l'action Se cacher pendant un combat » —
  // en combat (le moteur ne sait pas quel test est celui de Se cacher).
  "skulker": { effectWhile: { "6moNnOl0izLMgVNl": { if: { inCombat: true } } } },

  // §131 — dons de tir. Tireur d'élite : « vos attaques à distance avec une arme ignorent l'abri partiel et l'abri aux trois quarts ;
  // être à 1,50 m d'un ennemi ne vous impose pas le Désavantage ; attaquer à longue portée non plus ».
  "sharpshooter": { rangedFeat: { kind: "weapon", cover: true, closeCombat: true, longRange: true } },
  // Expert des arbalètes : pas de Désavantage au contact avec une arbalète ; le modificateur aux dégâts de l'attaque supplémentaire de la
  // propriété Légère avec une arbalète Légère. Le Rechargement n'est imposé ni par dnd5e ni par le moteur.
  "crossbow-expert": { rangedFeat: { kind: "crossbow", closeCombat: true, offhandModifier: true } },
  // Sniper de sorts : les jets d'attaque des sorts ignorent l'abri partiel et aux trois quarts, pas de Désavantage au contact, et +18 m à
  // la portée d'un sort d'au moins 3 m qui demande un jet d'attaque.
  "spell-sniper": { rangedFeat: { kind: "spell", cover: true, closeCombat: true, spellRange: { value: 60, units: "ft" } } },

  // §132 — coups. Cogneur : « une fois par tour, quand vous touchez une créature d'une attaque qui inflige des dégâts contondants, vous
  // pouvez la déplacer de 1,50 m si elle n'a pas plus d'une taille de plus que vous » (proposé au coup) ; « un coup critique contondant :
  // les jets d'attaque contre elle ont l'Avantage jusqu'au début de votre prochain tour ».
  "crusher": { hitRider: { push: { distance: 5, units: "ft" }, damageType: "bludgeoning", sizeAbove: 1, oncePerTurn: true },
    critMark: { damageType: "bludgeoning", side: "against" } },
  // Perforeur : un dé relancé une fois par tour (le meilleur gardé), un dé de plus au critique perforant (runtime/feats.mjs).
  "piercer": { piercer: true },
  // Trancheur : « une fois par tour… réduire sa Vitesse de 3 m jusqu'au début de votre prochain tour » (effet « Slashed » du Manuel,
  // proposé au coup) ; « un coup critique tranchant : Désavantage à ses jets d'attaque jusqu'au début de votre prochain tour ».
  "slasher": { hitRider: { effect: "JX3Krr0wbWihJ1RP", damageType: "slashing", oncePerTurn: true },
    effectEnds: { JX3Krr0wbWihJ1RP: "casterTurnStart" }, critMark: { damageType: "slashing", side: "by" } },
  // Chargeur : « si vous vous déplacez d'au moins 3 m en ligne droite vers une cible juste avant de la toucher au corps à corps… +1d8
  // aux dégâts » — proposé au coup de corps à corps, une fois par tour (au joueur de juger la charge) ; la poussée de 3 m, l'autre choix
  // de la règle, et le Foncer amélioré ne sont pas joués.
  "charger": { hitRider: { damage: "54afnEMKfBkQaByQ", melee: true, oncePerTurn: true, weaponDamage: true } },
  // Lutteur : « l'Avantage aux jets d'attaque contre une créature que vous agrippez ». Frapper et saisir, Lutteur rapide : non joués.
  "grappler": { triggers: [{ on: "preAttackRoll", if: { "target.grappledBySource": true }, do: [{ type: "advantage" }] }] },
  // Maître des boucliers, Coup de bouclier : « si vous touchez une créature à 1,50 m d'une arme de corps à corps dans le cadre de l'action
  // Attaquer, vous pouvez la frapper de votre bouclier équipé : sauvegarde de Force ou À terre » (l'autre choix, la pousser, n'est pas
  // proposé) ; une fois par tour. Interposer le bouclier : lot suivant.
  "shield-master": { hitRider: { save: "VjSe0vA0dmGhNDAA", melee: true, shield: true, oncePerTurn: true } },
  // Combat à mains nues : ses deux attaques (1d6 / 1d8 sans arme ni bouclier) sont celles de dnd5e ; « au début de chacun de vos tours,
  // 1d4 dégâts contondants à une créature que vous agrippez » (runtime/feats.mjs).
  "unarmed-fighting": { grappleDamage: { formula: "1d4", damageType: "bludgeoning" } }
});
