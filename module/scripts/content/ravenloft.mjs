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
  }

  // Faucheur divin (niveau 17) : Nécromancie renforcée (seconde cible) et Gardien des âmes restent au MJ (§19.9).
});
