/**
 * Sort renforcé (Métamagie, SRD 5.2) : 1 point de sorcellerie pour relancer jusqu'au modificateur de Charisme de dés de dégâts
 * d'un sort (au moins un) ; les nouveaux jets comptent.
 */
import { describe, it, expect } from "vitest";
import { empoweredPicks, empoweredDeltas } from "../module/scripts/core/empowered.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("empoweredPicks — les dés proposés à la relance", () => {
  const dice = [{ value: 6, faces: 6 }, { value: 1, faces: 6 }, { value: 3, faces: 6 }, { value: 2, faces: 6 },
    { value: 4, faces: 6 }];
  it("les dés à la moitié de leur maximum ou moins, les plus bas d'abord, au plus `count`", () => {
    expect(empoweredPicks(dice, 2)).toEqual([1, 3]);
    expect(empoweredPicks(dice, 5)).toEqual([1, 3, 2]);
  });
  it("au moins un dé, même avec un modificateur nul ou négatif", () => {
    expect(empoweredPicks(dice, 0)).toEqual([1]);
    expect(empoweredPicks(dice, -2)).toEqual([1]);
  });
  it("aucun dé bas : rien à proposer", () => {
    expect(empoweredPicks([{ value: 5, faces: 6 }, { value: 4, faces: 6 }], 3)).toEqual([]);
    expect(empoweredPicks([], 3)).toEqual([]);
  });
  it("à valeur relative égale, le dé aux plus grandes faces", () => {
    expect(empoweredPicks([{ value: 2, faces: 4 }, { value: 5, faces: 10 }], 1)).toEqual([1]);
  });
});

describe("empoweredDeltas — ce qui change à l'agrégat, par part", () => {
  it("les dés d'un même type et des mêmes propriétés sont réunis", () => {
    const picked = [{ type: "fire", properties: ["mgc"], value: 1 }, { type: "fire", properties: ["mgc"], value: 2 },
      { type: "cold", properties: [], value: 1 }];
    expect(empoweredDeltas(picked, [5, 6, 3])).toEqual([
      { type: "fire", properties: ["mgc"], old: 3, now: 11 }, { type: "cold", properties: [], old: 1, now: 3 }]);
  });
  it("un nouveau jet plus bas compte aussi", () => {
    expect(empoweredDeltas([{ type: "fire", properties: [], value: 3 }], [1]))
      .toEqual([{ type: "fire", properties: [], old: 3, now: 1 }]);
  });
});

describe("l'entrée et le schéma", () => {
  it("Sort renforcé", () => {
    expect(CONTENT["empowered-spell"])
      .toEqual({ spellDamageRerolls: { activity: "NkEwJOEFigqsdbZy", count: "max(1, @abilities.cha.mod)" } });
    expect(validateEntry(CONTENT["empowered-spell"])).toEqual([]);
  });
  it("formes refusées", () => {
    expect(validateEntry({ spellDamageRerolls: { activity: "NkEwJOEFigqsdbZy" } }).length).toBe(1);
    expect(validateEntry({ spellDamageRerolls: { activity: "court", count: "1" } }).length).toBe(1);
  });
});
