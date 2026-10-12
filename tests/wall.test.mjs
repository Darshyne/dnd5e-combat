import { describe, it, expect } from "vitest";
import { polylineLength, clampPolyline, wallLineShapes, lineAxis, polygonEdges, orthogonalize, sideOfSegment, wallGeometry, defaultSide, sideShapes, ringShapes, crossesWall, touchesWall, wallLightPoints, cellWallShapes, innerRingShapes } from "../module/scripts/core/wall.mjs";

describe("§162 : mur posé par points", () => {
  it("la ligne brisée ramenée à la longueur du sort", () => {
    const pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }];
    expect(polylineLength(pts)).toBe(700);
    expect(clampPolyline(pts, 500)).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }]);
    expect(clampPolyline(pts, 300)).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    expect(clampPolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });
  it("un segment, une forme « line » ; son axe en revient", () => {
    const [a, b] = wallLineShapes([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 14);
    expect(a).toEqual({ type: "line", x: 0, y: 0, rotation: 0, length: 100, width: 14 });
    expect(b.rotation).toBe(90);
    expect(lineAxis(b)).toEqual([100, 0, 100, 100]);
  });
  it("les arêtes d'un polygone fermé", () => {
    expect(polygonEdges([0, 0, 10, 0, 10, 10])).toEqual([[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 0]]);
  });
});

describe("§169 : mur à face brûlante", () => {
  it("pas de diagonale : chaque point aligné sur le précédent", () => {
    expect(orthogonalize([{ x: 0, y: 0 }, { x: 300, y: 40 }, { x: 260, y: 500 }])).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }]);
  });
  it("la géométrie : segments, ou anneau (disque posé, puis anneau fin)", () => {
    const line = { type: "line", x: 0, y: 0, rotation: 0, length: 200, width: 20 };
    expect(wallGeometry([line])).toEqual({ lines: [[0, 0, 200, 0]] });
    expect(wallGeometry([{ type: "circle", x: 50, y: 50, radius: 200 }])).toEqual({ ring: { x: 50, y: 50, radius: 200 } });
    expect(wallGeometry(ringShapes({ x: 50, y: 50, radius: 200 }, 20))).toEqual({ ring: { x: 50, y: 50, radius: 200 } });
    expect(wallGeometry([{ type: "ring", x: 50, y: 50, radius: 200, innerWidth: 0, outerWidth: 28 }])).toEqual({ ring: { x: 50, y: 50, radius: 214 } });
    expect(wallGeometry([{ type: "ellipse", x: 50, y: 50, radiusX: 200, radiusY: 200 }])).toEqual({ ring: { x: 50, y: 50, radius: 200 } });
  });
  it("le côté brûlant par défaut : à l'opposé du lanceur", () => {
    const g = { lines: [[0, 0, 200, 0]] };
    expect(sideOfSegment(g.lines[0], { x: 100, y: -50 })).toBe(1);   // au nord d'un tracé vers l'est : à gauche
    expect(defaultSide(g, { x: 100, y: -50 })).toBe(-1);
    expect(defaultSide(g, { x: 100, y: 50 })).toBe(1);
    const ring = { ring: { x: 0, y: 0, radius: 200 } };
    expect(defaultSide(ring, { x: 10, y: 0 })).toBe(-1);   // dedans : l'extérieur brûle
    expect(defaultSide(ring, { x: 500, y: 0 })).toBe(1);
  });
  it("les formes de la face brûlante", () => {
    const [north] = sideShapes({ lines: [[0, 0, 200, 0]] }, 1, 200);
    expect(north).toEqual({ type: "polygon", points: [0, 0, 200, 0, 200, -200, 0, -200] });
    const [south] = sideShapes({ lines: [[0, 0, 200, 0]] }, -1, 200);
    expect(south.points).toEqual([0, 0, 200, 0, 200, 200, 0, 200]);
    expect(sideShapes({ ring: { x: 0, y: 0, radius: 200 } }, -1, 200)).toEqual([{ type: "ring", x: 0, y: 0, radius: 200, innerWidth: 0, outerWidth: 200 }]);
    expect(sideShapes({ ring: { x: 0, y: 0, radius: 200 } }, 1, 200)).toEqual([{ type: "circle", x: 0, y: 0, radius: 200 }]);
  });
  it("traverser le mur : un pas d'un centre à l'autre qui coupe la ligne, ou le cercle", () => {
    const g = { lines: [[0, 0, 300, 0]] };
    expect(crossesWall(g, [{ x: 50, y: -50 }, { x: 50, y: 50 }])).toBe(true);
    expect(crossesWall(g, [{ x: 50, y: -50 }, { x: 150, y: -50 }])).toBe(false);
    expect(crossesWall(g, [{ x: 350, y: -50 }, { x: 350, y: 50 }])).toBe(false);   // au-delà du bout
    const ring = { ring: { x: 0, y: 0, radius: 200 } };
    expect(crossesWall(ring, [{ x: 150, y: 0 }, { x: 250, y: 0 }])).toBe(true);
    expect(crossesWall(ring, [{ x: 50, y: 0 }, { x: 150, y: 0 }])).toBe(false);
  });
  it("à l'apparition : les espaces qui touchent le mur, des deux côtés, pas par un coin", () => {
    const g = { lines: [[0, 0, 300, 0]] };
    expect(touchesWall(g, { x: 0, y: -100, width: 100, height: 100 })).toBe(true);    // au nord, le long
    expect(touchesWall(g, { x: 100, y: 0, width: 100, height: 100 })).toBe(true);     // au sud
    expect(touchesWall(g, { x: 0, y: 100, width: 100, height: 100 })).toBe(false);    // une case plus loin
    expect(touchesWall(g, { x: 300, y: 0, width: 100, height: 100 })).toBe(false);    // par le coin du bout
    const ring = { ring: { x: 0, y: 0, radius: 200 } };
    expect(touchesWall(ring, { x: 150, y: -50, width: 100, height: 100 })).toBe(true);
    expect(touchesWall(ring, { x: -50, y: -50, width: 100, height: 100 })).toBe(false);   // au centre
  });
});

