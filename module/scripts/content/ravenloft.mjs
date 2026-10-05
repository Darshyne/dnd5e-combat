/**
 * Options de joueur de Ravenloft: The Horrors Within (SPEC §19.9), module premium `dnd-ravenloft-horrors-within` 1.0.1. Ses
 * items n'ont pas d'identifiant dnd5e : ils sont reconnus par leur source de compendium (content/sources.mjs), jamais par leur
 * nom (traduit par Babele). Ids d'activités et d'effets relevés dans le pack `options` du module.
 *
 * Ce que dnd5e fait déjà seul : Vision dans le noir, résistance nécrotique (Trace de non-mort), vitesse d'escalade (Pattes
 * d'araignée) ; les sorts du domaine ; Retour à la vie (Épargner les mourants en action Bonus : activité
 * « cast » de l'item) ; le Désavantage aux sauvegardes du maudit (changements de l'effet de Chemin vers la tombe).
 */

/** Attraction de la mort : une fois par tour, 1d4 nécrotiques de plus, puis 1d6 à partir du niveau 11 de clerc. */
const pullOfDeath = (formula, atLeast11) => ({
  on: "preDamageRoll", oncePerTurn: true,
  if: {
    // Un sort ou une attaque qui touche déclenche le bonus ; un soin n'est pas visé (les soins passent aussi par ce jet).
    "activity.type": ["attack", "save", "damage"],
    any: [{ "activity.isAttack": true }, { "activity.isSpell": true }],
    "target.wounded": true,
    ...(atLeast11 ? { "source.classLevelAtLeast": { class: "cleric", level: 11 } }
      : { not: { "source.classLevelAtLeast": { class: "cleric", level: 11 } } })
  },
  do: [{ type: "damage", formula, damageType: "necrotic" }]
});

/** Sentinelle au seuil de la mort : la moitié des dégâts de l'attaque, et plus de coup critique. */
const sentinel = [{ type: "use" }, { type: "halve" }, { type: "uncrit" }];

