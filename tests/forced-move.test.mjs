import { describe, expect, it } from "vitest";
import { braceCut, validateReducesForcedMove } from "../module/scripts/core/forced-move.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("reducesForcedMove : une Réaction raccourcit un déplacement subi (Harnois nain)", () => {
  const rule = ITEM_FIXES["dwarven-plate-enchanted"].reducesForcedMove;
  it("3 m au plus, jamais plus que le déplacement", () => {
    expect(rule).toEqual({ distance: 10, units: "ft" });
    expect(braceCut(rule, 15, "ft")).toBe(10);
    expect(braceCut(rule, 10, "ft")).toBe(10);
    expect(braceCut(rule, 5, "ft")).toBe(5);
  });
  it("rien sans déplacement, sans règle, ou dans une autre unité", () => {
    expect(braceCut(rule, 0, "ft")).toBe(0);
    expect(braceCut(null, 10, "ft")).toBe(0);
    expect(braceCut(rule, 3, "m")).toBe(0);
  });
  it("la clé est validée", () => {
    expect(validateReducesForcedMove(rule, "")).toEqual([]);
    expect(validateReducesForcedMove({ distance: 0, units: "ft" }, "")).toHaveLength(1);
    expect(validateReducesForcedMove({ distance: 10 }, "")).toHaveLength(1);
    expect(validateEntry({ reducesForcedMove: rule })).toEqual([]);
    expect(validateEntry({ reducesForcedMove: { distance: 10, units: "ft", free: true } })).not.toEqual([]);
  });
});
