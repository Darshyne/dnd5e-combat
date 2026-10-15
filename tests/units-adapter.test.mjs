import { describe, it, expect, afterEach } from "vitest";
import { lengthIn } from "../module/scripts/adapter/units.mjs";

/** `lengthIn` : la conversion du cœur avec les facteurs de dnd5e, et la valeur telle quelle quand une unité manque. */
afterEach(() => { delete globalThis.CONFIG; });

describe("lengthIn", () => {
  it("convertit avec les facteurs de CONFIG.DND5E.movementUnits", () => {
    globalThis.CONFIG = { DND5E: { movementUnits: { ft: { conversion: 1 }, m: { conversion: 10 / 3 } } } };
    expect(lengthIn(30, "ft", "m")).toBeCloseTo(9);
    expect(lengthIn(30, "ft", "ft")).toBe(30);
  });
  it("garde la valeur quand une unité est inconnue ou absente", () => {
    globalThis.CONFIG = { DND5E: { movementUnits: { ft: { conversion: 1 } } } };
    expect(lengthIn(30, "ft", "lieues")).toBe(30);
    expect(lengthIn(30, undefined, "ft")).toBe(30);
  });
  it("prend les facteurs donnés (une boucle les lit une fois)", () => {
    expect(lengthIn(10, "ft", "m", { ft: 1, m: 10 / 3 })).toBeCloseTo(3);
  });
});
