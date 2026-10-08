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
const piloted = (distance, onCast, more={}) => ({
  initiative: "after", endsSpell: true,
  pilot: { cost: "bonus", distance, units: "ft", ...(onCast ? { onCast } : {}), ...(more.pilot ?? {}) },
  ...(more.summon ?? {})
});
const hand = piloted(60, "command", { pilot: { occupies: false }, summon: { endsAtZero: true } });

export const SUMMONS = Object.freeze({
  "summon-aberration": after, "summon-beast": after, "summon-celestial": after, "summon-construct": after,
  "summon-dragon": after, "summon-elemental": after, "summon-fey": after, "summon-fiend": after, "summon-undead": after,
  "animate-objects": after, "giant-insect": after,
  // §107 : `familiar` — actions de base sauf l'attaque, vision, poche dimensionnelle. Le Pacte de la chaîne (occultiste, PHB
  // 2024) porte ses propres activités d'invocation « Find Familiar » : l'invocation a pour origine l'item du pacte.
  "find-familiar": { initiative: "own", familiar: true },
  "pact-of-the-chain": { initiative: "own", familiar: true },
  // Compagnon sauvage (druide, PHB 2024, §16.39) : « vous lancez Appel de familier sans composantes matérielles » ; « le
  // familier dure un nombre d'heures égal à la moitié de votre niveau de druide » — pas d'autre fin (dnd5e : `inst`).
  "wild-companion": { initiative: "own", familiar: true, lasts: { value: "floor(@classes.druid.levels / 2)", units: "hour" } },
  "spiritual-weapon": piloted(20, "use"),
  "flaming-sphere": piloted(30, null, { summon: { pulse: { item: "flames", radius: 5, units: "ft" } } }),
  "bigbys-hand": hand,
  "arcane-hand": hand,
  "invoke-duplicity": {
    initiative: "none", mimic: true, endsIfIncapacitated: true, castFrom: true,
    pilot: { cost: "bonus", distance: 30, units: "ft", occupies: false, tether: { distance: 120, units: "ft" } }
  },
  // Invocation d'animaux (PHB 2.2.0) : une meute d'esprits de taille G, sans substance, que le lanceur peut déplacer de 9 m
  // quand il bouge à son tour ; dès qu'elle arrive à 3 m d'une créature visible, ou qu'une telle créature entre à 3 m d'elle
  // ou y termine son tour, cette créature peut devoir faire une sauvegarde de Dextérité, au plus une fois par tour (§16.22).
  "conjure-animals": {
    initiative: "none", endsSpell: true,
    pilot: { cost: "free", distance: 30, units: "ft", occupies: false },
    pulse: { item: "pack-damage", radius: 10, units: "ft", on: ["turnEnd", "enter", "moves"], affects: "enemy" }
  },
  "arcane-eye": { initiative: "none", endsSpell: true, pilot: { cost: "bonus", distance: 30, units: "ft", occupies: false } },
  "dancing-lights": { initiative: "none", endsSpell: true, pilot: {
    cost: "bonus", distance: 60, units: "ft", occupies: false, shared: true, cluster: { distance: 20, units: "ft" }, leash: true
  } }
});
