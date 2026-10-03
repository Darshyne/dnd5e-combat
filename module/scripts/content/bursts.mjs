/**
 * Éclats (SPEC §16.19, clé `burst` de core/content.mjs) : une fois l'attaque tranchée — touchée **ou ratée** —, le moteur
 * joue une activité sœur de l'item sur la cible et sur chaque créature à `radius` d'elle. Texte vérifié dans dnd5e 6
 * (spells24) et le PHB 2.2.0 :
 *  - Couteau de glace : que l'attaque touche ou non, l'éclat éclate ; la cible et ses voisins à 1,50 m font une sauvegarde
 *    de Dextérité contre 2d6 dégâts de froid — activité « Shard Explosion » (`dnd5eactivity100`).
 *  - Métal brûlant (§16.21) : « si une créature qui tient ou porte l'objet en subit les dégâts, elle doit réussir un jet
 *    de sauvegarde de Constitution ou lâcher l'objet » — après « Cast and Heat » ou « Reheat », sur la cible seule
 *    (`radius: 0`), si elle a subi des dégâts.
 */

export const BURSTS = Object.freeze({
  "ice-knife": { activity: "dnd5eactivity100", radius: 5, units: "ft" },
  "heat-metal": { activity: "dnd5eactivity000", radius: 0, units: "ft", from: ["2jWlvr2titPfBMEm", "YPEmwJHX7g68307N"] }
});

/**
 * Sorts qui se relancent tant qu'ils durent (§16.21, clé `recast`) : Appel de la foudre — « tant que le sort dure, vous
 * pouvez faire une action Magie pour appeler de nouveau la foudre ». Carreau ensorcelé et Métal brûlant n'en ont pas
 * besoin : dnd5e 6 leur donne une activité à l'action Bonus, sans emplacement.
 */
export const RECASTS = Object.freeze(["call-lightning"]);

/** « Chaque créature à 1,50 m du point » (§16.21, `bolt`) : Appel de la foudre, dont dnd5e fait poser le nuage (60 ft). */
export const BOLTS = Object.freeze({ "call-lightning": { radius: 5, units: "ft" } });

/** Zones qui obscurcissent fortement (§16.24, `obscures`) : Nappe de brouillard — « la sphère est une zone à visibilité nulle ». */
export const OBSCURES = Object.freeze(["fog-cloud"]);

/** Soins au maximum (§16.24, `healMax`) : Lueur d'espoir — « chaque fois qu'une cible regagne des PV, elle en regagne le maximum ». */
export const HEAL_MAX = Object.freeze(["beacon-of-hope"]);

/** Répliques (§16.25, `duplicates`) : Image miroir — les trois effets « Duplicate » du sort sont les répliques. */
export const DUPLICATES = Object.freeze(["mirror-image"]);

/**
 * Avantage aux sauvegardes contre un état (§16.25, `saveAdvantage`) : Ascendance féerique — « pour éviter ou faire cesser
 * Charmé ». `"magic"` : contre les sorts et les effets magiques — Résistance à la magie, 76 créatures du MM (§18.9).
 */
export const SAVE_ADVANTAGES = Object.freeze({ "fey-ancestry": ["charmed"], "magic-resistance": ["magic"],
  // Protection contre le poison : « Avantage aux jets de sauvegarde pour éviter ou faire cesser l'état Empoisonné » — le porteur
  // de l'effet du sort, pas le lanceur (adapter/saves.mjs, saveAdvantageAgainst).
  "protection-from-poison": ["poisoned"] });

/**
 * Ennemi tombé (§16.25, `onFell`) : Bénédiction du Ténébreux — « quand vous réduisez un ennemi à 0 PV […], ou si quelqu'un
 * d'autre réduit à 0 PV un ennemi dans un rayon de 3 m de vous » ; activité « heal » (PV temporaires) de dnd5e 6.
 */
/**
 * Attaque en action Bonus après un coup (§16.26, `bonusAttack`) : Maître d'armes lourdes, « Taille » — un critique au corps à
 * corps, ou une créature mise à 0 PV par l'arme, ouvre aussitôt une attaque de plus avec la même arme, en action Bonus
 * (PHB 2.2.0, feats).
 */
export const BONUS_ATTACKS = Object.freeze({ "great-weapon-master": { after: ["critical", "felled"], melee: true } });

/**
 * Sort réactif (§16.26, `reactiveSpell`) : Mage de guerre — à la place de l'attaque d'opportunité qu'une créature provoque en
 * sortant de l'allonge, la réaction peut servir à lui lancer un sort, à condition qu'il se lance en une action et ne vise
 * qu'elle (PHB 2.2.0).
 */
export const REACTIVE_SPELLS = Object.freeze(["war-caster"]);

/**
 * Plusieurs projectiles par lancement (§16.27, `projectiles`) ; dnd5e 6 n'en fait qu'un, le nombre n'est que dans la
 * description (spells24 : « [[2 + @item.level]] », « [[@item.level + 1]]{Total Rays} », « [[(floor((@details.level+1)/6)+1)]] »).
 */
export const PROJECTILES = Object.freeze({
  "magic-missile": { count: "2 + @item.level", attack: false },
  "scorching-ray": { count: "@item.level + 1", attack: true },
  "eldritch-blast": { count: "floor((@details.level + 1) / 6) + 1", attack: true }
});

/**
 * Rebond (§16.27, `leap`) : Orbe chromatique — un double (ou mieux) parmi les d8 de dégâts fait sauter l'orbe vers une autre
 * cible choisie à 9 m de la première, avec un nouveau jet d'attaque et de nouveaux dégâts ; le nombre de sauts est borné par
 * le niveau de l'emplacement, et chaque créature n'est visée qu'une fois par lancement.
 */
export const LEAPS = Object.freeze({ "chromatic-orb": { radius: 30, units: "ft", max: "@item.level" } });

export const ON_FELL = Object.freeze({ "dark-ones-blessing": { activity: "p3YSnjGDlLIbiLpC", radius: 10, units: "ft" } });

/** Activité proposée au début du tour du lanceur (§16.21, `atTurnStart`) : Aura de vitalité, « Start of Turn Heal ». */
export const TURN_STARTS = Object.freeze({
  "aura-of-vitality": { activity: "0vYjMbBcXaMfGWR2" },
  // §19 : Force fantasmagorique — « à chacun de vos tours, ce fantasme peut infliger 2d8 dégâts psychiques à la cible »,
  // l'activité « Dégâts fantasmatiques » (QCUpctimdMH6E6F8) du PHB 2.2.0.
  "phantasmal-force": { activity: "QCUpctimdMH6E6F8" }
});
