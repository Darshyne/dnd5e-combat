import { describe, it, expect } from "vitest";
import { clampToCircle } from "../module/scripts/core/storm.mjs";

describe("§70 : l'éclair reste sous le nuage", () => {
  const center = { x: 100, y: 100 };
  it("un point sous le nuage reste où il est", () => expect(clampToCircle({ x: 130, y: 90 }, center, 50)).toEqual({ x: 130, y: 90 }));
  it("un point hors du nuage est ramené sur son bord", () => expect(clampToCircle({ x: 300, y: 100 }, center, 50)).toEqual({ x: 150, y: 100 }));
  it("le centre lui-même", () => expect(clampToCircle(center, center, 50)).toEqual(center));
});
