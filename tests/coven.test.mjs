import { describe, it, expect } from "vitest";
import { sharedValue } from "../module/scripts/core/coven.mjs";

describe("§19.5 : PV partagés d'un cercle", () => {
  it("reporte l'écart, borné à 0 et au maximum", () => {
    expect(sharedValue({ value: 210, max: 210 }, -20)).toBe(190);
    expect(sharedValue({ value: 15, max: 210 }, -20)).toBe(0);
    expect(sharedValue({ value: 200, max: 210 }, 30)).toBe(210);
  });
  it("rien à écrire : écart nul, déjà au plafond, ou déjà à 0 sous des dégâts", () => {
    expect(sharedValue({ value: 210, max: 210 }, 0)).toBeNull();
    expect(sharedValue({ value: 210, max: 210 }, 5)).toBeNull();
    expect(sharedValue({ value: 0, max: 210 }, -5)).toBeNull();
    expect(sharedValue({ value: 0, max: 210 }, 5)).toBe(5);
  });
  it("deux coups de la même source comptent deux fois : les écarts s'additionnent", () => {
    // A subit 20, B subit 25 (même boule de feu) : chacun reçoit l'écart de l'autre.
    let a = 190, b = 185, c = 210;
    b = sharedValue({ value: b, max: 210 }, -20); c = sharedValue({ value: c, max: 210 }, -20);
    a = sharedValue({ value: a, max: 210 }, -25); c = sharedValue({ value: c, max: 210 }, -25);
    expect([a, b, c]).toEqual([165, 165, 165]);
  });
});
