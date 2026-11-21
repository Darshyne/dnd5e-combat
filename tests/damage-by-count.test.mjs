import { describe, expect, it } from "vitest";
import { countOfUse, formulaForCount, validateDamageByCount } from "../module/scripts/core/damage-by-count.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("damageByCount : des dégâts selon le nombre créé (Anneau des étoiles filantes)", () => {
  const entry = ITEM_FIXES["ring-of-shooting-stars"];
  const rule = entry.damageByCount.GLyk6XaqTk5JOVQ8;
  it("le nombre d'une utilisation : 1 plus la montée", () => {
    expect(countOfUse(undefined)).toBe(1);
    expect(countOfUse(0)).toBe(1);
    expect(countOfUse(3)).toBe(4);
    expect(countOfUse(-1)).toBe(1);
  });
  it("la table du texte : 4d12, 5d4, 2d6, 2d4 ; rien hors table", () => {
    expect([1, 2, 3, 4].map(n => formulaForCount(rule, n))).toEqual(["4d12", "5d4", "2d6", "2d4"]);
    expect(formulaForCount(rule, 5)).toBeNull();
    expect(formulaForCount(rule, undefined)).toBeNull();
    expect(formulaForCount(null, 1)).toBeNull();
  });
  it("la sauvegarde sans dégât reçoit la ligne d'une sphère", () => {
    const source = { effects: [], system: { activities: { GLyk6XaqTk5JOVQ8: { damage: { parts: [] } } } } };
    const [part] = dataFixPlan(source, entry.dataFixes).item["system.activities.GLyk6XaqTk5JOVQ8.damage.parts"];
    expect(part).toMatchObject({ number: 4, denomination: 12, types: ["lightning"] });
  });
  it("la clé est validée", () => {
    const isId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);
    expect(validateDamageByCount(entry.damageByCount, "", isId)).toEqual([]);
    expect(validateDamageByCount({ GLyk6XaqTk5JOVQ8: { from: "x", formulas: ["1d4"] } }, "", isId)).toHaveLength(1);
    expect(validateDamageByCount({ GLyk6XaqTk5JOVQ8: { from: "sZwpvVE0OpUNXe2B", formulas: [] } }, "", isId)).toHaveLength(1);
    expect(validateEntry(entry)).toEqual([]);
  });
});