export const RAVENLOFT = Object.freeze({
  /* Dhampir */

  // Morsure vampirique : mordre une cible vivante (ni Créature artificielle ni Mort-vivant) permet au dhampir soit de récupérer
  // les PV égaux aux dégâts perforants, soit de garder ce montant en bonus pour son prochain test ou jet d'attaque de la minute ;
  // autant d'usages que le bonus de maîtrise par repos long (les utilisations de l'item). L'effet « Strengthened Attack or Check » de l'item
  // (j3fPDd7Xi1nx6Xk4) porte le modificateur de Constitution : le moteur le pose avec le montant réel.
  "vampiric-bite": { empower: { damageType: "piercing", effect: "j3fPDd7Xi1nx6Xk4", excludeTypes: ["construct", "undead"] } },

  /* Domaine de la Tombe (clerc) */

  // Cercle de mortalité. Attraction de la mort : 1d4, 1d6 au niveau 11 de clerc (la valeur d'échelle de l'item est rangée sous
  // son identifiant — donc sous son nom traduit : `@scale.circle-of-mortality` ne se lit pas en français). Retour à la vie : les
  // dés de soin au maximum pour une créature à 0 PV, avec un sort ou une Conduit divin.
  "circle-of-mortality": { triggers: [pullOfDeath("1d4", false), pullOfDeath("1d6", true)], healsDownedMax: true },

  // Chemin vers la tombe : le maudit (effet mQRlujPiGJbczcyZ) a le Désavantage à ses jets d'attaque (l'effet du module se dit
  // non automatisé) ; quand le clerc ou un allié qu'il voit touche le maudit, le clerc peut lever la malédiction pour lui
  // infliger son niveau de clerc en dégâts, nécrotiques ou radiants.
  "path-to-the-grave": {
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "mQRlujPiGJbczcyZ", if: { "source.hasEffect": "path-to-the-grave" }, do: [{ type: "disadvantage" }] }],
    discharge: { effect: "mQRlujPiGJbczcyZ", formula: "@classes.cleric.levels", damageTypes: ["necrotic", "radiant"], sees: true }
  },

  // Sentinelle au seuil de la mort : en Réaction, quand le clerc ou une créature En sang qu'il voit à 18 m est touché, les dégâts
  // de l'attaque sont divisés par deux et un coup critique redevient un coup normal — utilisations : modificateur de Sagesse par repos long (celles de l'item).
  "sentinel-at-deaths-door": {
    triggers: [
      { on: "isHit", do: sentinel },
      { on: "allyIsHit", if: { "target.bloodied": true, "target.nearSelf": { distance: 60, units: "ft" }, "self.seesTarget": true }, do: sentinel }
    ]
  },

  // Faucheur divin (niveau 17) : Nécromancie renforcée (seconde cible) et Gardien des âmes restent au MJ (§19.9).

  /* §93 : Dons sombres — « juste après avoir fait un Test d20 et obtenu un 1 sur le d20 », la sauvegarde de l'item (DD 13 + maîtrise,
     sur soi), l'état sur un échec. */

  // Anatomie aberrante, Chair déformante : Constitution ou Étourdi jusqu'à la fin de votre prochain tour.
  "aberrant-anatomy": { onNatural1: { activity: "3gsyr1hLvSFRy6e8" } },
  // Âme en écho, Échos intrusifs : Constitution ou Neutralisé (Vitesse réduite de moitié) jusqu'à la fin de votre prochain tour.
  "echoing-soul": { onNatural1: { activity: "b0YlEc0swnlB4R93" } },
  // Ombre vivante, Volonté funeste : Sagesse ou Neutralisé jusqu'au début de votre prochain tour (la table « Volonté de l'ombre » : au MJ).
  "living-shadow": { onNatural1: { activity: "zitGmITljzBRXTkm" } },
  // Être symbiotique, Dessein symbiotique : Charisme ou Charmé 1d12 heures ; « chaque fois que vous subissez des dégâts, vous pouvez
  // rejouer cette sauvegarde ». Ce que le symbiote ordonne : au MJ.
  // §94 : Symbiose entretenue — « quand vous ratez une sauvegarde, par une Réaction, dépensez un dé de vie, lancez-le et ajoutez-le »
  // (l'activité au plus grand dé de vie restant).
  "symbiotic-being": {
    onNatural1: { activity: "R2FWsJAlulJ2Mqpa" },
    rollBonus: { activity: "hcNtMh74vYh07G7k", on: ["save"] },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "m06eYs6ZVerPzasy", do: [{ type: "resave" }] }]
  },
  // Murmures rassemblés : Voix d'outre-tombe au 1 naturel (Sagesse) ; §94 Cri surnaturel — « quand vous êtes touché par un jet
  // d'attaque, par une Réaction, ajoutez votre bonus de maîtrise à votre CA contre cette attaque » (comme la Parade du MM).
  "gathered-whispers": {
    onNatural1: { activity: "sGkDp5LeqKujiO7s" },
    triggers: [{ on: "isHit", do: [{ type: "use", activity: "UXNlglsSGecujPQD" }, { type: "penalty", formula: "@prof" }] }]
  },
  // Guetteurs, Guetteurs incessants : Sagesse ou Désavantage aux Tests d20 pendant 1 minute, sauvegarde rejouée à la fin de chacun de
  // vos tours. L'effet « Paranoïa » de la donnée met le Désavantage aux tests et aux sauvegardes ; les jets d'attaque (des Tests d20
  // aussi) : `preAttackRoll`.
  "watchers": {
    onNatural1: { activity: "udHg4QeQBIVL4UJ1" },
    triggers: [
      { on: "endOfTurn", via: "effect", fromEffect: "Off49UhYxymqhOrO", do: [{ type: "resave" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "Off49UhYxymqhOrO", if: { "source.hasEffect": "watchers" }, do: [{ type: "disadvantage" }] }
    ],
    // §94 : Soupçon accru — « à l'action Chercher, lancez 1d4 et ajoutez-le ».
    searchBonus: { formula: "1d4" }
  },

  /* §94 : dons (Survivant, Marcheur des brumes, Œil vif) et espèces (Né-de-nouveau, Lupin). */

  // Survivant, Se ressaisir : une sauvegarde ratée pour éviter ou finir Charmé ou Effrayé — par une Réaction, + bonus de maîtrise (une
  // fois par repos long : les utilisations de l'activité). Hypervigilance (relancer une initiative de 9 ou moins) : au MJ.
  "survivor-ravenloft": { rollBonus: { activity: "9wAIIWcBr8lwp7Rm", on: ["save"], statuses: ["charmed", "frightened"] } },
  // Marcheur des brumes, Marche des brumes : « quand vous subissez des dégâts, par une Réaction, téléportez-vous jusqu'à 4,50 m » (la
  // visée de la téléportation s'ouvre après la réaction). Sur une sauvegarde ratée contre Agrippé ou Entravé : au MJ.
  "mist-walker": {
    triggers: [{ on: "isDamaged", do: [{ type: "use", activity: "nJFQptHB2QvgTiCA" }] }],
    teleport: { distance: 15, units: "ft", activity: "nJFQptHB2QvgTiCA" }
  },
  // Œil vif : l'Avantage aux tests de l'action Chercher (l'action Étudier : au MJ).
  "sharp-eye-ravenloft": { searchBonus: { advantage: true } },
  // Né-de-nouveau, Savoir d'une vie passée : « quand vous ratez un test de caractéristique, ajoutez 1d6 » — proposé sitôt le test
  // lancé (le DD n'est pas connu du moteur).
  "knowledge-from-a-past-life": { rollBonus: { activity: "3JqLx79wBu1mq9WP", on: ["check"] } },
  // Lupin, Hurlement : « chaque créature de votre choix à 4,50 m » (la zone de la donnée ; les alliés épargnés) — Sagesse ou Désavantage
  // aux jets d'attaque et sauvegardes jusqu'au début de votre prochain tour (l'effet de la donnée ne fait que les sauvegardes).
  "lupin-howl": {
    zoneAffects: "enemy",
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "TCo6F7H9E70wJeB5", if: { "source.hasEffect": "lupin-howl" }, do: [{ type: "disadvantage" }] }]
  },
  // Lupin, Bond féroce : un coup à mains nues qui touche permet AUSSI la Bousculade (une fois par tour) — sa sauvegarde (Force ou
  // Dextérité), À terre sur un échec ; repousser de 1,50 m à la place : au MJ.
  "feral-pounce": { hitRider: { save: "rW3uaSjC7gS5YQnM", item: "feral-pounce", oncePerTurn: true } }
});
