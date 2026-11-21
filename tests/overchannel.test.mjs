/**
 * Surcharge (Magicien, Évocateur 14 — SRD 5.2) : les dégâts maximaux d'un sort de magicien lancé avec un emplacement de niveau 1
 * à 5, au tour où il est lancé ; dès la deuxième utilisation avant un Repos long, un contrecoup nécrotique par niveau
 * d'emplacement.
 */
import { describe, it, expect } from "vitest";
import { overchannelApplies, maximizedDeltas, backlashDice } from "../module/scripts/core/overchannel.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("overchannelApplies", () => {
  const rule = { class: "wizard", maxLevel: 5, die: 12 };
  const cast = (over={}) => ({ isSpell: true, baseLevel: 1, castLevel: 1, sourceClass: "wizard", ...over });
  it("un sort de magicien, lancé avec un emplacement de niveau 1 à 5", () => {
    expect(overchannelApplies(rule, cast())).toBe(true);
    expect(overchannelApplies(rule, cast({ baseLevel: 3, castLevel: 5 }))).toBe(true);
    expect(overchannelApplies(rule, cast({ baseLevel: 3, castLevel: 6 }))).toBe(false);
  });
  it("pas un tour de magie, pas un sort d'une autre classe, pas autre chose qu'un sort", () => {
    expect(overchannelApplies(rule, cast({ baseLevel: 0, castLevel: 0 }))).toBe(false);
    expect(overchannelApplies(rule, cast({ sourceClass: "cleric" }))).toBe(false);
    expect(overchannelApplies(rule, cast({ isSpell: false }))).toBe(false);
    expect(overchannelApplies(null, cast())).toBe(false);
  });
  it("un sort dont la classe n'est pas notée est admis", () => {
    expect(overchannelApplies(rule, cast({ sourceClass: null }))).toBe(true);
  });
});

describe("maximizedDeltas", () => {
  it("chaque part passe au maximum de ses dés ; une part déjà au maximum ne change pas", () => {
    const dice = [{ type: "fire", properties: [], value: 2, faces: 6 }, { type: "fire", properties: [], value: 6, faces: 6 },
      { type: "cold", properties: [], value: 8, faces: 8 }];
    expect(maximizedDeltas(dice)).toEqual([{ type: "fire", properties: [], old: 8, now: 12 }]);
    expect(maximizedDeltas([])).toEqual([]);
  });
});

describe("backlashDice — le contrecoup", () => {
  it("rien la première fois ; 2d12 par niveau la deuxième, 3d12 la troisième", () => {
    expect(backlashDice(1, 5)).toBe(0);
    expect(backlashDice(2, 1)).toBe(2);
    expect(backlashDice(2, 3)).toBe(6);
    expect(backlashDice(3, 3)).toBe(9);
    expect(backlashDice(4, 5)).toBe(20);
  });
});

describe("l'entrée et le schéma", () => {
  it("Surcharge", () => {
    expect(CONTENT["overchannel"]).toEqual({ overchannel: { class: "wizard", maxLevel: 5, die: 12 } });
    expect(validateEntry(CONTENT["overchannel"])).toEqual([]);
    expect(validateEntry({ overchannel: { maxLevel: 5 } }).length).toBe(1);
    expect(validateEntry({ overchannel: { maxLevel: 0, die: 12 } }).length).toBe(1);
  });
});
