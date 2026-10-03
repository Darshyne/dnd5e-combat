import { describe, it, expect } from "vitest";
import { autoDispelLevel, dispelPlan } from "../module/scripts/core/dispel.mjs";

describe("§37.2 : Dissipation de la magie", () => {
  it("cesse d'office jusqu'au niveau 3, ou jusqu'à celui de l'emplacement", () => {
    expect(autoDispelLevel(3)).toBe(3);
    expect(autoDispelLevel(5)).toBe(5);
    expect(autoDispelLevel(undefined)).toBe(3);
  });

  it("au-delà : un test contre DD 10 + niveau", () => {
    expect(dispelPlan([{ key: "a", level: 1 }, { key: "b", level: 3 }, { key: "c", level: 4 }, { key: "d", level: 6 }], 3)).toEqual([
      { key: "a", level: 1, auto: true, dc: null },
      { key: "b", level: 3, auto: true, dc: null },
      { key: "c", level: 4, auto: false, dc: 14 },
      { key: "d", level: 6, auto: false, dc: 16 }
    ]);
    expect(dispelPlan([{ key: "c", level: 4 }, { key: "d", level: 6 }], 5).map(s => s.auto)).toEqual([true, false]);
  });
});
