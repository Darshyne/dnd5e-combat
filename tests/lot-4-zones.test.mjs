import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { rectOfShape, pointInRect, contiguousRects, anyShapeTakes } from "../module/scripts/core/space.mjs";

const cube = (x, y, side=100) => ({ x0: x, y0: y, x1: x + side, y1: y + side });

describe("§286 : zones de plusieurs formes", () => {
  it("rectangle d'une forme de région, ancre comprise ; pas pour un cercle", () => {
    expect(rectOfShape({ type: "rectangle", x: 100, y: 200, width: 50, height: 60 })).toEqual({ x0: 100, y0: 200, x1: 150, y1: 260 });
    expect(rectOfShape({ type: "rectangle", x: 100, y: 200, width: 50, height: 60, anchorX: 0.5, anchorY: 0.5 })).toEqual({ x0: 75, y0: 170, x1: 125, y1: 230 });
    expect(rectOfShape({ type: "circle", x: 0, y: 0, radius: 5 })).toBeNull();
    expect(pointInRect({ x: 150, y: 260 }, cube(50, 160))).toBe(true);
    expect(pointInRect({ x: 151, y: 100 }, cube(50, 0))).toBe(false);
  });

  it("Tempête de feu : des cubes reliés par une face sont contigus, un coin seul ne suffit pas", () => {
    expect(contiguousRects([cube(0, 0)])).toBe(true);
    expect(contiguousRects([cube(0, 0), cube(100, 0), cube(200, 0), cube(200, 100)])).toBe(true);
    expect(contiguousRects([cube(0, 0), cube(50, 50)])).toBe(true);   // chevauchement
    expect(contiguousRects([cube(0, 0), cube(100, 100)])).toBe(false);   // coin seul
    expect(contiguousRects([cube(0, 0), cube(100, 0), cube(400, 0)])).toBe(false);   // un cube isolé
  });

  it("une créature est prise si une forme la contient et l'atteint — une seule fois", () => {
    expect(anyShapeTakes([])).toEqual({ inVolume: null, lineOfEffect: null });
    // Dans la deuxième sphère seulement.
    expect(anyShapeTakes([{ inShape: false, lineOfEffect: true }, { inShape: true, lineOfEffect: true }])).toEqual({ inVolume: true, lineOfEffect: true });
    // Dans deux sphères : prise (une fois).
    expect(anyShapeTakes([{ inShape: true, lineOfEffect: true }, { inShape: true, lineOfEffect: true }])).toEqual({ inVolume: true, lineOfEffect: true });
    // Dans une sphère dont l'origine est derrière un plancher, et l'autre l'atteint mais ne la contient pas : épargnée.
    expect(anyShapeTakes([{ inShape: true, lineOfEffect: false }, { inShape: false, lineOfEffect: true }])).toEqual({ inVolume: null, lineOfEffect: false });
    // Hors de toute sphère.
    expect(anyShapeTakes([{ inShape: false, lineOfEffect: true }, { inShape: false, lineOfEffect: null }])).toEqual({ inVolume: false, lineOfEffect: null });
    // Cubes : appartenance inconnue (null) — l'origine qui l'atteint suffit.
    expect(anyShapeTakes([{ inShape: null, lineOfEffect: null }])).toEqual({ inVolume: null, lineOfEffect: null });
  });
});

describe("§286 : Chaîne d'éclairs", () => {
  it("cibles secondaires à 9 m de la première", () => {
    expect(CONTENT["chain-lightning"].chain).toEqual({ radius: 30, units: "ft" });
  });

  it("schéma de `chain`", () => {
    expect(validateEntry({ chain: { radius: 30, units: "ft" } }, { at: "x." })).toEqual([]);
    expect(validateEntry({ chain: { radius: 0, units: "ft" } }, { at: "x." }).length).toBe(1);
    expect(validateEntry({ chain: { radius: 30 } }, { at: "x." }).length).toBe(1);
    expect(validateEntry({ chain: { radius: 30, units: "ft", max: 3 } }, { at: "x." }).length).toBe(1);
  });

  it("Invocation de volée et Vague destructrice : les alliés du lanceur épargnés (§263)", () => {
    expect(CONTENT["conjure-volley"].zoneAffects).toBe("enemy");
    expect(CONTENT["destructive-wave"].zoneAffects).toBe("enemy");
  });
});
