#!/usr/bin/env node
/**
 * §393 : monte (ou remet en état) l'« Arène des invocations » d'un monde de test, par le connecteur — une scène dédiée aux
 * invocations qui visent : un cadavre à relever (Doigt de mort, Animation des morts sur un corps, darsh-loot), une bête morte qui ne
 * se relève pas, un porteur d'arme (Arme élémentaire, enchantements des objets), une victime à 1 PV. Utilisée par le scénario
 * `invocations-ciblees` et, avec `CIBLEES=1`, par le balayage `balayage-invocations`.
 *
 *   node tools/arene-invocations.mjs     crée ce qui manque, remet acteurs, états et tokens à leur état de référence
 *
 * Positions en cases : `ARENE_INVOCATIONS` (tools/lib/stages.mjs), rétablies par le lanceur de scénarios avant chaque scénario.
 */
import { buildArena } from "./lib/arena.mjs";
import { ARENE_INVOCATIONS } from "./lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.actors.";
const SLOTS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));
const sturdy = { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } };

const ACTORS = {
  "Lanceur": { base: "mmArchmage000000", disposition: 1, system: {
    abilities: { int: { value: 20 }, wis: { value: 20 }, cha: { value: 20 }, con: { value: 14 } },
    attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" }, spellcasting: "int", spell: { level: 20 } },
    spells: SLOTS, details: { cr: 12 } } },
  "Héros": { pack: PHB, base: "phbprgBarbarian0", keepItems: true, disposition: 1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  // Un roturier mort : humanoïde Moyen, 0 PV, état « Mort » — un cadavre pour darsh-loot.
  "Cadavre": { base: "mmCommoner000000", disposition: -1, statuses: ["dead"], system: { attributes: { hp: { value: 0, max: 4 } } } },
  // Un loup mort : une bête, que ni Animation des morts ni Doigt de mort ne relèvent.
  "Bête morte": { base: "mmWolf0000000000", disposition: -1, statuses: ["dead"], system: { attributes: { hp: { value: 0, max: 11 } } } },
  // Une victime vivante à 1 PV : un sort qui tue puis relève (Doigt de mort) la fait passer de vivante à cadavre.
  "Victime": { base: "mmCommoner000000", disposition: -1, system: { ...sturdy, attributes: { ...sturdy.attributes, hp: { value: 1, max: 4 } } } }
};

await buildArena({ stage: ARENE_INVOCATIONS, folder: "DAS · Arène des invocations", flag: "invocations", actors: ACTORS });
