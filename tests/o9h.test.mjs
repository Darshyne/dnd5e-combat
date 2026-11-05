/**
 * O9h (§363) : briques des consommables et objets demandés par l'utilisateur — durée tirée (Poussière de disparition), enduit (Poison
 * standard), et le contenu déclaré (validé par le schéma).
 */
import { describe, it, expect } from "vitest";
import { rollSimple, durationSeconds } from "../module/scripts/core/rolled-duration.mjs";
import { coatingCandidates, coatingApplies } from "../module/scripts/core/coating.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const fixed = v => () => v;

describe("O9h : durée tirée", () => {
  it("lit les dés et les entiers", () => {
    expect(rollSimple("2d4", fixed(0))).toBe(2);
    expect(rollSimple("2d4", fixed(0.999))).toBe(8);
    expect(rollSimple("1d6 + 2", fixed(0))).toBe(3);
    expect(rollSimple("3")).toBe(3);
    expect(rollSimple("2d4 * 3")).toBeNull();
  });
  it("convertit l'unité", () => {
    expect(durationSeconds({ formula: "2d4", units: "minutes" }, fixed(0))).toBe(120);
    expect(durationSeconds({ formula: "1d4", units: "hours" }, fixed(0.999))).toBe(14400);
    expect(durationSeconds({ seconds: 60 })).toBe(60);
    expect(durationSeconds({ formula: "x", units: "minutes" })).toBeNull();
  });
});

describe("O9h : enduit d'arme", () => {
  const rule = { damageTypes: ["piercing", "slashing"], ammunition: 3 };
  const items = [
    { id: "a", name: "Club", type: "weapon", kind: "simpleM", damageTypes: ["bludgeoning"], equipped: true },
    { id: "b", name: "Dagger", type: "weapon", kind: "simpleM", damageTypes: ["piercing"], equipped: false },
    { id: "c", name: "Greatsword", type: "weapon", kind: "martialM", damageTypes: ["slashing"], equipped: true },
    { id: "d", name: "Bite", type: "weapon", kind: "natural", damageTypes: ["piercing"], equipped: true },
    { id: "e", name: "Arrows", type: "consumable", kind: "ammo", damageTypes: [], quantity: 20 },
    { id: "f", name: "Bolts", type: "consumable", kind: "ammo", damageTypes: [], quantity: 0 }
  ];
  it("propose les armes qui délivrent, équipées d'abord, puis les munitions", () => {
    expect(coatingCandidates(items, rule).map(o => o.id)).toEqual(["c", "b", "e"]);
    expect(coatingCandidates(items, { damageTypes: ["piercing"] }).map(o => o.id)).toEqual(["b"]);
  });
  it("vaut tant qu'il est frais, pour le bon type", () => {
    const coating = { until: 100, deliveredBy: ["piercing", "slashing"], charges: 1 };
    expect(coatingApplies(coating, { now: 50, types: ["slashing"] })).toBe("applies");
    expect(coatingApplies(coating, { now: 50, types: ["bludgeoning"] })).toBe("no");
    expect(coatingApplies(coating, { now: 101, types: ["slashing"] })).toBe("dry");
    expect(coatingApplies({ ...coating, charges: 0 }, { now: 50, types: ["slashing"] })).toBe("dry");
  });
});

describe("O9h : contenu", () => {
  const ids = ["poison-basic", "burnt-othur-fumes", "potion-of-pugilism", "potion-of-resistance", "bead-of-force", "horn-of-blasting",
    "scroll-of-protection", "scroll-of-protection-undead-enchanted", "dust-of-disappearance", "oil-of-slipperiness", "dynamite-stick"];
  it.each(ids)("%s est déclaré et valide", id => {
    expect(CONTENT[id]).toBeTruthy();
    expect(validateEntry(CONTENT[id], { facts: { "activity.weaponKind": true }, at: id })).toEqual([]);
  });
  it("refuse les formes fautives", () => {
    expect(validateEntry({ coats: { activity: "x" } }, "t").length).toBeGreaterThan(0);
    expect(validateEntry({ backfire: { after: ["FMTcQOb5MZKBohdN"], chance: 120, activity: "q8PShLHyh2ItXbkQ" } }, "t").length).toBeGreaterThan(0);
    expect(validateEntry({ castDuration: { seconds: -1 } }, "t").length).toBeGreaterThan(0);
    expect(validateEntry({ effectDurations: { MC5GAZMrAc4wSvAS: { formula: "2d4", units: "rounds" } } }, "t").length).toBeGreaterThan(0);
    expect(validateEntry({ barrier: { radius: 5, units: "ft", onlyTypes: ["ghost"] } }, "t").length).toBeGreaterThan(0);
  });
});
