import { describe, it, expect } from "vitest";
import { slotLeft, plainCost, resourceIssues, isShort } from "../module/scripts/core/resources.mjs";

// §410 (issue #44, lot 3) : ce qui manque à une utilisation — jugé avant dnd5e, forçable.
const spells = {
  spell1: { value: 0, max: 2 }, spell2: { value: 0, max: 1 }, spell3: { value: 1, max: 1 },
  pact: { value: 0, max: 1, level: 2 }
};

describe("slotLeft", () => {
  it("un emplacement de ce niveau ou plus haut", () => {
    expect(slotLeft(spells, 1)).toBe(true);    // le 3e niveau reste
    expect(slotLeft(spells, 3)).toBe(true);
    expect(slotLeft(spells, 4)).toBe(false);
  });

  it("l'emplacement demandé seulement", () => {
    expect(slotLeft(spells, 1, "spell1")).toBe(false);
    expect(slotLeft(spells, 1, "spell3")).toBe(true);
  });

  it("le pacte compte à son niveau", () => {
    const warlock = { spell1: { value: 0, max: 0 }, pact: { value: 1, max: 2, level: 3 } };
    expect(slotLeft(warlock, 1)).toBe(true);
    expect(slotLeft(warlock, 3)).toBe(true);
    expect(slotLeft(warlock, 4)).toBe(false);
    expect(slotLeft({ pact: { value: 0, max: 2, level: 3 } }, 1)).toBe(false);
  });

  it("sans fiche de sorts : rien", () => {
    expect(slotLeft(null, 1)).toBe(false);
  });
});

describe("coûts et manques", () => {
  it("un coût en formule compte pour 1", () => {
    expect(plainCost("2")).toBe(2);
    expect(plainCost(3)).toBe(3);
    expect(plainCost("1d4")).toBe(1);
  });

  it("manque : coût positif au-dessus de ce qui reste", () => {
    expect(isShort({ cost: 1, available: 0 })).toBe(true);
    expect(isShort({ cost: 2, available: 1 })).toBe(true);
    expect(isShort({ cost: 1, available: 1 })).toBe(false);
    expect(isShort({ cost: 0, available: 0 })).toBe(false);
  });
});

describe("resourceIssues", () => {
  it("les raisons dans l'ordre", () => {
    expect(resourceIssues({ slotMissing: true, usesShort: true, quantityShort: true, unprepared: true }))
      .toEqual(["noSlot", "noUses", "noQuantity", "unprepared"]);
    expect(resourceIssues({ usesShort: true })).toEqual(["noUses"]);
    expect(resourceIssues({})).toEqual([]);
  });
});
