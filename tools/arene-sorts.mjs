#!/usr/bin/env node
/**
 * Monte (ou remet en état) l'« Arène des sorts » d'un monde de test, par le connecteur : une scène plate et vide, et des acteurs
 * d'essai faits pour le balayage des sorts et des aptitudes (`tools/scenarios/balayage-sorts.mjs`, `balayage-aptitudes.mjs`).
 * Pourquoi pas l'« Arène de test » (§83) : quinze tokens y entourent le Zombi, une zone en touche une demi-douzaine, et ce sont les
 * fiches de PJ, que prêter 391 sorts salirait. Ici, un **Lanceur** PNJ sans aucun item (lanceur de niveau 20, emplacements 9 à
 * chaque niveau, carac. d'incantation à 20 : les sorts prêtés sont les seuls qu'il porte), des cibles à 999 PV qui ne meurent pas,
 * et rien d'autre à portée d'une zone.
 *
 *   node tools/arene-sorts.mjs          crée ce qui manque, remet acteurs et tokens à leur état de référence
 *
 * Idempotent : un acteur ou la scène se retrouve par son nom ; rien hors de son dossier n'est touché. Positions en cases :
 * `ARENE_SORTS` (tools/lib/stages.mjs), que le lanceur de scénarios rétablit avant chaque scénario de cette scène.
 */
import { buildArena } from "./lib/arena.mjs";
import { ARENE_SORTS } from "./lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";
const PHB = "Compendium.dnd-players-handbook.actors.";
const FOLDER = "DAS · Arène des sorts";
const SLOTS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));

/**
 * Les acteurs d'essai : base du Bestiaire, items retirés (rien d'autre que ce qu'un scénario prête), puis retouches. Le Héros, un
 * personnage (le Barbare pré-tiré du Manuel, `keepItems`) : ce qu'un PNJ n'a pas — classe et échelles (dégâts de Rage), Rage, armes,
 * budget de tour d'un PJ (Concentration fanatique, Athlète remarquable, Inspiration de combat, scénario `passifs-releve`).
 */
const ACTORS = {
  "Lanceur": { base: "mmArchmage000000", disposition: 1, system: {
    abilities: { int: { value: 20 }, wis: { value: 20 }, cha: { value: 20 }, con: { value: 14 } },
    attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" }, spellcasting: "int", spell: { level: 20 } },
    spells: SLOTS, details: { cr: 12 } } },
  "Héros": { pack: PHB, base: "phbprgBarbarian0", keepItems: true, disposition: 1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Allié": { base: "mmCommoner000000", disposition: 1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Ennemi au contact": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible voisine": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible lointaine": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Mort-vivant": { base: "mmZombie00000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Grande cible": { base: "mmOgre0000000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Créature artificielle": { base: "mmAnimatedArmor0", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } }
};

await buildArena({ stage: ARENE_SORTS, folder: FOLDER, flag: "sorts", actors: ACTORS });
