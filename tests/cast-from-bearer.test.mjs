import { describe, expect, it } from "vitest";
import { linkHolds, validateCastFromBearer } from "../module/scripts/core/cast-from-bearer.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("castFromBearer : lancer depuis l'espace de la créature liée (Regard de deux esprits)", () => {
  const entry = CONTENT["gaze-of-two-minds"];
  it("le lien vaut à 18 m ou moins", () => {
    expect(entry.castFromBearer).toEqual({ distance: 60, units: "ft" });
    expect(linkHolds(60, 60)).toBe(true);
    expect(linkHolds(25, 60)).toBe(true);
    expect(linkHolds(65, 60)).toBe(false);
    expect(linkHolds(NaN, 60)).toBe(false);
  });
  it("tenu par une marque sur la créature touchée, jusqu'à la fin du prochain tour du lanceur", () => {
    const source = { effects: [], system: { activities: { TqjZeWzJpT25ZX8s: { effects: [] } } } };
    const plan = dataFixPlan(source, entry.dataFixes);
    expect(plan.create[0]).toMatchObject({ _id: "dasGazeTwoMinds0", name: "Gaze of Two Minds" });
    expect(plan.item).toEqual({ "system.activities.TqjZeWzJpT25ZX8s.effects": [{ _id: "dasGazeTwoMinds0" }] });
    expect(entry.effectEnds).toEqual({ dasGazeTwoMinds0: "casterTurnEnd" });
  });
  it("la clé est validée", () => {
    expect(validateCastFromBearer(entry.castFromBearer, "")).toEqual([]);
    expect(validateCastFromBearer({ distance: 0, units: "ft" }, "")).toHaveLength(1);
    expect(validateCastFromBearer({ distance: 60 }, "")).toHaveLength(1);
    expect(validateEntry(entry)).toEqual([]);
  });
});
