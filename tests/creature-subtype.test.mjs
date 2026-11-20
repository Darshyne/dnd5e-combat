import { describe, expect, it } from "vitest";
import { subtypeMatches } from "../module/scripts/core/eligibility.mjs";
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
});
