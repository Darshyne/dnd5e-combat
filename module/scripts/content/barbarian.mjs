/**
 * Le Barbare du Manuel des joueurs 2024 (SPEC §22), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbbrb…`). Vocabulaire du PHB-fr : Rage, Témérité, Bond instinctif, Rage implacable, Rage persistante, Frénésie (Voie du
 * Berserker), Fureur divine (Voie du Zélateur).
 *
 * Ce que dnd5e fait déjà seul : les effets de la Rage (résistances, bonus aux dégâts de mêlée, Avantage en Force), Défense sans
 * armure, Sens du danger, Déplacement rapide, Instinct sauvage, Rage aveugle, Savoir primitif ; Attaque supplémentaire est dans
 * le budget. Durée et fin de la Rage, Témérité : runtime/barbarian.mjs.
 */

/** Une part de dégâts bonus, une fois par tour, à son tour, sur un coup d'arme ou à mains nues. */
const onceOnOwnTurn = (condition, formula, damageType) => ({
  on: "preDamageRoll", oncePerTurn: true,
  if: { "activity.isAttack": true, "activity.isWeapon": true, "source.onOwnTurn": true, ...condition },
  do: [{ type: "damage", formula, damageType }]
});

/** « Staggered » (Coup chancelant) : Désavantage aux sauvegardes — l'effet est vide dans la donnée. */
const STAGGERED_SAVES = ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.save.roll.mode`, type: "add", value: "-1" }));

export const BARBARIAN = Object.freeze({
  // Rage : l'effet de l'item (G5XZTi4zYTFiHVll), activé par « Expend Rage ». « Elle dure jusqu'à la fin de votre tour suivant » ;
  // on l'entretient en attaquant un ennemi, en imposant une sauvegarde à un ennemi ou par une action Bonus.
  "rage": { rage: { effect: "G5XZTi4zYTFiHVll" } },
  // §301 : Représailles (niveau 14) — « quand vous subissez des dégâts d'une créature à 1,50 m, votre Réaction : une attaque au corps à corps
  // avec une arme ou à mains nues contre elle ».
  "retaliation": { triggers: [{ on: "isDamaged", if: { "target.within": { distance: 5, units: "ft" } }, do: [{ type: "use", target: "source", weapon: true }] }] },
  // Rage persistante (niveau 15) : « elle dure 10 minutes sans que vous ayez rien à faire pour l'entretenir ; elle prend fin plus
  // tôt si vous avez l'état Inconscient (pas seulement Neutralisé) ».
  // C12-a : « quand vous jouez l'initiative, vous pouvez regagner toutes les utilisations de Rage dépensées » — une fois par repos long (l'utilisation
  // de l'item).
  "persistent-rage": { persistentRage: true, regainOnInitiative: { items: ["rage"], uses: true } },
  // Témérité (niveau 2) : choisie au premier jet d'attaque du tour ; jusqu'au début du tour suivant du barbare, ses attaques
  // fondées sur la Force ont l'Avantage, et celles qui le visent aussi.
  "reckless-attack": { reckless: true },
  // C12-e : Coup brutal (niveau 9) — avec Témérité, renoncer à l'Avantage sur une attaque de Force : sur un coup, 1d10 (2d10 au niveau 17 :
  // l'échelle de la sous-classe) du type de l'arme et un effet. Coup puissant : poussée de 4,50 m (le déplacement du barbare vers elle
  // reste au joueur) ; Coup handicapant : -4,50 m de Vitesse jusqu'au début de votre prochain tour (« Hamstrung »). La question, la marque
  // et les effets : runtime/barbarian.mjs.
  // §433 : le SRD de dnd5e 6.1 range les quatre coups sur cet item — « Staggered » (`uacly0JAXLVwAS6y`) et « Sundered »
  // (`Q0ou16II1WEcCdyW`) y sont des effets de Coup brutal, et non plus de Coup brutal amélioré : leurs règles sont redites ici sous ces
  // identifiants. Les options, elles, restent données par Coup brutal amélioré (niveau 13).
  "brutal-strike": {
    brutalStrike: { options: { forceful: { push: { distance: 15, units: "ft" } }, hamstring: { effect: "bg9jWpPRIJ0Q2vPY" } } },
    effectEnds: { bg9jWpPRIJ0Q2vPY: "casterTurnStart", uacly0JAXLVwAS6y: "casterTurnStart", Q0ou16II1WEcCdyW: "casterTurnStart" },
    // « Hamstrung » écrit sur `movement.speed`, valeur dérivée que dnd5e réécrit : la Vitesse au sol. §433 : pas quand l'effet retire
    // déjà la vitesse par `movement.bonus` (SRD de dnd5e 6.1), sinon −30 ft.
    effectChanges: {
      bg9jWpPRIJ0Q2vPY: [{ key: "system.attributes.movement.walk", type: "add", value: "-15", unlessKey: "system.attributes.movement.bonus" }],
      uacly0JAXLVwAS6y: STAGGERED_SAVES
    },
    noOpportunityAttacks: ["uacly0JAXLVwAS6y"],
    triggers: [
      { on: "preDamageRoll", if: { "activity.isAttack": true, "source.hasEffect": "brutal-strike" },
        do: [{ type: "damage", formula: "@scale.barbarian.brutal-strike", damageType: "weapon" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "Q0ou16II1WEcCdyW",
        if: { "target.hasEffect": { item: "brutal-strike", effect: "Q0ou16II1WEcCdyW" }, not: { "target.hasEffectFrom": { item: "brutal-strike", effect: "Q0ou16II1WEcCdyW" } } },
        do: [{ type: "attackBonus", formula: "5" }, { type: "consume", side: "target" }] }
    ]
  },
  // Coup brutal amélioré (13) : Coup chancelant — Désavantage à la prochaine sauvegarde, pas d'attaque d'opportunité, jusqu'au début de
  // votre prochain tour (« Staggered », vide dans la donnée : toutes ses sauvegardes jusque-là, simplification) ; Coup fendant — +5 à la
  // prochaine attaque d'une autre créature contre elle (« Sundered », consommé).
  "improved-brutal-strike": {
    // §433 : l'effet de l'option, sous l'identifiant de cet item (Manuel des joueurs, SRD jusqu'à dnd5e 6.0) ou sous celui de Coup brutal
    // (SRD de dnd5e 6.1) — le premier qu'un item de Coup brutal de l'acteur porte.
    brutalStrike: { options: { staggering: { effect: ["L9N4evZo1jt46dap", "uacly0JAXLVwAS6y"] }, sundering: { effect: ["tUyuyTQGmpUqMcFe", "Q0ou16II1WEcCdyW"] } } },
    effectEnds: { L9N4evZo1jt46dap: "casterTurnStart", tUyuyTQGmpUqMcFe: "casterTurnStart" },
    effectChanges: { L9N4evZo1jt46dap: STAGGERED_SAVES },
    noOpportunityAttacks: ["L9N4evZo1jt46dap"],
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "tUyuyTQGmpUqMcFe",
      if: { "target.hasEffect": "improved-brutal-strike", not: { "target.hasEffectFrom": "improved-brutal-strike" } },
      do: [{ type: "attackBonus", formula: "5" }, { type: "consume", side: "target" }] }]
  },
  // Coup brutal amélioré (17) : deux effets différents par Coup brutal.
  "improved-brutal-strike-2": { brutalStrike: { count: 2 } },
  // Bond instinctif (niveau 7) : « dans le cadre de l'action Bonus pour entrer en Rage, vous pouvez vous déplacer de la moitié de
  // votre Vitesse » — sans rien dire des attaques d'opportunité.
  "instinctive-pounce": { movesAfter: { item: "rage", disengage: false } },
  // §236 : Puissance indomptable (niveau 18) — « si votre total pour un test ou un jet de sauvegarde de Force est inférieur à votre valeur
  // de Force, vous pouvez utiliser cette valeur à la place » (runtime/feats.mjs : le minimum du d20).
  "indomitable-might": { scoreFloor: ["str"] },
  // §299 (repasse C4) — aptitudes tenues par la Rage (`duringRage`, runtime/barbarian.mjs) :
  // Rage aveugle (Berserker) : « immunité à Charmé et Effrayé en Rage ; un tel état cesse quand vous entrez en Rage ».
  "mindless-rage": { duringRage: { enable: ["Y9LOXK6Q4vot2cxi"], cures: ["charmed", "frightened"] } },
  // Rage du prédateur (Cœur sauvage) : l'option choisie ne vaut que pendant la Rage — les copies que ses activités posent tombent avec elle.
  // (L'effet « Rage of the Bear » de l'item est un effet d'activité : dnd5e 6.0.6 ne le transfère jamais, malgré la donnée active.)
  "rage-of-the-wilds": { duringRage: { copiesEnd: true } },
  // Savoir primal : « en Rage, ces tests se font avec la Force ».
  "primal-knowledge": { duringRage: { post: ["ufbJRsGGW3REMmJm"] } },
  // Vitalité de l'Arbre (Arbre-monde) : « quand vous entrez en Rage, vous gagnez des PV temporaires égaux à votre niveau de Barbare ».
  "vitality-of-the-tree": { duringRage: { onStart: "HA6qXLiCmMuEq6r1" } },
  // §295 (repasse) : Présence intimidante — Effrayée « pendant 1 minute » (la donnée : un round), la sauvegarde rejouée à la fin de
  // chacun de ses tours (content/triggers.mjs).
  "intimidating-presence": { effectDurations: { "3LofAPFLZJMQJirN": { seconds: 60 } } },
  // §295 : Aspect des fauves, Hibou — la clé de la donnée n'a pas le préfixe `system.` : pas de vision dans le noir. L'aspect reste au
  // choix du joueur (effet activé à la main) ; seul le changement est réécrit.
  "aspect-of-the-wilds": { effectWhile: { CKLB1VHUlPsgOJxp: { changes: [{ key: "system.attributes.senses.ranges.darkvision", type: "add", value: "60" }] } } },
  // Concentration fanatique (Zélateur 6) : « une fois par Rage active, si vous ratez un jet de sauvegarde, vous pouvez le relancer avec
  // un bonus égal à vos dégâts de Rage, et vous devez utiliser le nouveau jet » — les sauvegardes que le moteur lit.
  "fanatical-focus": { rollBonus: { on: ["save"], reroll: { bonus: "@scale.barbarian.rage-damage", during: "rage" } } },
  // Rage implacable (niveau 11) : « si vous tombez à 0 PV en Rage sans mourir sur le coup, un JS de Constitution DD 10 : réussi,
  // vos PV deviennent le double de votre niveau de Barbare ; le DD augmente de 5 à chaque utilisation » — la sauvegarde de l'item
  // (dnd5eactivity100, DD « 10 + utilisations × 5 »).
  "relentless-rage": { relentless: { activity: "dnd5eactivity100" } },
  // Frénésie (Berserker 3) : « si vous utilisez Témérité en Rage, le premier coup de votre tour avec une attaque de Force inflige
  // autant de d6 supplémentaires que votre bonus de dégâts de Rage, du type de l'arme ».
  "frenzy": { triggers: [onceOnOwnTurn({ all: [{ "source.hasEffect": "rage" }, { "source.hasEffect": "reckless-attack" }] },
    "(@scale.barbarian.rage-damage)d6", "weapon")] },
  // Fureur divine (Zélateur 3) : en Rage, une fois par tour du barbare, son premier coup d'arme ou à mains nues ajoute 1d6 + la
  // moitié de son niveau de Barbare, en nécrotique ou en radiant — radiants ici ; l'item peut le changer dans son flag `triggers`.
  "divine-fury": { triggers: [onceOnOwnTurn({ "source.hasEffect": "rage" }, "1d6 + floor(@classes.barbarian.levels / 2)", "radiant")] }
});
