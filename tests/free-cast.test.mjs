/**
 * Intervention divine (Clerc 10, SRD 5.2) : un sort de clerc de niveau 5 ou moins, qui ne se lance pas par une Réaction, lancé dans
 * la même action sans emplacement.
 */
import { describe, it, expect } from "vitest";
import { freeCastApplies, freeCastHeld } from "../module/scripts/core/free-cast.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("freeCastApplies — le sort qui prend le lancement gratuit", () => {
  const rule = { activity: "dnd5eactivity000", maxLevel: 5, class: "cleric" };
  const spell = (over={}) => ({ isSpell: true, level: 3, activation: "action", sourceClass: "cleric", ...over });
  it("un sort de clerc de niveau 1 à 5, par une action ou une action Bonus", () => {
    expect(freeCastApplies(rule, spell())).toBe(true);
    expect(freeCastApplies(rule, spell({ level: 5, activation: "bonus" }))).toBe(true);
  });
  it("pas au-delà du niveau 5, pas un tour de magie, pas une Réaction, pas un sort d'une autre classe", () => {
    expect(freeCastApplies(rule, spell({ level: 6 }))).toBe(false);
    expect(freeCastApplies(rule, spell({ level: 0 }))).toBe(false);
    expect(freeCastApplies(rule, spell({ activation: "reaction" }))).toBe(false);
    expect(freeCastApplies(rule, spell({ sourceClass: "wizard" }))).toBe(false);
    expect(freeCastApplies(rule, spell({ isSpell: false }))).toBe(false);
  });
  it("un sort dont la classe n'est pas notée est admis", () => {
    expect(freeCastApplies(rule, spell({ sourceClass: null }))).toBe(true);
  });
});

describe("freeCastHeld — tant que la retenue vaut", () => {
  it("jusqu'à la fin du tour où elle a été prise", () => {
    expect(freeCastHeld({ turn: "c.1.0", at: 0 }, { turn: "c.1.0" })).toBe(true);
    expect(freeCastHeld({ turn: "c.1.0", at: 0 }, { turn: "c.1.1" })).toBe(false);
    expect(freeCastHeld({ turn: "c.1.0", at: 0 }, { turn: null })).toBe(false);
  });
  it("hors combat, une minute", () => {
    expect(freeCastHeld({ turn: null, at: 100 }, { turn: null, now: 150 })).toBe(true);
    expect(freeCastHeld({ turn: null, at: 100 }, { turn: null, now: 200 })).toBe(false);
    expect(freeCastHeld(null, {})).toBe(false);
  });
});

describe("l'entrée et le schéma", () => {
  it("Intervention divine", () => {
    expect(CONTENT["divine-intervention"]).toEqual({ freeCast: { activity: "dnd5eactivity000", maxLevel: 5, class: "cleric" } });
    expect(validateEntry(CONTENT["divine-intervention"])).toEqual([]);
    expect(validateEntry({ freeCast: { activity: "dnd5eactivity000" } }).length).toBe(1);
    expect(validateEntry({ freeCast: { activity: "court", maxLevel: 5 } }).length).toBe(1);
  });
});
