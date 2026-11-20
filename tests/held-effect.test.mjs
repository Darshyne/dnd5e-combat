/**
 * Paume vibratoire (Moine, Main ouverte 17 — SRD 5.2) : 4 points de crédo sur un coup à mains nues posent des vibrations ; une
 * seule créature à la fois ; y mettre fin impose une sauvegarde de Constitution (10d12 de force, la moitié sur une réussite).
 */
import { describe, it, expect } from "vitest";
import { supersededEffects, endsHeldEffect, riderAffordable } from "../module/scripts/core/held-effect.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("supersededEffects — une seule créature à la fois", () => {
  const rule = { effect: "GnIJc9uI54mfAQz8", single: true };
  it("les vibrations posées ailleurs tombent ; celles de la même créature restent à qui pose l'effet", () => {
    const placed = { id: "new", bearer: "B" };
    const others = [{ id: "old", bearer: "A" }, placed, { id: "same", bearer: "B" }];
    expect(supersededEffects(rule, placed, others)).toEqual([{ id: "old", bearer: "A" }]);
  });
  it("sans `single`, rien", () => {
    expect(supersededEffects({ effect: "GnIJc9uI54mfAQz8" }, { id: "new", bearer: "B" }, [{ id: "old", bearer: "A" }])).toEqual([]);
  });
});

describe("endsHeldEffect", () => {
  it("seulement l'activité déclarée", () => {
    const rule = { effect: "GnIJc9uI54mfAQz8", endedBy: "lBn87Q4yyJXWzLqg" };
    expect(endsHeldEffect(rule, "lBn87Q4yyJXWzLqg")).toBe(true);
    expect(endsHeldEffect(rule, "O1mQr2rPpzRpB3yJ")).toBe(false);
    expect(endsHeldEffect(null, "lBn87Q4yyJXWzLqg")).toBe(false);
  });
});

describe("riderAffordable — une faveur qui coûte plusieurs utilisations", () => {
  it("il faut `cost` utilisations ; une par défaut", () => {
    expect(riderAffordable(4, 4)).toBe(true);
    expect(riderAffordable(3, 4)).toBe(false);
    expect(riderAffordable(1)).toBe(true);
    expect(riderAffordable(0)).toBe(false);
    expect(riderAffordable(Infinity, 4)).toBe(true);
  });
});

describe("l'entrée et le schéma", () => {
  it("Paume vibratoire", () => {
    const entry = CONTENT["quivering-palm"];
    expect(entry.hitRider).toEqual({ effect: "GnIJc9uI54mfAQz8", unarmed: true, pays: "monks-focus", cost: 4 });
    expect(entry.heldEffect).toEqual({ effect: "GnIJc9uI54mfAQz8", single: true, endedBy: "lBn87Q4yyJXWzLqg" });
    expect(validateEntry(entry)).toEqual([]);
  });
  it("formes refusées", () => {
    expect(validateEntry({ hitRider: { effect: "GnIJc9uI54mfAQz8", cost: 4 } }).length).toBe(1);
    expect(validateEntry({ heldEffect: { effect: "GnIJc9uI54mfAQz8" } }).length).toBe(1);
  });
});
