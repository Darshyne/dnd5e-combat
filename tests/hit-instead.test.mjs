import { describe, expect, it } from "vitest";
import { hitInsteadApplies, validateHitInstead, soleOf } from "../module/scripts/core/hit-instead.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("hitInstead : une activité sœur à la place des dégâts d'un coup (Arc d'énergie)", () => {
  const rule = ITEM_FIXES["energy-bow-enchanted"].hitInstead;
  it("pour une attaque de l'item dont l'activité sœur existe", () => {
    expect(rule).toEqual({ activity: "sole" });
    expect(soleOf(["a"])).toBe("a");
    expect(soleOf([])).toBeNull();
    expect(soleOf(["a", "b"])).toBeNull();
    expect(hitInsteadApplies(rule, { isAttack: true, hasSibling: true })).toBe(true);
    expect(hitInsteadApplies(rule, { isAttack: false, hasSibling: true })).toBe(false);
    expect(hitInsteadApplies(rule, { isAttack: true, hasSibling: false })).toBe(false);
    expect(hitInsteadApplies(null, { isAttack: true, hasSibling: true })).toBe(false);
  });
  it("la clé est validée", () => {
    const isId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);
    expect(validateHitInstead(rule, "", isId)).toEqual([]);
    expect(validateHitInstead({ activity: "oR4052opJWNiSVdQ" }, "", isId)).toEqual([]);
    expect(validateHitInstead({ activity: "short" }, "", isId)).toHaveLength(1);
    expect(validateHitInstead({ activity: "oR4052opJWNiSVdQ", always: true }, "", isId)).toHaveLength(1);
    expect(validateEntry({ hitInstead: rule })).toEqual([]);
  });
});
