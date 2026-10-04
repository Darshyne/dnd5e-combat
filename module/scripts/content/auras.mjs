/**
 * Auras passives livrées avec le module (adapter/auras.mjs). Un item peut corriger la sienne
 * dans `flags["dnd5e-combat"].aura` ; sans `effect`, c'est le premier effet transféré de l'item
 * qui est copié sur les alliés.
 */

/** « Avantage aux jets d'attaque et de sauvegarde » : une source d'avantage par caractéristique (AdvantageModeField de dnd5e 6). */
const ADVANTAGE_ATTACKS_AND_SAVES = ["str", "dex", "con", "int", "wis", "cha"].flatMap(a => [
  { key: `system.abilities.${a}.attack.roll.mode`, value: "1", type: "add" },
  { key: `system.abilities.${a}.save.roll.mode`, value: "1", type: "add" }
]);

/** « Avantage à tous les jets de sauvegarde ». */
const ADVANTAGE_SAVES = ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.save.roll.mode`, value: "1", type: "add" }));

export const AURAS = Object.freeze({
  // §86 : Aura sacrée (PHB 2024) — « vous émettez une aura (Émanation de 9 m) : les créatures de votre choix y ont l'Avantage à
  // tous leurs jets de sauvegarde » ; l'effet « Holy Protection » de la donnée est vide et « Create Aura » n'a pas de gabarit.
  // Le Désavantage des attaquants et la sauvegarde d'un Fiélon ou d'un Mort-vivant : content/triggers.mjs.
  "holy-aura": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft", changes: ADVANTAGE_SAVES },
  // Vu en jeu le 2026-09-20 : l'item du module premium PHB 2.2.0 (format 5.x) n'a AUCUNE activité,
  // contrairement à celui du système 6.0. Le rayon ne peut donc pas toujours se lire sur un
  // gabarit : on le prend sur l'échelle de classe (10 ft, 30 ft au niveau 18), 10 ft à défaut.
  "aura-of-protection": { includeSelf: false, affects: "ally", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft" },
  // §16.47 : Passage sans trace (PHB 2024) — « vous et chaque créature de votre choix à 9 m ou moins de vous » : une aura
  // tenue tant que le sort l'est (`whileActive`) ; dnd5e ne pose son +10 qu'une fois, sur les cibles du lancement.
  "pass-without-trace": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft" },
  // §18.12 : auras à bonus du Monster Manual, dont l'effet est absent, vide ou faux — les changements sont déclarés ici.
  // Autorité (Capitaine et Seigneur de guerre hobgobelins) : le hobgobelin lui-même et ses alliés à 3 m — aucun effet dans le MM.
  "aura-of-authority": { includeSelf: true, affects: "ally", changes: ADVANTAGE_ATTACKS_AND_SAVES },
  // Commandement des morts-vivants (Chevaliers de la mort) : les morts-vivants qu'il désigne, sauf lui-même, à 18 m — effet
  // « Adv: Attacks & Saves » sans aucun changement dans le MM.
  "marshal-undead": { affects: "ally", types: ["undead"], changes: ADVANTAGE_ATTACKS_AND_SAVES },
  // Aura de bravoure (Chevalier en quête) : immunité à Charmé et Effrayé — l'effet du MM pose AUSSI ces deux états.
  "aura-of-bravery": { includeSelf: true, affects: "ally", changes: [
    { key: "system.traits.ci.value", value: "charmed", type: "add" },
    { key: "system.traits.ci.value", value: "frightened", type: "add" }
  ] }
});
