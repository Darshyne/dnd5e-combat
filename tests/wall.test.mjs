import { describe, it, expect } from "vitest";
import { polylineLength, clampPolyline, wallLineShapes, lineAxis, polygonEdges } from "../module/scripts/core/wall.mjs";

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
