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
    // À ciel ouvert, le rebord : la sélection par défaut s'arrête sous lui.
    expect(climbGauge({ ...base, top: { kind: "ledge", at: 20 } }).topCells).toBe(3);
    // … et la jauge montre le rebord et deux cases au-dessus, ou jusqu'au prochain niveau.
    expect(climbGauge({ ...base, top: { kind: "ledge", at: 20 } }).cells.length).toBe(5);
    const marks = [{ at: 20, name: "Second Floor" }, { at: 40, name: "Third Floor" }];
    const g2 = climbGauge({ ...base, top: { kind: "ledge", at: 20 }, marks });
    expect(g2.cells.length).toBe(8);
    expect(g2.marks.map(m => m.name)).toEqual(["Second Floor", "Third Floor"]);
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
  it("§216 : la séparation du prochain niveau se voit, même hors de portée", () => {
    const marks = [{ at: 20, name: "Second Floor" }, { at: 40, name: "Third Floor" }];
    const g = climbGauge({ ...base, remaining: 10, marks });
    expect(g.choosable).toBe(1);
    expect(g.cells.length).toBe(4);
    expect(g.marks.map(m => m.name)).toEqual(["Second Floor"]);
  });
  it("§216 : sous un plafond vu, pas de repère au-delà", () => {
    const g = climbGauge({ ...base, ceilingFeet: 10, top: { kind: "ceiling", at: 15 }, marks: [{ at: 20, name: "Second Floor" }] });
    expect(g.marks).toEqual([]);
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
