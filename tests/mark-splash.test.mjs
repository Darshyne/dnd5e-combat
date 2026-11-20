/**
 * Proie supérieure du chasseur (Rôdeur, Chasseur 11 — SRD 5.2) : une fois par tour, des dégâts infligés à la créature marquée
 * valent aussi les dégâts supplémentaires de la Marque du chasseur à une autre créature vue à 9 m ou moins de la première.
 */
import { describe, it, expect } from "vitest";
import { splashTargets, splashAvailable, splashFormula } from "../module/scripts/core/mark-splash.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("splashTargets", () => {
  const tokens = [{ id: "first", name: "Marquée", distance: 0, enemy: true, seen: true, first: true },
    { id: "near", name: "Proche", distance: 10, enemy: true, seen: true },
    { id: "far", name: "Loin", distance: 35, enemy: true, seen: true },
    { id: "ally", name: "Allié", distance: 5, enemy: false, seen: true },
    { id: "unseen", name: "Cachée", distance: 5, enemy: true, seen: false },
    { id: "mid", name: "Milieu", distance: 30, enemy: true, seen: true }];
  it("une autre créature, ennemie, vue, à 9 m ou moins de la première — la plus proche d'abord", () => {
    expect(splashTargets(tokens, 30).map(t => t.id)).toEqual(["near", "mid"]);
  });
  it("personne à portée : rien", () => {
    expect(splashTargets(tokens, 5)).toEqual([]);
  });
});

describe("splashAvailable — une fois par tour", () => {
  it("pas deux fois au même tour ; de nouveau au suivant ; toujours hors combat", () => {
    expect(splashAvailable(null, "c.1.0")).toBe(true);
    expect(splashAvailable("c.1.0", "c.1.0")).toBe(false);
    expect(splashAvailable("c.1.0", "c.2.0")).toBe(true);
    expect(splashAvailable("c.1.0", null)).toBe(true);
  });
});

describe("splashFormula", () => {
  const rule = CONTENT["superior-hunters-prey"].markSplash;
  it("le d6 de la Marque ; le d10 avec le Pourfendeur d'ennemis", () => {
    expect(splashFormula(rule, ["hunters-mark"])).toBe("1d6");
    expect(splashFormula(rule, ["hunters-mark", "foe-slayer"])).toBe("1d10");
  });
});

describe("l'entrée et le schéma", () => {
  it("Proie supérieure du chasseur", () => {
    expect(validateEntry(CONTENT["superior-hunters-prey"])).toEqual([]);
    expect(CONTENT["superior-hunters-prey"].markSplash.range).toEqual({ value: 30, units: "ft" });
    expect(validateEntry({ markSplash: { mark: "hunters-mark", formula: "1d6" } }).length).toBe(1);
  });
});