describe("§170 : les lumières d'un mur", () => {
  it("de part et d'autre de la ligne, bouts compris", () => {
    const pts = wallLightPoints({ lines: [[0, 0, 280, 0]] }, 280, 10);
    expect(pts).toEqual([{ x: 0, y: -10 }, { x: 0, y: 10 }, { x: 280, y: -10 }, { x: 280, y: 10 }]);
  });
  it("autour d'un anneau, dedans et dehors", () => {
    const pts = wallLightPoints({ ring: { x: 0, y: 0, radius: 280 } }, 280, 10);
    expect(pts.length).toBe(14);
    expect(pts.slice(0, 2)).toEqual([{ x: 270, y: 0 }, { x: 290, y: 0 }]);
  });
});

describe("§172 : mur épais sur les cases", () => {
  it("des centres de case, sans diagonale, prolongés d'une demi-case ; la longueur du sort tenue bouts compris", () => {
    // Cases de 100 px : de (50, 50) à (350, 60) → une rangée de 4 cases, 400 px.
    const [s] = cellWallShapes([{ x: 50, y: 50 }, { x: 350, y: 60 }], 1000, 100, 50);
    expect(s).toEqual({ type: "line", x: 0, y: 50, rotation: 0, length: 400, width: 100 });
    // Longueur du sort 300 px : trois cases au plus.
    expect(cellWallShapes([{ x: 50, y: 50 }, { x: 350, y: 50 }], 300, 100, 50)[0].length).toBe(300);
    // Une seule case.
    expect(cellWallShapes([{ x: 50, y: 50 }], 300, 100, 50)).toEqual([{ type: "line", x: 0, y: 50, rotation: 0, length: 100, width: 100 }]);
  });
  it("l'anneau : une bande à l'intérieur du cercle", () => {
    expect(innerRingShapes({ x: 0, y: 0, radius: 280 }, 140)).toEqual([{ type: "ring", x: 0, y: 0, radius: 280, innerWidth: 140, outerWidth: 0 }]);
    expect(wallGeometry(innerRingShapes({ x: 0, y: 0, radius: 280 }, 140)).ring.radius).toBe(210);
  });
});
