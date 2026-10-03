import { describe, it, expect } from "vitest";
import { d20Law, bonusLaw, hitChance, asPercent } from "../module/scripts/core/hitchance.mjs";

const sum = law => law.reduce((a, b) => a + b, 0);

describe("loi du d20", () => {
  it("chaque mode somme à 1", () => {
    for ( const mode of [1, 0, -1] ) expect(sum(d20Law(mode))).toBeCloseTo(1, 12);
  });
  it("avantage : 20 plus probable que 1 ; désavantage : l'inverse", () => {
    expect(d20Law(1)[20]).toBeCloseTo(39 / 400, 12);
    expect(d20Law(1)[1]).toBeCloseTo(1 / 400, 12);
    expect(d20Law(-1)[1]).toBeCloseTo(39 / 400, 12);
    expect(d20Law(-1)[20]).toBeCloseTo(1 / 400, 12);
  });
});

describe("loi du bonus", () => {
  it("bonus fixe seul", () => expect(Array.from(bonusLaw(5))).toEqual([[5, 1]]));
  it("+1d4 : quatre valeurs équiprobables", () => {
    const law = bonusLaw(5, [{ number: 1, faces: 4 }]);
    expect(Array.from(law.keys()).sort()).toEqual([6, 7, 8, 9]);
    for ( const p of law.values() ) expect(p).toBeCloseTo(0.25, 12);
  });
  it("-1d4 (Fléau)", () => {
    const law = bonusLaw(5, [{ number: 1, faces: 4, sign: -1 }]);
    expect(Math.min(...law.keys())).toBe(1);
    expect(Math.max(...law.keys())).toBe(4);
  });
});

describe("chance de toucher", () => {
  it("jet normal : +5 contre CA 15 → 11 à 20, 55 %", () => {
    expect(hitChance({ ac: 15, bonus: 5 }).hit).toBeCloseTo(0.55, 12);
  });
  it("le 1 naturel rate toujours, le 20 touche toujours", () => {
    expect(hitChance({ ac: 2, bonus: 10 }).hit).toBeCloseTo(0.95, 12);
    expect(hitChance({ ac: 40, bonus: 0 }).hit).toBeCloseTo(0.05, 12);
    expect(hitChance({ ac: 40, bonus: 0 }).critical).toBeCloseTo(0.05, 12);
  });
  it("avantage : 1 - (1 - p)² ; désavantage : p²", () => {
    const p = 0.55;
    expect(hitChance({ ac: 15, bonus: 5, mode: 1 }).hit).toBeCloseTo(1 - ((1 - p) ** 2), 12);
    expect(hitChance({ ac: 15, bonus: 5, mode: -1 }).hit).toBeCloseTo(p * p, 12);
  });
  it("seuil de critique abaissé (Champion, 19)", () => {
    const r = hitChance({ ac: 40, bonus: 0, critical: 19 });
    expect(r.hit).toBeCloseTo(0.10, 12);
    expect(r.critical).toBeCloseTo(0.10, 12);
  });
  it("Bénédiction : +5 +1d4 contre CA 15 → 55 % + 2,5 × 5 %", () => {
    expect(hitChance({ ac: 15, bonus: 5, dice: [{ number: 1, faces: 4 }] }).hit).toBeCloseTo(0.675, 12);
  });
  it("abri total : intouchable", () => {
    expect(hitChance({ ac: null, bonus: 20 })).toEqual({ hit: 0, critical: 0 });
  });
  it("coup critique d'office : tout ce qui touche est critique", () => {
    const r = hitChance({ ac: 10, bonus: 5, autoCritical: true });
    expect(r.critical).toBe(r.hit);
  });
});

describe("affichage", () => {
  it("jamais 0 ni 100 tant que ce n'est pas certain", () => {
    expect(asPercent(0.004)).toBe(1);
    expect(asPercent(0.999)).toBe(99);
    expect(asPercent(0)).toBe(0);
    expect(asPercent(0.55)).toBe(55);
  });
});

import { saveFailChance } from "../module/scripts/core/hitchance.mjs";

describe("chance d'échec d'une sauvegarde (§15.3)", () => {
  it("d20 + bonus < DD, sans 1 ni 20 automatiques", () => {
    expect(saveFailChance({ dc: 13, bonus: 2 })).toBeCloseTo(0.5, 10);      // échoue sur 1 à 10
    expect(saveFailChance({ dc: 25, bonus: 2 })).toBe(1);                   // même un 20 ne suffit pas
    expect(saveFailChance({ dc: 2, bonus: 5 })).toBe(0);                    // même un 1 réussit
  });
  it("avantage et désavantage", () => {
    expect(saveFailChance({ dc: 13, bonus: 2, mode: 1 })).toBeCloseTo(0.25, 10);
    expect(saveFailChance({ dc: 13, bonus: 2, mode: -1 })).toBeCloseTo(0.75, 10);
  });
  it("dés du bonus : Bénédiction +1d4 réduit l'échec", () => {
    const blessed = saveFailChance({ dc: 13, bonus: 2, dice: [{ number: 1, faces: 4 }] });
    expect(blessed).toBeCloseTo(0.375, 10);                                 // d4 = 1..4 : échoue sur 9, 8, 7, 6 faces du d20 → 30/80
  });
  it("échec d'office et immunité", () => {
    expect(saveFailChance({ dc: 5, bonus: 10, autoFail: true })).toBe(1);
    expect(saveFailChance({ dc: 30, bonus: 0, immune: true })).toBe(0);
  });
});
