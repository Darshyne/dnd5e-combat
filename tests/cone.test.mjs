import { describe, it, expect } from "vitest";
import { parseConeAngles, coneAngleFor, bearingOf, angleBetween, inCone, formatConeAngles, DEFAULT_CONE_ANGLES } from "../module/scripts/core/cone.mjs";

describe("§182 cônes de vision", () => {
  it("caps dans la convention du cœur : 0 en bas, 90 à gauche, sens horaire", () => {
    expect(bearingOf(0, 1)).toBeCloseTo(0);
    expect(bearingOf(-1, 0)).toBeCloseTo(90);
    expect(bearingOf(0, -1)).toBeCloseTo(180);
    expect(bearingOf(1, 0)).toBeCloseTo(270);
    expect(angleBetween(350, 10)).toBeCloseTo(20);
    expect(angleBetween(10, 350)).toBeCloseTo(-20);
  });

  it("dans le cône ou dans le dos", () => {
    const eye = { x: 0, y: 0 };
    expect(inCone(eye, 0, 120, [{ x: 0, y: 100 }])).toBe(true);          // devant (en bas)
    expect(inCone(eye, 0, 120, [{ x: 0, y: -100 }])).toBe(false);        // derrière
    expect(inCone(eye, 0, 120, [{ x: 100, y: 100 }])).toBe(true);        // à 45°
    expect(inCone(eye, 0, 60, [{ x: 100, y: 100 }])).toBe(false);
    expect(inCone(eye, 180, 120, [{ x: 0, y: -100 }])).toBe(true);       // tourné vers le haut
    expect(inCone(eye, 0, 360, [{ x: 0, y: -100 }])).toBe(true);
    expect(inCone(eye, 0, 90, [{ x: 0, y: -100 }, { x: 10, y: 100 }])).toBe(true);   // un coin suffit
  });

  it("réglage : défaut, types, ce qui ne se lit pas est ignoré ; aller-retour", () => {
    const t = parseConeAngles("100; beast 150; Goblinoid: 90; n'importe quoi; ooze 999");
    expect(t).toEqual({ default: 100, beast: 150, goblinoid: 90, ooze: 360 });
    expect(parseConeAngles(formatConeAngles())).toEqual({ ...DEFAULT_CONE_ANGLES });
    expect(coneAngleFor(t, { type: "humanoid", subtype: "goblinoid" })).toBe(90);
    expect(coneAngleFor(t, { type: "beast" })).toBe(150);
    expect(coneAngleFor(t, { type: "undead" })).toBe(100);
    expect(coneAngleFor({ ...t, wolf: 200 }, { type: "beast", identifier: "Wolf" })).toBe(200);
  });
});
