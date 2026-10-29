import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dragMultiplier, dragMultiplierWith } from "../module/scripts/core/movement.mjs";

const v = entry => validateEntry(entry, { facts: { "source.grappledByTarget": true } });

describe("§281 : l'empoignade grandie par le contenu", () => {
  it("validation", () => {
    expect(v({ grappleSize: { bonus: 1, dragFree: 0 } })).toEqual([]);
    expect(v({ grappleSize: {} })[0]).toMatch(/grappleSize/);
    expect(v({ grappleSize: { bonus: 0 } })[0]).toMatch(/grappleSize/);
    expect(v({ inescapable: true, grappleCover: "half" })).toEqual([]);
    expect(v({ grappleCover: "total" })[0]).toMatch(/grappleCover/);
    expect(v({ triggers: [{ on: "enemyTurnEnd", if: { "source.grappledByTarget": true }, do: [{ type: "use" }] }] })).toEqual([]);
  });

  it("traîner sa prise : sans surcoût jusqu'à sa taille, sinon la règle avec la taille grandie", () => {
    // Moyen (2) qui traîne un Moyen : surcoût par la règle ; sans surcoût avec `dragFree: 0`.
    expect(dragMultiplier(2, [2])).toBe(2);
    expect(dragMultiplierWith(2, [2], { bonus: 1, freeUpTo: 0 })).toBe(1);
    // Un Grand (3) : la taille grandie (3) ne suffit pas à le traîner sans surcoût (il faut deux tailles de moins).
    expect(dragMultiplierWith(2, [3], { bonus: 1, freeUpTo: 0 })).toBe(2);
    expect(dragMultiplierWith(2, [1], { bonus: 1 })).toBe(1);
    expect(dragMultiplierWith(2, [2])).toBe(2);
  });
});
