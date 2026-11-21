import { describe, expect, it } from "vitest";
import { checkOutcome } from "../module/scripts/core/contest.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("contest.dc : un test contre un DD fixe pose l'effet (Chaîne, Corde)", () => {
  it("réussi à DD ou plus", () => {
    expect(checkOutcome(13, 13)).toBe("win");
    expect(checkOutcome(18, 13)).toBe("win");
    expect(checkOutcome(12, 13)).toBe("lose");
    expect(checkOutcome(NaN, 13)).toBe("lose");
  });
  it("la clé se valide avec `dc` ou `against`, pas les deux", () => {
    const base = { skill: "ath", effect: "dasChainBound000" };
    expect(validateEntry({ contest: { ...base, dc: 13 } })).toEqual([]);
    expect(validateEntry({ contest: { ...base, against: ["acr"] } })).toEqual([]);
    expect(validateEntry({ contest: { ...base, dc: 13, against: ["acr"] } })).not.toEqual([]);
    expect(validateEntry({ contest: { ...base } })).not.toEqual([]);
  });
  it("Chaîne : Athlétisme DD 13 ; Corde : Escamotage DD 10 ; l'effet Entravé créé et relié à l'activité", () => {
    expect(CONTENT.chain.contest).toEqual({ activity: "nkqvEiPdXCyiJ9ub", skill: "ath", dc: 13, effect: "dasChainBound000" });
    expect(CONTENT.rope.contest).toEqual({ activity: "Y0LvyxjfVHNbp4CG", skill: "slt", dc: 10, effect: "dasRopeBound0000" });
    const item = { effects: [], system: { activities: { nkqvEiPdXCyiJ9ub: { effects: [] } } } };
    const plan = dataFixPlan(item, CONTENT.chain.dataFixes);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ _id: "dasChainBound000", statuses: ["restrained"], transfer: false });
    expect(plan.item).toEqual({ "system.activities.nkqvEiPdXCyiJ9ub.effects": [{ _id: "dasChainBound000" }] });
  });
});
