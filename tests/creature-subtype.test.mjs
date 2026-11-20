import { describe, expect, it } from "vitest";
import {
  subtypeMatches, saveDisadvantageAgainstHolds, validateSaveDisadvantageAgainst
} from "../module/scripts/core/eligibility.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("fait target.creatureSubtype : le sous-type d'une créature (Armure démoniaque)", () => {
  it("sans égard à la casse ; une liste = l'un d'eux ; sans sous-type : non", () => {
    expect(subtypeMatches("Demon", "demon")).toBe(true);
    expect(subtypeMatches(" demon ", "Demon")).toBe(true);
    expect(subtypeMatches("Devil", "demon")).toBe(false);
    expect(subtypeMatches("Devil", ["demon", "devil"])).toBe(true);
    expect(subtypeMatches("", "demon")).toBe(false);
    expect(subtypeMatches(null, "demon")).toBe(false);
    expect(subtypeMatches(undefined, [])).toBe(false);
  });
  it("Armure démoniaque : Désavantage au jet d'attaque contre un démon, pas contre un diable", () => {
    const [rule] = ITEM_FIXES["demon-armor-enchanted"].triggers;
    expect(rule.on).toBe("preAttackRoll");
    expect(rule.do).toEqual([{ type: "disadvantage" }]);
    const facts = subtype => ({ "target.creatureSubtype": want => subtypeMatches(subtype, want) });
    expect(holds(rule.if, facts("Demon"))).toBe(true);
    expect(holds(rule.if, facts("Devil"))).toBe(false);
    expect(holds(rule.if, facts(null))).toBe(false);
  });
  it("Armure démoniaque : Désavantage aux sauvegardes qu'impose un démon, pas un diable", () => {
    const rule = ITEM_FIXES["demon-armor-enchanted"].saveDisadvantageAgainst;
    expect(rule).toEqual({ subtypes: ["demon"] });
    expect(saveDisadvantageAgainstHolds(rule, "Demon")).toBe(true);
    expect(saveDisadvantageAgainstHolds(rule, "Devil")).toBe(false);
    expect(saveDisadvantageAgainstHolds(rule, "")).toBe(false);
    expect(saveDisadvantageAgainstHolds(null, "Demon")).toBe(false);
    expect(validateSaveDisadvantageAgainst(rule, "")).toEqual([]);
    expect(validateSaveDisadvantageAgainst({ subtypes: [] }, "")).toHaveLength(1);
    expect(validateSaveDisadvantageAgainst({ subtypes: ["demon"], types: ["fiend"] }, "")).toHaveLength(1);
    expect(validateEntry({ saveDisadvantageAgainst: rule })).toEqual([]);
  });
});
