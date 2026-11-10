/**
 * Créatures invoquées qui entrent au combat (SPEC §16.13, clé `summon` de core/content.mjs). Le rattachement à la
 * concentration, lui, vaut pour toute invocation d'un sort à concentration, sans rien déclarer.
 * Texte vérifié dans l'extraction du PHB 2.2.0 (work/phb-en) : l'invocation prend l'Initiative du lanceur et agit aussitôt
 * après lui (`after`), ou tire sa propre Initiative et joue son propre tour (`own`).
 *
 * Objets pilotés (§16.15, B19) : ils se rangent juste après le lanceur, leur tour est sauté, et le lanceur les commande
 * pendant le sien. Textes 2024 (dnd5e 6 spells24, PHB 2.2.0) :
 *  - Arme spirituelle : « vous pouvez immédiatement faire une attaque » ; « par une action Bonus lors de vos tours
 *    suivants, vous pouvez déplacer la force de 6 m et répéter l'attaque » ;
 *  - Sphère de feu : « par une action Bonus, vous pouvez déplacer la sphère de 9 m » ; « toute créature qui termine
 *    son tour à 1,50 m de la sphère fait un jet de sauvegarde de Dextérité » (`pulse`, item « Flames » de la sphère) ;
 *  - Main de Bigby (`bigbys-hand` au PHB, `arcane-hand` au SRD) : « quand vous lancez le sort et par une action Bonus
 *    lors de vos tours suivants, vous pouvez déplacer la main de 18 m puis » choisir un effet ; « la main n'occupe pas
 *    son espace » ; « si elle tombe à 0 point de vie, le sort prend fin ».
 *  - Œil magique : « par une action Bonus, vous pouvez déplacer l'œil de 9 m dans n'importe quelle direction » ; invisible,
 *    invulnérable ;
 *  - Lumières dansantes : l'action Bonus les déplace de 18 m au plus, dans la portée ; elles restent à 6 m les unes des
 *    autres et s'éteignent hors de portée.
 *  Ni l'un ni l'autre n'agit : ils n'entrent pas au combat (`none`) et ne gênent personne.
 *  - Invoquer la duplicité (Domaine de la Duperie, PHB 2.2.0) : un double illusoire du clerc, sans substance, qui ne bloque
 *    pas sa case ; il disparaît si le clerc est Neutralisé ; le clerc peut lancer ses sorts depuis la case du double ; une
 *    action Bonus déplace le double de 9 m vers une case libre et visible, à 36 m au plus du clerc. Pas de concentration.
 * `endsSpell` : à la demande de l'utilisateur (2026-09-25), retirer l'objet met fin au sort — pour ces trois seulement,
 * pas pour les Convocations.
 */

const after = { initiative: "after" };
// §259 : « elle disparaît lorsqu'elle tombe à 0 point de vie ou lorsque le sort prend fin » (les sorts d'invocation du PHB 2024).
const vanishing = { ...after, vanishesAtZero: true };
const piloted = (distance, onCast, more={}) => ({
  initiative: "after", endsSpell: true,
  pilot: { cost: "bonus", distance, units: "ft", ...(onCast ? { onCast } : {}), ...(more.pilot ?? {}) },
  ...(more.summon ?? {})
});
const hand = piloted(60, "command", { pilot: { occupies: false }, summon: { endsAtZero: true } });

