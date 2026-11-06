import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

// §371 : `endurance` — true (Acharnement), ou ce qui suit le maintien à 1 PV (effet, PV temporaires, utilisations rendues).
describe("contenu endurance", () => {
  it("true reste valable", () => expect(validateEntry({ endurance: true })).toEqual([]));

  it("effet, PV temporaires et utilisations rendues", () => {
    expect(validateEntry({ endurance: { effect: "abcdefghijklmnop", tempHp: "floor(@attributes.hp.max / 2)", restores: ["resource-item"] } })).toEqual([]);
    expect(validateEntry({ endurance: { tempHp: "5" } })).toEqual([]);
  });

  it("refuse le reste", () => {
    for ( const bad of [false, {}, { effect: "court" }, { tempHp: "" }, { restores: [] }, { restores: [""] }, { other: 1 }] ) {
      expect(validateEntry({ endurance: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});
