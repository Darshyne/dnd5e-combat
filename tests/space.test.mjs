import { describe, it, expect } from "vitest";
import { depthOf, verticalExtent, verticalGap, regionElevationFor, originPointOfShapes, withinSphere, pointBoxDistance } from "../module/scripts/core/space.mjs";

describe("depthOf — hauteur d'une créature en cases", () => {
  it("un Moyen (1×1) fait une case de haut", () => {
    expect(depthOf({ width: 1, height: 1, depth: 1 })).toBe(1);
  });
  it("un Grand (2×2) ou un Énorme (3×3) dont depth est resté à 1 est aussi haut que large", () => {
    expect(depthOf({ width: 2, height: 2, depth: 1 })).toBe(2);
    expect(depthOf({ width: 3, height: 3, depth: 1 })).toBe(3);
  });
  it("une profondeur réglée à la main (≠ 1) l'emporte, même sur un Grand", () => {
    expect(depthOf({ width: 2, height: 2, depth: 0.5 })).toBe(0.5);
    expect(depthOf({ width: 1, height: 1, depth: 4 })).toBe(4);
    expect(depthOf({ width: 2, height: 2, depth: 0 })).toBe(0);
  });
  it("un Très petit (0,5) garde une case de haut", () => {
    expect(depthOf({ width: 0.5, height: 0.5, depth: 1 })).toBe(1);
  });
  it("sans données, une case", () => {
    expect(depthOf()).toBe(1);
  });
});

describe("verticalExtent / verticalGap", () => {
  it("un token va de ses pieds à sa tête", () => {
    expect(verticalExtent({ elevation: 10, depth: 2 }, 5)).toEqual({ bottom: 10, top: 20 });
    expect(verticalExtent({ elevation: 0, depth: 1 }, 5)).toEqual({ bottom: 0, top: 5 });
  });
  it("l'écart est nul quand les tranches se chevauchent ou se touchent", () => {
    expect(verticalGap({ bottom: 0, top: 5 }, { bottom: 5, top: 10 })).toBe(0);
    expect(verticalGap({ bottom: 0, top: 10 }, { bottom: 5, top: 15 })).toBe(0);
    expect(verticalGap({ bottom: 5, top: 10 }, { bottom: 0, top: 20 })).toBe(0);
  });
  it("sinon c'est la distance entre la tête de l'un et les pieds de l'autre, dans les deux sens", () => {
    expect(verticalGap({ bottom: 0, top: 5 }, { bottom: 10, top: 15 })).toBe(5);
    expect(verticalGap({ bottom: 10, top: 15 }, { bottom: 0, top: 5 })).toBe(5);
    expect(verticalGap({ bottom: 0, top: 5 }, { bottom: 60, top: 65 })).toBe(55);
  });
});

describe("regionElevationFor — tranche d'élévation d'une zone", () => {
  const ground = { elevation: 0, depth: 1 };
  const flying = { elevation: 30, depth: 1 };
  const huge = { elevation: 0, depth: 3 };
  it("une sphère est centrée sur l'élévation d'origine (Boule de feu, 20 ft)", () => {
    expect(regionElevationFor({ type: "sphere", size: 20 }, ground, 5)).toEqual({ bottom: -20, top: 20 });
    expect(regionElevationFor({ type: "sphere", size: 20 }, flying, 5)).toEqual({ bottom: 10, top: 50 });
  });
  it("une émanation entoure le corps du lanceur (Esprits gardiens, 15 ft, lanceur Énorme)", () => {
    expect(regionElevationFor({ type: "radius", size: 15 }, huge, 5)).toEqual({ bottom: -15, top: 30 });
    expect(regionElevationFor({ type: "radius", size: 10 }, ground, 5)).toEqual({ bottom: -10, top: 15 });
  });
  it("un cube est posé et aussi haut que large", () => {
    expect(regionElevationFor({ type: "cube", size: 15 }, ground, 5)).toEqual({ bottom: 0, top: 15 });
    expect(regionElevationFor({ type: "square", size: 10 }, flying, 5)).toEqual({ bottom: 30, top: 40 });
  });
  it("un cylindre est posé, de sa hauteur déclarée (Rayon de lune : 5 ft de rayon, 40 ft de haut)", () => {
    expect(regionElevationFor({ type: "cylinder", size: 5, height: 40 }, ground, 5)).toEqual({ bottom: 0, top: 40 });
  });
  it("un cylindre sans hauteur est aussi haut que son diamètre", () => {
    expect(regionElevationFor({ type: "cylinder", size: 10 }, ground, 5)).toEqual({ bottom: 0, top: 20 });
  });
  it("un cône a la moitié de sa longueur en haut et en bas (Mains brûlantes, 15 ft)", () => {
    expect(regionElevationFor({ type: "cone", size: 15 }, ground, 5)).toEqual({ bottom: -7.5, top: 7.5 });
  });
  it("une ligne a l'épaisseur du lanceur ou sa largeur, la plus grande (Éclair, 100 × 5 ft)", () => {
    expect(regionElevationFor({ type: "line", size: 100, width: 5 }, ground, 5)).toEqual({ bottom: 0, top: 5 });
    expect(regionElevationFor({ type: "line", size: 100, width: 5 }, huge, 5)).toEqual({ bottom: 0, top: 15 });
    expect(regionElevationFor({ type: "line", size: 60, width: 10 }, ground, 5)).toEqual({ bottom: 0, top: 10 });
  });
  it("un mur est posé, de sa hauteur ; un anneau de sa hauteur ou comme une sphère", () => {
    expect(regionElevationFor({ type: "wall", size: 60, width: 1, height: 20 }, ground, 5)).toEqual({ bottom: 0, top: 20 });
    expect(regionElevationFor({ type: "wall", size: 60, width: 10 }, ground, 5)).toEqual({ bottom: 0, top: 10 });
    expect(regionElevationFor({ type: "ring", size: 20, height: 10 }, ground, 5)).toEqual({ bottom: 0, top: 10 });
    expect(regionElevationFor({ type: "ring", size: 20 }, ground, 5)).toEqual({ bottom: -20, top: 20 });
  });
  it("forme inconnue ou sans taille : null, on ne touche à rien", () => {
    expect(regionElevationFor({ type: "sphere" }, ground, 5)).toBe(null);
    expect(regionElevationFor({ type: "sphere", size: 0 }, ground, 5)).toBe(null);
    expect(regionElevationFor({ type: "blob", size: 10 }, ground, 5)).toBe(null);
    expect(regionElevationFor({ type: "" , size: 10 }, ground, 5)).toBe(null);
  });
  it("sans lanceur connu, l'origine est au sol", () => {
    expect(regionElevationFor({ type: "cube", size: 10 }, undefined, 5)).toEqual({ bottom: 0, top: 10 });
  });
});

