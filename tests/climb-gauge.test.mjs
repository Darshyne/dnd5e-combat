import { describe, it, expect } from "vitest";
import { climbGauge, fallDice } from "../module/scripts/core/climb.mjs";

describe("§215 jauge de la fenêtre d'escalade", () => {
  const base = { feet: 0, gridDistance: 5, remaining: Infinity, multiplier: 2 };
  it("sous un plafond vu : les cases jusqu'au plafond, le plafond rendu", () => {
    const g = climbGauge({ ...base, ceilingFeet: 15, top: { kind: "ceiling", at: 20 } });
    expect(g.choosable).toBe(3);
    expect(g.cells.map(c => c.at)).toEqual([5, 10, 15]);
    expect(g.top.kind).toBe("ceiling");
  });
  it("vers un rebord vu : jusqu'à la case sous le rebord", () => {
    const g = climbGauge({ ...base, ceilingFeet: 15, top: { kind: "ledge", at: 20, name: "Étage 1" } });
    expect(g.cells.length).toBe(3);
    expect(g.top.name).toBe("Étage 1");
  });
  it("en combat : seules les cases payées sont choisissables", () => {
    const g = climbGauge({ ...base, remaining: 20, ceilingFeet: 15, top: { kind: "ceiling", at: 20 } });
    expect(g.choosable).toBe(2);
    expect(g.cells.map(c => c.choosable)).toEqual([true, true, false]);
  });
  it("haut non vu : rien ne le trahit, ni le haut ni le nombre de cases", () => {
    const g = climbGauge({ ...base, remaining: 60, ceilingFeet: 15, top: { kind: "ceiling", at: 20 }, seen: false });
    expect(g.top).toBeNull();
    expect(g.hidden).toBe(true);
    expect(g.choosable).toBe(6);
  });
  it("haut non vu hors combat : 6 cases au plus", () => {
    const g = climbGauge({ ...base, ceilingFeet: Infinity, top: null, seen: false });
    expect(g.choosable).toBe(6);
  });
  it("descente : jusqu'au sol", () => {
    const g = climbGauge({ ...base, feet: 15, ground: 0, down: true });
    expect(g.cells.map(c => c.at)).toEqual([10, 5, 0]);
  });
  it("chute : 1d6 par 10 ft, 20d6 au plus", () => {
    expect(fallDice(5)).toBe(0);
    expect(fallDice(15)).toBe(1);
    expect(fallDice(300)).toBe(20);
    expect(fallDice(6, 3)).toBe(2);
  });
});