export const SUMMONS = Object.freeze({
  "summon-aberration": vanishing, "summon-beast": vanishing, "summon-celestial": vanishing, "summon-construct": vanishing,
  "summon-dragon": vanishing, "summon-elemental": vanishing, "summon-fey": vanishing, "summon-fiend": vanishing, "summon-undead": vanishing,
  // §390 (issue #38, décision de l'utilisateur) : Animation des objets sans objet à viser ; la taille (TG, G, M, P, TP — une seule par
  // lancement, simplification) et le nombre au choix, jusqu'au `count` de son profil (« floor(@attributes.spell.mod / 3) » pour TG…).
  "animate-objects": { ...after, untargeted: true, chooseCount: true }, "giant-insect": vanishing,
  // §385 (issue #38, décision de l'utilisateur) : Création de morts-vivants sans corps à viser ; le lanceur choisit combien de goules
  // (« jusqu'à trois », plus au-dessus), ou de blêmes / nécrophages / momies selon le niveau. Elles jouent à leur propre Initiative.
  "create-undead": { initiative: "own", untargeted: true, chooseCount: true },
  // §387 (issue #38, demande de l'utilisateur) : Animation des morts de même — sans os ni cadavre à viser, Squelette ou Zombi, et
  // combien : les données ne le disent que dans la cible du sort (« @item.level * 2 - 5 » : 1 au niveau 3, +2 par niveau). Ses
  // données ne posent rien (`summon.prompt` faux) : PLACES_SUMMONS. Un cadavre ciblé reste relevé à sa place par un voisin (§118).
  "animate-dead": { initiative: "own", untargeted: true, chooseCount: "@item.level * 2 - 5" },
  // §259 : « s'il tombe à 0 point de vie, le sort prend fin » — sans concentration, le serviteur disparaît.
  "unseen-servant": { initiative: "none", vanishesAtZero: true },
  // §107 : `familiar` — actions de base sauf l'attaque, vision, poche dimensionnelle. Le Pacte de la chaîne (occultiste, PHB
  // 2024) porte ses propres activités d'invocation « Find Familiar » : l'invocation a pour origine l'item du pacte.
  "find-familiar": { initiative: "own", familiar: true },
  "pact-of-the-chain": { initiative: "own", familiar: true },
  // Compagnon sauvage (druide, PHB 2024, §16.39) : « vous lancez Appel de familier sans composantes matérielles » ; « le
  // familier dure un nombre d'heures égal à la moitié de votre niveau de druide » — pas d'autre fin (dnd5e : `inst`).
  // §305 : règle 2024 — « le familier dure jusqu'à la fin de votre prochain Repos long » (la durée en heures était celle de 2014).
  "wild-companion": { initiative: "own", familiar: true, endsOnLongRest: true },
  // §305 : Engagement du maître des chaînes — ses activités d'invocation du familier : un familier comme celui du Pacte.
  "investment-of-the-chain-master": { initiative: "own", familiar: true },
  // §305 : Créatures fantasmagoriques (Illusionniste 6) — l'invocation lancée par l'aptitude suit la règle du sort (après le lanceur,
  // disparition à 0 PV).
  "phantasmal-creatures": vanishing,
  // §305 : Compagnon primitif (Seigneur des bêtes 3) et Compagnon réanimé (Ravenloft) — « agit à votre tour, juste après vous » ; une
  // nouvelle convocation remplace l'ancienne ; « s'il… vous mourez, il disparaît ». C12-c : « la seule action qu'elle prend est Esquiver, à
  // moins que vous ne la commandiez par une action Bonus » — l'activité « Command » (`commanded`). (Sacrifier une attaque pour la commander :
  // au joueur.)
  "primal-companion": { initiative: "after", replaces: true, vanishesWithCaster: true, commanded: { activity: "Jtr7GXnCHb85xHg8" } },
  "reanimated-companion": { initiative: "after", replaces: true, vanishesWithCaster: true },
  "spiritual-weapon": piloted(20, "use"),
  // §403 : Liane avide — « faites une attaque de sort au corps à corps contre une créature à 9 m de la liane… Par une action Bonus à vos
  // tours suivants, vous pouvez refaire l'attaque » : la liane, posée (`placesSummons`), ne bouge pas (commande de 0 m) ; son attaque
  // part au lancement (`onCast: "use"`), puis par une action Bonus ; elle n'occupe pas d'espace. La traction et l'Agrippé : l'item
  // « Vine Attack » (content/triggers.mjs).
  "grasping-vine": piloted(0, "use", { pilot: { occupies: false } }),
  // §402 : « si vous la faites rouler sur une créature, celle-ci fait la sauvegarde » — approchée comme la meute : la sphère qui arrive à
  // 1,50 m d'une créature en la déplaçant (`moves`), en plus de la fin de tour (une fois par tour et par créature). §403 : « et la
  // sphère s'arrête de bouger ce tour-ci » (`stopsOnContact`).
  "flaming-sphere": piloted(30, null, { summon: { pulse: { item: "flames", radius: 5, units: "ft", on: ["turnEnd", "moves"], stopsOnContact: true } } }),
  "bigbys-hand": hand,
  "arcane-hand": hand,
  "invoke-duplicity": {
    initiative: "none", mimic: true, endsIfIncapacitated: true, castFrom: true,
    pilot: { cost: "bonus", distance: 30, units: "ft", occupies: false, tether: { distance: 120, units: "ft" } }
  },
  // Invocation d'animaux (PHB 2.2.0) : une meute d'esprits de taille G, sans substance, que le lanceur peut déplacer de 9 m
  // quand il bouge à son tour ; dès qu'elle arrive à 3 m d'une créature visible, ou qu'une telle créature entre à 3 m d'elle
  // ou y termine son tour, cette créature peut devoir faire une sauvegarde de Dextérité, au plus une fois par tour (§16.22).
  // §368 : « une créature que vous voyez » — une créature que le lanceur ne voit pas (Invisible…) est épargnée.
  "conjure-animals": {
    initiative: "none", endsSpell: true,
    pilot: { cost: "free", distance: 30, units: "ft", occupies: false },
    pulse: { item: "pack-damage", radius: 10, units: "ft", on: ["turnEnd", "enter", "moves"], affects: "enemy", seenBy: "caster" }
  },
  // §159 (relevé des sorts, lot 3). Appel de destrier : « partage votre initiative et agit juste après vous ». Épée de Mordenkainen :
  // « attaque à l'apparition, puis par une action Bonus, se déplace de 9 m et attaque » (« Move and Attack »). Invocation de fée :
  // l'esprit attaque à l'apparition, puis par une action Bonus « se téléporte de 9 m et attaque » (le pilote le déplace : la
  // téléportation est approchée par un déplacement, sans attaque d'opportunité). Gardien de la foi : « un ennemi qui arrive à 3 m
  // du gardien pour la première fois d'un tour ou y commence son tour » fait la sauvegarde de « Guarded Area » (§259 : il disparaît
  // quand il a infligé 60 dégâts au total, `vanishesAfterDamage`). Chien de garde : « au début de votre tour, le chien tente de
  // mordre un ennemi à 1,50 m de lui ».
  // §230 : « Si vous avez déjà un destrier de ce sort, il est remplacé par le nouveau » ; la monture volante (« Fly 60 ft. (requires
  // level 4+ spell) », note Foundry : activité « Summon Flying Steed » à partir d'un emplacement de niveau 4) — l'incantation gratuite
  // de Fidèle destrier (paladin niveau 5, au niveau 2 du sort) ne la donne pas.
  // §259 : « la monture disparaît si elle tombe à 0 point de vie ».
  // §305 : « le destrier disparaît… si vous mourez ».
  "find-steed": { ...vanishing, replaces: true, vanishesWithCaster: true, minLevels: { o4YsONnsS8rOOEaS: 4 } },
  // §164 : Invocation d'élémentaire — « quand une créature entre dans l'espace de l'esprit ou commence son tour à 1,50 m de lui », la
  // sauvegarde de l'élément (8d8, Entravée) ; un item par élément (air, terre, feu, eau). L'esprit n'agit pas. (« Une seule créature
  // Entravée à la fois » : au MJ.)
  "conjure-elemental": { initiative: "none", pulse: { item: ["air-element", "earth-element", "fire-element", "water-element"], radius: 5, units: "ft", on: ["enter", "turnStart"], affects: "enemy" } },
  "mordenkainens-sword": piloted(30, "use"),
  "conjure-fey": piloted(30, "use"),
  // §402 : Monture fantôme — « si elle subit des dégâts, elle disparaît » (le sort continue, comme une invocation qui disparaît).
  "phantom-steed": { initiative: "none", vanishesWhenHurt: true },
  "guardian-of-faith": { initiative: "none", vanishesAfterDamage: 60, pulse: { item: "guarded-area", radius: 10, units: "ft", on: ["enter", "turnStart"], affects: "enemy" } },
  "mordenkainens-faithful-hound": { initiative: "none", pulse: { item: "bite", radius: 5, units: "ft", on: ["casterTurnStart"], affects: "enemy" } },
  "arcane-eye": { initiative: "none", endsSpell: true, pilot: { cost: "bonus", distance: 30, units: "ft", occupies: false } },
  "dancing-lights": { initiative: "none", endsSpell: true, pilot: {
    cost: "bonus", distance: 60, units: "ft", occupies: false, shared: true, cluster: { distance: 20, units: "ft" }, leash: true
  } }
});

