import { describe, it, expect } from "vitest";
import { attackLineSegments, segmentEntry } from "../module/scripts/core/attack-line.mjs";

describe("ligne de visée : tronçons", () => {
  it("dégagée : un seul tronçon vert", () => {
    expect(attackLineSegments({ degree: "none" })).toEqual([{ from: 0, to: 1, kind: "clear" }]);
  });
  it("cible non vue : bleu", () => {
    expect(attackLineSegments({ degree: "none", unseen: true })).toEqual([{ from: 0, to: 1, kind: "unseen" }]);
  });
  it("abri partiel : vert puis orange à l'obstacle", () => {
    expect(attackLineSegments({ degree: "half", obstacleAt: 0.4 })).toEqual([
      { from: 0, to: 0.4, kind: "clear" }, { from: 0.4, to: 1, kind: "cover" }]);
  });
  it("abri sans obstacle sur l'axe : orange à mi-chemin", () => {
    expect(attackLineSegments({ degree: "threeQuarters" })[1]).toEqual({ from: 0.5, to: 1, kind: "cover" });
  });
  it("abri total : rouge à l'obstacle", () => {
    expect(attackLineSegments({ degree: "total", obstacleAt: 0.3 })).toEqual([
      { from: 0, to: 0.3, kind: "clear" }, { from: 0.3, to: 1, kind: "blocked" }]);
  });
  it("hors de portée : rouge au-delà, et l'emporte sur l'orange", () => {
    expect(attackLineSegments({ degree: "half", obstacleAt: 0.2, rangeEnd: 0.6, unseen: true })).toEqual([
      { from: 0, to: 0.2, kind: "unseen" }, { from: 0.2, to: 0.6, kind: "cover" }, { from: 0.6, to: 1, kind: "blocked" }]);
  });
  it("inatteignable : tout rouge", () => {
    expect(attackLineSegments({ degree: "none", unreachable: true })).toEqual([{ from: 0, to: 1, kind: "blocked" }]);
  });
});

describe("entrée dans un rectangle", () => {
  const r = { x: 100, y: 0, width: 100, height: 100 };
  it("traverse", () => expect(segmentEntry({ x: 0, y: 50 }, { x: 400, y: 50 }, r)).toBeCloseTo(0.25));
  it("manque", () => expect(segmentEntry({ x: 0, y: 150 }, { x: 400, y: 150 }, r)).toBeNull());
});
