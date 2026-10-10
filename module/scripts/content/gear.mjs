/**
 * Les objets du Manuel des joueurs 2024 (SPEC §49) : ce que dnd5e laisse à la main sur leurs effets.
 */

/** L'effet « Burning. » / « Embrasement » que pose le feu grégeois (même id dans le Manuel des joueurs et sa copie Midi). */
const ALCHEMISTS_FIRE_BURNING = "HL12olRyPOCmmMQ5";

/** Les activités de la trousse de soins dont la portée est « personnelle » (Manuel des joueurs, CPR) : au contact. */
const HEALERS_KIT_ACTIVITIES = ["bsWqOT06BB3Vb2hg", "1jlZEx9V2TITY9OT"];

/** Flamme nue : lumière orangée qui vacille (animation « torch » du cœur). */
const FLAME = { type: "torch", speed: 2, intensity: 2 };

/** §121 : une heure (torche, bougie) ; une flasque d'huile, 6 heures. */
const HOUR = { value: 1, units: "hour" };
const OIL = { value: 6, units: "hour" };
const BULLSEYE = { bright: 60, dim: 120, units: "ft", angle: 53, burn: OIL, fuel: "oil" };

export const GEAR = Object.freeze({
  // §52 : sources de lumière portées (Manuel des joueurs 2024) — rayon de la lumière vive, puis rayon EXTÉRIEUR de la faible.
  // Bougie : « Lumière vive sur 1,50 m et faible sur 1,50 m de plus » ; Lampe : « vive sur 4,50 m et faible sur 9 m de plus » ;
  // Lanterne à capuchon : « vive sur 9 m et faible sur 9 m de plus » (le capuchon baissé, Lumière faible sur 1,50 m : au MJ) ;
  // Lanterne sourde : « vive dans un cône de 18 m et faible sur 18 m de plus » ; Torche : « vive sur 6 m et faible sur 6 m de plus ».
  // §121 : « une torche brûle 1 heure », « une bougie allumée […] pendant 1 heure » (l'unité brûlée disparaît) ; « une lampe [une
  // lanterne] brûle de l'Huile » — « une flasque d'Huile brûle 6 heures […] ; pas forcément d'affilée : on peut l'éteindre et la
  // rallumer jusqu'à 6 heures en tout ». La torche et la bougie aussi s'éteignent et se rallument (choix de l'utilisateur, 2026-10-10).
  "candle": { carriedLight: { bright: 5, dim: 10, units: "ft", animation: FLAME, burn: HOUR } },
  "lamp": { carriedLight: { bright: 15, dim: 45, units: "ft", animation: FLAME, burn: OIL, fuel: "oil" } },
  "lantern-hooded": { carriedLight: { bright: 30, dim: 60, units: "ft", burn: OIL, fuel: "oil" } },
  // La lanterne sourde : « lantern-bullseye » dans le Manuel des joueurs, « bullseye-lantern » dans le SRD de dnd5e.
  "lantern-bullseye": { carriedLight: BULLSEYE },
  "bullseye-lantern": { carriedLight: BULLSEYE },
  "torch": { carriedLight: { bright: 20, dim: 40, units: "ft", animation: FLAME, burn: HOUR } },
  // Boîte à amadou : « l'utiliser pour allumer une Bougie, une Lampe, une Lanterne ou une Torche […] prend une action Bonus ».
  "tinderbox": { kindles: true },
  // §54 : Huile — une sauvegarde de Dextérité ratée laisse la cible huilée pendant 1 minute ; tant qu'elle l'est, des dégâts de
  // feu lui en infligent 5 de plus (runtime/oil.mjs). L'activité « Lancer »
  // ne pose aucun effet : la marque « oiled » le porte.
  "oil": { triggers: [{ on: "failedSave", do: [{ type: "mark", mark: "oiled", label: "Marque.Huile", seconds: 60 }] }] },
  // §53 : Élixir de santé — « les états suivants prennent fin : Aveuglé, Assourdi, Paralysé et Empoisonné » ; Potion de vitalité —
  // « supprime tout niveau d'Épuisement et met fin à l'état Empoisonné » (les dés de vie au maximum pendant 24 h : au MJ).
  "elixir-of-health": { curesAll: ["blinded", "deafened", "paralyzed", "poisoned"] },
  "potion-of-vitality": { curesAll: ["exhaustion", "poisoned"] },
  // §53 : Croissance — « l'effet "agrandir" du sort Agrandissement/rapetissement » ; Rapetissement — « l'effet "rapetisser" »
  // (effets du sort, mêmes ids dans le Manuel des joueurs et le SRD : content/spells.mjs, SIZE_CHANGES).
  "potion-of-growth": { potionEffect: "Wi2E10l7n6Ka8k6u" },
  // « Quand vous buvez cette potion, vous pouvez lancer la version de niveau 3 du sort Amitié avec les animaux » : sur une bête.
  "potion-of-animal-friendship": { castTargets: true },
  // Héroïsme : « 10 points de vie temporaires […] et l'effet du sort Bénédiction » — l'effet « Blessed » (dHNT1jBXfvYuNH16) de l'item
  // n'est pas relié à l'activité de soin (gdyQxFAXH5PM9qy5) dans les données du Guide : on l'y relie.
  "potion-of-heroism": { choice: { pool: { gdyQxFAXH5PM9qy5: ["dHNT1jBXfvYuNH16"] } } },
  // Vol : « une vitesse de vol égale à votre Vitesse […] et vous pouvez faire du vol stationnaire » — l'effet « Flyer » ne donne que
  // le vol stationnaire. Escalade : « une vitesse d'escalade égale à votre Vitesse » — l'effet « Climber » n'a aucun changement.
  "potion-of-flying": { effectChanges: { GIybtF2qEmtPCOZj: [{ key: "system.attributes.movement.fly", type: "upgrade", value: "@walk" }] } },
  "potion-of-climbing": { effectChanges: { D6fYii3nkDC4Tsbi: [{ key: "system.attributes.movement.climb", type: "upgrade", value: "@walk" }] } },
  "potion-of-diminution": { potionEffect: "NXdtOxX4HvPeodml" },
  // Trousse de soins : une action Utiliser et une utilisation stabilisent une créature Inconsciente à 0 PV, sans test de
  // Médecine — l'activité utilitaire de dnd5e ne fait rien (runtime/stabilize.mjs).
  // Sa portée est « personnelle » dans le Manuel des joueurs et chez CPR alors qu'elle vise une créature : au contact.
  "healers-kit": {
    stabilizes: true,
    ranges: Object.fromEntries(HEALERS_KIT_ACTIVITIES.map(id => [id, { value: 5, units: "ft" }])),
    targets: { unaffectedIf: { any: [{ "target.atZero": false }, { "target.isDead": true }] } }
  },
  // Feu grégeois : « la cible […] subit 1d4 dégâts de feu et commence à brûler » ; En feu (glossaire du Manuel des joueurs) :
  // 1d4 de feu au début de chacun de ses tours, jusqu'à ce qu'elle se jette À terre et se roule au sol par une action pour
  // l'étouffer — l'effet posé n'a pas l'état `burning` de dnd5e (simple nom) :
  // la règle est portée par l'effet de l'item. Le feu éteint par une autre créature, l'eau ou l'immersion : au MJ.
  "alchemists-fire": {
    triggers: [{ on: "startOfTurn", via: "effect", fromEffect: ALCHEMISTS_FIRE_BURNING,
      do: [{ type: "damage", to: "bearer", formula: "1d4", damageType: "fire" }] }],
    actionEnds: { [ALCHEMISTS_FIRE_BURNING]: { by: "bearer", status: "prone" } }
  }
});