/**
 * §109 : sorts du PHB 2.2.0 dont l'activité d'invocation a `summon.prompt: false` (dnd5e documents/activity/summon.mjs:68 : la case
 * « placer les invocations » part décochée) alors que le sort invoque toujours. Sans la fenêtre de dnd5e (§68), rien n'était placé
 * (retour de séance, 2026-10-08 : la meute d'Invocation d'animaux n'apparaissait pas). Restent décochés, à dessein, ceux où
 * l'invocation est facultative : Lumière et Flamme éternelle (sur un objet), Animation des morts (relever un cadavre).
 */
export const PLACES_SUMMONS = Object.freeze(["conjure-animals", "summon-undead", "grasping-vine", "phantom-steed", "project-image", "animate-dead"]);

/**
 * §394 : les seules invocations qui se visent d'un clic. Depuis le §394, une activité « summon » ne passe plus en visée d'après sa
 * cible dans les données : le Tapis volant et la Driftglobe s'y désignent eux-mêmes (« object »), la Bouteille d'éfrit dit
 * « creature » pour une case libre — le moteur attendait un clic sur une cible qui n'existe pas, et l'objet ne s'utilisait pas.
 * Doigt de mort, lui, relève la créature tuée : sa cible est un cadavre, qu'un voisin relève à sa place (§118, darsh-loot).
 */
export const TARGETED_SUMMONS = Object.freeze(["finger-of-death"]);
