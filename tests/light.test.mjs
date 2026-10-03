import { describe, it, expect } from "vitest";
import { areaLightRadii, tokenLightChanges, dispelledBy, sensesThrough } from "../module/scripts/core/light.mjs";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";

describe("lumière des zones", () => {
  it("des ténèbres prennent le rayon de la zone, en source négative", () => {
    expect(areaLightRadii({ darkness: true }, 15)).toEqual({ bright: 15, dim: 15, negative: true });
  });
  it("une lumière garde ses rayons ; le rayon faible n'est jamais plus court que le vif", () => {
    expect(areaLightRadii({ bright: 60, dim: 120 }, 60)).toEqual({ bright: 60, dim: 120, negative: false });
    expect(areaLightRadii({ bright: 20 }, 0)).toEqual({ bright: 20, dim: 20, negative: false });
  });
});

describe("lumière portée par un effet", () => {
  it("changements token.light en upgrade, sans rayon vif nul", () => {
    expect(tokenLightChanges({ dim: 10 })).toEqual([{ key: "token.light.dim", type: "upgrade", value: "10", phase: "initial" }]);
  });
  it("reprend couleur et animation de l'objet invoqué", () => {
    const keys = tokenLightChanges({ bright: 20, dim: 40, color: "#ff810a", animation: { type: "flame", speed: 1, intensity: 3 } })
      .map(c => `${c.key}=${c.value}/${c.type}`);
    expect(keys).toEqual(["token.light.bright=20/upgrade", "token.light.dim=40/upgrade", "token.light.color=#ff810a/override",
      "token.light.animation.type=flame/override", "token.light.animation.speed=1/override", "token.light.animation.intensity=3/override"]);
  });
});

describe("Lumière du jour dissipe les Ténèbres", () => {
  const darkness = [
    { id: "proche", x: 100, y: 0, radius: 15, level: 2 },
    { id: "loin", x: 1000, y: 0, radius: 15, level: 2 },
    { id: "haut", x: 50, y: 0, radius: 15, level: 4 },
    { id: "inconnu", x: 50, y: 0, radius: 15, level: null }
  ];
  it("celles de niveau ≤ 3 que la zone recouvre", () => {
    expect(dispelledBy({ x: 0, y: 0, radius: 90 }, 3, darkness)).toEqual(["proche", "inconnu"]);
  });
  it("tangentes : pas de recouvrement", () => {
    expect(dispelledBy({ x: 0, y: 0, radius: 85 }, 3, [{ id: "a", x: 100, y: 0, radius: 15, level: 2 }])).toEqual([]);
  });
});

describe("sens qui percent", () => {
  it("la brume : vision aveugle et vibrations ; les ténèbres : aussi la vision véritable", () => {
    expect(sensesThrough({ fog: true, darkness: false })).toEqual(["blindsight", "feelTremor"]);
    expect(sensesThrough({ fog: true, darkness: true })).toEqual(["blindsight", "feelTremor"]);
    expect(sensesThrough({ fog: false, darkness: true })).toEqual(["blindsight", "feelTremor", "seeAll"]);
    expect(sensesThrough({ fog: false, darkness: false })).toBe(null);
  });
});

describe("schéma de la clé light", () => {
  it("accepte les formes livrées", () => {
    for ( const light of [{ on: "area", darkness: true }, { on: "area", bright: 60, dim: 120, units: "ft", dispels: 3 },
      { on: "effect", dim: 10, units: "ft" }, { on: "summon", carried: true, single: true }] ) {
      expect(validateEntry({ light })).toEqual([]);
    }
  });
  it("refuse ce qui ne tient pas", () => {
    expect(validateEntry({ light: { on: "partout" } })).toContain("light.on : area, effect, summon");
    expect(validateEntry({ light: { on: "effect" } })).toContain("light : un effet lumineux donne un rayon");
    expect(validateEntry({ light: { on: "effect", dim: 10 } })).toContain("light.units : unité requise");
    expect(validateEntry({ light: { on: "effect", dim: 10, units: "ft", darkness: true } })).toContain("light.darkness : seulement sur une zone");
    expect(validateEntry({ light: { on: "area", darkness: true, carried: true } })).toContain("light : carried et single valent pour une invocation");
    expect(validateEntry({ light: { on: "area", darkness: true, dispels: 2.5 } })).toContain("light.dispels : niveau de sort (entier)");
    expect(validateEntry({ light: { on: "area", darkness: true, couleur: "rouge" } })).toContain("light.couleur : clé inconnue");
  });
  it("effectsExpire : un repos de dnd5e", () => {
    expect(validateEntry({ effectsExpire: "longRest" })).toEqual([]);
    expect(validateEntry({ effectsExpire: "dawn" })).toEqual(["effectsExpire : longRest, shortRest"]);
  });
  it("revealsInvisible : true ou absent", () => {
    expect(validateEntry({ revealsInvisible: true })).toEqual([]);
    expect(validateEntry({ revealsInvisible: "oui" })).toEqual(["revealsInvisible : true ou absent"]);
  });
  it("une surcouche corrige un rayon sans redire le reste", () => {
    expect(mergeEntries([{ light: { on: "effect", dim: 10, units: "ft" } }, { light: { dim: 20 } }]).light)
      .toEqual({ on: "effect", dim: 20, units: "ft" });
  });
});

describe("§52 : sources de lumière portées", () => {
  it("un cône garde son angle, un cercle n'en a pas", () => {
    const cone = tokenLightChanges({ bright: 60, dim: 120, angle: 53 });
    expect(cone.find(c => c.key === "token.light.angle")?.value).toBe("53");
    expect(tokenLightChanges({ bright: 20, dim: 40 }).some(c => c.key === "token.light.angle")).toBe(false);
    expect(tokenLightChanges({ bright: 20, dim: 40, angle: 360 }).some(c => c.key === "token.light.angle")).toBe(false);
  });
  it("carriedLight et kindles se valident", () => {
    expect(validateEntry({ carriedLight: { bright: 20, dim: 40, units: "ft", animation: { type: "torch" } } })).toEqual([]);
    expect(validateEntry({ carriedLight: { bright: 60, dim: 120, units: "ft", angle: 53 } })).toEqual([]);
    expect(validateEntry({ carriedLight: { bright: 20, units: "ft" } })).toHaveLength(1);
    expect(validateEntry({ carriedLight: { bright: 20, dim: 40, units: "ft", angle: 400 } })).toHaveLength(1);
    expect(validateEntry({ kindles: true })).toEqual([]);
    expect(validateEntry({ kindles: "oui" })).toHaveLength(1);
  });
});
