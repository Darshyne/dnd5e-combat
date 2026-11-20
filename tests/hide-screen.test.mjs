import { describe, it, expect } from "vitest";
import { largerBy, segmentCrossesRect, screenedByLarger } from "../module/scripts/core/hide-screen.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const cell = (col, row, size=1) => ({ x: col * 100, y: row * 100, width: size * 100, height: size * 100 });

describe("Discrétion naturelle : masqué par une créature plus grande", () => {
  it("largerBy : au moins une taille de plus", () => {
    expect(largerBy("med", "sm")).toBe(true);
    expect(largerBy("lg", "sm")).toBe(true);
    expect(largerBy("sm", "sm")).toBe(false);
    expect(largerBy("tiny", "sm")).toBe(false);
    expect(largerBy(undefined, "sm")).toBe(false);
    expect(largerBy("med", undefined)).toBe(false);
  });

  it("segmentCrossesRect : la ligne passe par l'espace, ou à côté", () => {
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 450, y: 50 }, cell(2, 0))).toBe(true);
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 450, y: 50 }, cell(2, 2))).toBe(false);
    // Le segment s'arrête avant le rectangle.
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 150, y: 50 }, cell(2, 0))).toBe(false);
    // En diagonale.
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 450, y: 450 }, cell(2, 2))).toBe(true);
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 450, y: 450 }, cell(4, 0))).toBe(false);
  });

  const hider = { rect: cell(0, 0), size: "sm" };
  it("une créature M entre l'observateur et un halfelin P : masqué", () => {
    expect(screenedByLarger(cell(4, 0), hider, [{ rect: cell(2, 0), size: "med" }])).toBe(true);
  });
  it("une créature de sa taille, ou plus petite, ne le masque pas", () => {
    expect(screenedByLarger(cell(4, 0), hider, [{ rect: cell(2, 0), size: "sm" }])).toBe(false);
    expect(screenedByLarger(cell(4, 0), hider, [{ rect: cell(2, 0), size: "tiny" }])).toBe(false);
  });
  it("la créature plus grande n'est pas sur la ligne : il reste vu", () => {
    expect(screenedByLarger(cell(4, 0), hider, [{ rect: cell(2, 3), size: "lg" }])).toBe(false);
    expect(screenedByLarger(cell(4, 0), hider, [])).toBe(false);
  });
  it("contenu et schéma", () => {
    expect(CONTENT["naturally-stealthy"].hidesBehindLarger).toBe(true);
    expect(validateEntry(CONTENT["naturally-stealthy"])).toEqual([]);
    expect(validateEntry({ hidesBehindLarger: "oui" }).length).toBeGreaterThan(0);
  });
});