describe("originPointOfShapes — point d'origine d'une zone", () => {
  const fallback = { x: 1, y: 2 };
  it("centre d'un cercle ou d'une ellipse, origine d'un cône, d'une ligne, d'un anneau", () => {
    expect(originPointOfShapes([{ type: "circle", x: 100, y: 200, radius: 50 }])).toEqual({ x: 100, y: 200 });
    expect(originPointOfShapes([{ type: "ellipse", x: 10, y: 20, radiusX: 5, radiusY: 3 }])).toEqual({ x: 10, y: 20 });
    expect(originPointOfShapes([{ type: "cone", x: 10, y: 20, radius: 300, angle: 53 }])).toEqual({ x: 10, y: 20 });
    expect(originPointOfShapes([{ type: "line", x: 10, y: 20, length: 300, width: 100 }])).toEqual({ x: 10, y: 20 });
    expect(originPointOfShapes([{ type: "ring", x: 10, y: 20, radius: 300 }])).toEqual({ x: 10, y: 20 });
  });
  it("centre d'un rectangle, ancre comprise", () => {
    expect(originPointOfShapes([{ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }])).toEqual({ x: 50, y: 25 });
    expect(originPointOfShapes([{ type: "rectangle", x: 50, y: 25, width: 100, height: 50, anchorX: 0.5, anchorY: 0.5 }])).toEqual({ x: 50, y: 25 });
  });
  it("origine ou centre de masse d'un polygone", () => {
    expect(originPointOfShapes([{ type: "polygon", points: [0, 0, 100, 0, 100, 100, 0, 100], origin: { x: 5, y: 6 } }])).toEqual({ x: 5, y: 6 });
    expect(originPointOfShapes([{ type: "polygon", points: [0, 0, 100, 0, 100, 100, 0, 100] }])).toEqual({ x: 50, y: 50 });
    expect(originPointOfShapes([{ type: "polygon", points: [] }], fallback)).toBe(fallback);
  });
  it("émanation, forme de token, forme inconnue, aucune forme : le repli", () => {
    expect(originPointOfShapes([{ type: "emanation", base: { type: "token" }, radius: 100 }], fallback)).toBe(fallback);
    expect(originPointOfShapes([{ type: "token", x: 0, y: 0, width: 1, height: 1 }], fallback)).toBe(fallback);
    expect(originPointOfShapes([], fallback)).toBe(fallback);
    expect(originPointOfShapes(undefined, null)).toBe(null);
  });
});

describe("withinSphere — une vraie sphère, pas un cylindre (P2)", () => {
  // Unités : pixels partout, case de 100 px = 5 ft. Boule de feu de 20 ft de rayon = 400 px, centrée au sol (z = 0).
  const fireball = { x: 0, y: 0, z: 0, radius: 400 };
  const body = (x, y, z) => ({ x0: x, x1: x + 100, y0: y, y1: y + 100, z0: z, z1: z + 100 });
  it("une créature au bord horizontal, au sol, est dedans", () => {
    expect(withinSphere(fireball, body(300, 0, 0))).toBe(true);
  });
  it("au bord horizontal mais 15 ft en l'air (coin du cylindre), elle est hors de la sphère", () => {
    expect(withinSphere(fireball, body(300, 0, 300))).toBe(false);
  });
  it("juste au-dessus du centre, à 15 ft, elle est dedans", () => {
    expect(withinSphere(fireball, body(-50, -50, 300))).toBe(true);
  });
  it("la distance à une boîte est nulle quand le point est dedans", () => {
    expect(pointBoxDistance({ x: 10, y: 10, z: 10 }, body(0, 0, 0))).toBe(0);
    expect(pointBoxDistance({ x: 200, y: 50, z: 50 }, body(0, 0, 0))).toBe(100);
  });
});
