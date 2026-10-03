import { describe, it, expect } from "vitest";
import { convertLength, isWithinRange } from "../module/scripts/core/units.mjs";

// Valeurs de CONFIG.DND5E.movementUnits (dnd5e 6.0.1, config.mjs:2588) : longueur en pieds,
// conversion simplifiée 5 ft = 1,5 m.
const factors = { ft: 1, mi: 5280, m: 10 / 3, km: 10000 / 3 };

describe("convertLength", () => {
  it("laisse une valeur inchangée dans la même unité", () => {
    expect(convertLength(9, "m", "m", factors)).toBe(9);
  });
  it("convertit les pieds en mètres", () => {
    expect(convertLength(30, "ft", "m", factors)).toBeCloseTo(9, 9);
  });
  it("refuse une unité inconnue", () => {
    expect(() => convertLength(1, "toise", "m", factors)).toThrow(/toise/);
  });
});

describe("isWithinRange", () => {
  it("accepte 9 m mesurés pour une portée de 30 ft", () => {
    expect(isWithinRange({ value: 9, units: "m" }, { value: 30, units: "ft" }, factors)).toBe(true);
  });
  it("accepte 9 m mesurés pour une portée convertie à 9 m", () => {
    expect(isWithinRange({ value: 9, units: "m" }, { value: 9, units: "m" }, factors)).toBe(true);
  });
  it("refuse une case de trop", () => {
    expect(isWithinRange({ value: 10.5, units: "m" }, { value: 30, units: "ft" }, factors)).toBe(false);
  });
});
