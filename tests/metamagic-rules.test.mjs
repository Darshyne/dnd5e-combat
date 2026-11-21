/**
 * Métamagie (SRD 5.2) : une option par sort ; deux sous la Sorcellerie incarnée (Ensorceleur 7) tant que la Sorcellerie innée est
 * active ; une option sans dépense à chaque tour sous l'Apothéose arcanique (Ensorceleur 20), de même.
 */
import { describe, it, expect } from "vitest";
import { metamagicLimit, mayHold, freeOption } from "../module/scripts/core/metamagic-rules.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("metamagicLimit — combien d'options un sort peut porter", () => {
  it("une, sans règle ou quand la Sorcellerie innée n'est pas active", () => {
    expect(metamagicLimit([])).toBe(1);
    expect(metamagicLimit([{ limit: 2, active: false }])).toBe(1);
    expect(metamagicLimit([{ freePerTurn: true, active: true }])).toBe(1);
  });
  it("deux sous la Sorcellerie incarnée active", () => {
    expect(metamagicLimit([{ limit: 2, active: true }, { freePerTurn: true, active: true }])).toBe(2);
  });
});

describe("mayHold — retenir une option de plus", () => {
  it("la première toujours ; la deuxième seulement si la limite le permet ; la même deux fois ne compte pas", () => {
    expect(mayHold([], "quickened", 1)).toBe(true);
    expect(mayHold(["quickened"], "subtle", 1)).toBe(false);
    expect(mayHold(["quickened"], "subtle", 2)).toBe(true);
    expect(mayHold(["quickened", "subtle"], "careful", 2)).toBe(false);
    expect(mayHold(["quickened"], "quickened", 1)).toBe(true);
  });
});

describe("freeOption — sans points de sorcellerie", () => {
  const rules = [{ freePerTurn: true, active: true }];
  it("une fois à chaque tour, tant que la Sorcellerie innée est active", () => {
    expect(freeOption(rules, { usedTurn: null, turn: "c.1.0" })).toBe(true);
    expect(freeOption(rules, { usedTurn: "c.1.0", turn: "c.1.0" })).toBe(false);
    expect(freeOption(rules, { usedTurn: "c.1.0", turn: "c.2.0" })).toBe(true);
    expect(freeOption([{ freePerTurn: true, active: false }], { usedTurn: null, turn: "c.1.0" })).toBe(false);
    expect(freeOption([{ limit: 2, active: true }], { usedTurn: null, turn: "c.1.0" })).toBe(false);
  });
  it("hors combat, pas de tour à compter", () => {
    expect(freeOption(rules, { usedTurn: "c.1.0", turn: null })).toBe(true);
  });
});

describe("les entrées et le schéma", () => {
  it("Sorcellerie incarnée, Apothéose arcanique", () => {
    expect(CONTENT["sorcery-incarnate"]).toEqual({ metamagicRules: { whileEffect: "innate-sorcery", limit: 2 } });
    expect(CONTENT["arcane-apotheosis"]).toEqual({ metamagicRules: { whileEffect: "innate-sorcery", freePerTurn: true } });
    for ( const id of ["sorcery-incarnate", "arcane-apotheosis"] ) expect(validateEntry(CONTENT[id])).toEqual([]);
  });
  it("formes refusées", () => {
    expect(validateEntry({ metamagicRules: { whileEffect: "innate-sorcery" } }).length).toBe(1);
    expect(validateEntry({ metamagicRules: { limit: 2 } }).length).toBe(1);
    expect(validateEntry({ metamagicRules: { whileEffect: "innate-sorcery", limit: 1 } }).length).toBe(1);
  });
});
