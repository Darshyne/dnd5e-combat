import { describe, it, expect } from "vitest";
import { usageLimitIssues, lowestSlotLevel } from "../module/scripts/core/limits.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { resourceFeedback } from "../module/scripts/core/feedback.mjs";

const rule = { oncePerTurn: true, whenEmpty: "wild-shape" };
const base = { inCombat: true, ownTurn: true, usedThisTurn: false, remaining: 0 };

describe("Regain sauvage : limites d'utilisation", () => {
  it("à son tour, pas encore utilisé, Forme sauvage vide : rien ne cloche", () => {
    expect(usageLimitIssues(rule, base)).toEqual([]);
  });
  it("hors de son tour, ou déjà utilisé ce tour", () => {
    expect(usageLimitIssues(rule, { ...base, ownTurn: false })).toEqual(["notOwnTurn"]);
    expect(usageLimitIssues(rule, { ...base, usedThisTurn: true })).toEqual(["oncePerTurn"]);
  });
  it("il reste des utilisations de Forme sauvage", () => {
    expect(usageLimitIssues(rule, { ...base, remaining: 2 })).toEqual(["notEmpty"]);
  });
  it("hors combat : ni tour ni limite par tour", () => {
    expect(usageLimitIssues(rule, { inCombat: false, ownTurn: false, usedThisTurn: true, remaining: 0 })).toEqual([]);
  });
  it("l'emplacement le plus bas disponible", () => {
    expect(lowestSlotLevel({ 1: 0, 2: 3, 3: 1 })).toBe(2);
    expect(lowestSlotLevel({ 1: 4 })).toBe(1);
    expect(lowestSlotLevel({ 1: 0, 2: 0 })).toBe(null);
  });
  it("retour des ressources : seulement pour une activité qui rend quelque chose", () => {
    // Regain de Forme sauvage : +1 Forme sauvage, −1 emplacement niv. 2.
    expect(resourceFeedback([{ type: "itemUses", value: -1, name: "Forme sauvage" }, { type: "spellSlots", value: 1, level: 2 }]))
      .toEqual([{ kind: "gain", type: "itemUses", n: 1, name: "Forme sauvage" }, { kind: "spend", type: "spellSlots", n: 1, level: 2 }]);
    // Un sort ordinaire : rien.
    expect(resourceFeedback([{ type: "spellSlots", value: 1, level: 3 }])).toEqual([]);
  });
  it("schéma", () => {
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { ...rule, lowestSlot: true, noDialog: true, cost: "bonus" } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { cost: "free" } } })).toEqual(["usageLimits.7nAgPNN2dth7SR0D.cost: action, bonus, reaction"]);
    expect(validateEntry({ usageLimits: { court: { oncePerTurn: 1 } } }))
      .toEqual(["usageLimits.court: activity id (16 characters) expected", "usageLimits.court.oncePerTurn: true or absent"]);
  });
});
