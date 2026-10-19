import { describe, it, expect } from "vitest";
import { readyPlanOf, readyTriggered, readyReach, READY_TRIGGERS } from "../module/scripts/core/ready.mjs";

const plan = (over={}) => ({ activity: "Actor.a.Item.b.Activity.c", name: "Épée longue", trigger: "enters", target: null, reach: { value: 5, units: "ft" }, ...over });
const ok = { enemies: true, reactionAvailable: true, incapacitated: false, sees: true };

describe("§211 Se tenir prêt", () => {
  it("lit le plan du budget, pas un simple « prêt »", () => {
    expect(readyPlanOf({ readied: true })).toBeNull();
    expect(readyPlanOf({ readied: false })).toBeNull();
    expect(readyPlanOf({ readied: plan() })?.name).toBe("Épée longue");
    expect(readyPlanOf({ readied: plan({ trigger: "dort" }) })).toBeNull();
    expect(READY_TRIGGERS).toEqual(["enters", "attacks", "casts"]);
  });

  it("déclenche sur le bon évènement, contre un ennemi, avec la Réaction", () => {
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, ok)).toBe(true);
    expect(readyTriggered(plan(), { kind: "attacks", source: "T1" }, ok)).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, enemies: false })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, reactionAvailable: false })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, incapacitated: true })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, sees: false })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, sees: null })).toBe(true);
  });

  it("une créature désignée : elle seule déclenche", () => {
    expect(readyTriggered(plan({ target: "T1" }), { kind: "enters", source: "T1" }, ok)).toBe(true);
    expect(readyTriggered(plan({ target: "T1" }), { kind: "enters", source: "T2" }, ok)).toBe(false);
  });

  it("portée : allonge, portée normale, contact, personnelle, illimitée", () => {
    expect(readyReach({ melee: true, reach: 10, range: { units: "ft" } })).toEqual({ value: 10, units: "ft" });
    expect(readyReach({ melee: false, range: { value: 80, units: "ft" } })).toEqual({ value: 80, units: "ft" });
    expect(readyReach({ melee: false, range: { units: "touch" } })).toEqual({ value: 5, units: "ft" });
    expect(readyReach({ melee: false, range: { units: "self" }, template: { size: 15, units: "ft" } })).toEqual({ value: 15, units: "ft" });
    expect(readyReach({ melee: false, range: { value: null, units: "any" } })).toBeNull();
  });
});
