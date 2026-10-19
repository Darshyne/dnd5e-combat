import { describe, it, expect } from "vitest";
import { jumpLimits, jumpCost, hasRunningStart } from "../module/scripts/core/jump.mjs";

describe("saut (§208)", () => {
  it("longueur : la valeur de Force avec élan, la moitié sans ; hauteur : 3 + mod. de Force, la moitié sans", () => {
    expect(jumpLimits({ str: 16, runningStart: true })).toMatchObject({ long: 16, high: 6 });
    expect(jumpLimits({ str: 16, runningStart: false })).toMatchObject({ long: 8, high: 3 });
    expect(jumpLimits({ str: 15, runningStart: false })).toMatchObject({ long: 7, high: 2 });   // arrondi à l'inférieur
    expect(jumpLimits({ str: 6, runningStart: true }).high).toBe(1);   // 3 − 2
    expect(jumpLimits({ str: 1, runningStart: true }).high).toBe(0);   // jamais négatif
  });
  it("Monte-en-l'air : la meilleure de la Force et de la Dextérité ; Pas du vent : distance doublée", () => {
    expect(jumpLimits({ str: 10, dex: 18, useDex: true, runningStart: true }).long).toBe(18);
    expect(jumpLimits({ str: 10, dex: 18, runningStart: true }).long).toBe(10);
    expect(jumpLimits({ str: 16, runningStart: true, double: true })).toMatchObject({ long: 32, high: 12 });
  });
  it("coût : un pied par pied ; le saut fixe (9 m pour 3 m) quand il permet le saut ou le rend moins cher", () => {
    expect(jumpCost(10, 16)).toEqual({ ok: true, cost: 10, fixed: false, limit: 16 });
    expect(jumpCost(20, 16)).toMatchObject({ ok: false, cost: 20 });
    const fixed = { distance: 30, cost: 10 };
    expect(jumpCost(25, 16, fixed)).toEqual({ ok: true, cost: 10, fixed: true, limit: 30 });
    expect(jumpCost(5, 16, fixed)).toMatchObject({ ok: true, cost: 5, fixed: false });   // plus court que le coût fixe
    expect(jumpCost(35, 16, fixed)).toMatchObject({ ok: false });
  });
  it("élan : la marche juste avant, depuis la fin, tant que le token marchait", () => {
    expect(hasRunningStart([{ distance: 5, action: "walk" }, { distance: 5, action: "walk" }])).toBe(true);
    expect(hasRunningStart([{ distance: 10, action: "walk" }, { distance: 5, action: "fly" }])).toBe(false);
    expect(hasRunningStart([{ distance: 5, action: "walk" }], 5)).toBe(true);   // Athlète
    expect(hasRunningStart([])).toBe(false);
  });
});
