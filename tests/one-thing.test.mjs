/**
 * Hébétement (Roublard 14, Frappes sournoises — SRD 5.2) : au tour de la cible, une seule chose parmi se déplacer, prendre une
 * action, prendre une action Bonus.
 */
import { describe, it, expect } from "vitest";
import { oneThingBudget, oneThingStopsMove } from "../module/scripts/core/one-thing.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const fresh = { action: 1, bonus: 1, reaction: 1, limited: 0 };

describe("oneThingBudget", () => {
  it("rien de fait : tout reste ouvert", () => {
    expect(oneThingBudget({ ...fresh }, fresh, false)).toEqual(fresh);
  });
  it("déplacée : ni action ni action Bonus", () => {
    expect(oneThingBudget({ ...fresh }, fresh, true)).toMatchObject({ action: 0, bonus: 0 });
  });
  it("une action prise : pas d'action Bonus ; une action Bonus prise : pas d'action", () => {
    expect(oneThingBudget({ ...fresh, action: 0 }, fresh, false)).toMatchObject({ action: 0, bonus: 0 });
    expect(oneThingBudget({ ...fresh, bonus: 0 }, fresh, false)).toMatchObject({ action: 0, bonus: 0 });
  });
  it("la Réaction n'est pas concernée", () => {
    expect(oneThingBudget({ ...fresh }, fresh, true).reaction).toBe(1);
  });
});

describe("oneThingStopsMove", () => {
  it("une action ou une action Bonus prise : plus de déplacement", () => {
    expect(oneThingStopsMove({ ...fresh }, fresh)).toBe(false);
    expect(oneThingStopsMove({ ...fresh, action: 0 }, fresh)).toBe(true);
    expect(oneThingStopsMove({ ...fresh, bonus: 0 }, fresh)).toBe(true);
  });
});

describe("l'entrée", () => {
  it("Frappes sournoises : l'effet « Dazed » porte la règle, jusqu'à la fin du prochain tour de la cible", () => {
    const entry = CONTENT["devious-strikes"];
    expect(entry.oneThingPerTurn).toBe("wWFV1p8u9C1TUPg5");
    expect(entry.effectEnds).toEqual({ wWFV1p8u9C1TUPg5: "bearerTurnEnd" });
    expect(validateEntry(entry)).toEqual([]);
    expect(validateEntry({ oneThingPerTurn: "court" }).length).toBe(1);
  });
});
