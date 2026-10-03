import { describe, it, expect } from "vitest";
import { attackModifiers, grappleHolds } from "../module/scripts/core/conditions.mjs";

const base = { attacker: ["grappled"], target: [], adjacent: true, ranged: false };

describe("Agrippé (règles 2024)", () => {
  it("désavantage contre toute cible autre que l'agrippeur", () => {
    expect(attackModifiers({ ...base, grappledElsewhere: true }).disadvantage).toEqual([{ who: "attacker", key: "grappled" }]);
  });
  it("aucun désavantage contre l'agrippeur, ni si l'agrippeur est inconnu", () => {
    expect(attackModifiers({ ...base, grappledElsewhere: false }).disadvantage).toEqual([]);
    expect(attackModifiers({ ...base, grappledElsewhere: null }).disadvantage).toEqual([]);
  });
  it("l'empoignade cesse si l'agrippeur est neutralisé ou trop loin", () => {
    expect(grappleHolds({ grapplerStatuses: [], withinReach: true })).toBe(true);
    expect(grappleHolds({ grapplerStatuses: [], withinReach: false })).toBe(false);
    expect(grappleHolds({ grapplerStatuses: ["unconscious"], withinReach: true })).toBe(false);
    expect(grappleHolds({ grapplerStatuses: ["incapacitated"], withinReach: true })).toBe(false);
    expect(grappleHolds({ grapplerStatuses: ["prone"], withinReach: true })).toBe(true);
  });
});

describe("Soutien (règles 2024), partie attaque", () => {
  it("un allié a distrait la cible : avantage", () => {
    const r = attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false, helped: true });
    expect(r.advantage).toEqual([{ who: "situation", key: "helped" }]);
  });
  it("sans Soutien : rien", () => {
    expect(attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false }).advantage).toEqual([]);
  });
});
