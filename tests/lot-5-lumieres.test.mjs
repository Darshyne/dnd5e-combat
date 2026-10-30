import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { dispelledBy, tokenLightChanges } from "../module/scripts/core/light.mjs";

describe("§287 : lumières des sorts", () => {
  it("Rayon de soleil : le lanceur brille (9 m vive, 9 m faible de plus) à l'« Initial Cast » seulement", () => {
    expect(CONTENT.sunbeam.light).toMatchObject({ on: "caster", activity: "o3kffaumfNGjVvg9", bright: 30, dim: 60, units: "ft" });
    expect(validateEntry({ light: CONTENT.sunbeam.light }, { at: "x." })).toEqual([]);
    const changes = tokenLightChanges({ bright: 30, dim: 60, color: "#fff1c4" });
    expect(changes.map(c => c.key)).toEqual(["token.light.bright", "token.light.dim", "token.light.color"]);
  });

  it("Ténèbres : dissipent les lumières de sort de niveau 2 ou moins", () => {
    expect(CONTENT.darkness.light).toMatchObject({ on: "area", darkness: true, dispels: 2 });
    const sources = [
      { id: "lame", x: 100, y: 0, radius: 50, level: 2 },      // recouverte, niveau 2
      { id: "jour", x: 100, y: 0, radius: 50, level: 3 },      // niveau 3 : reste
      { id: "loin", x: 1000, y: 0, radius: 50, level: 0 },     // trop loin
      { id: "bord", x: 140, y: 0, radius: 50, level: 1 }       // cercles qui se touchent à peine (140 < 100 + 50)
    ];
    expect(dispelledBy({ x: 0, y: 0, radius: 100 }, 2, sources)).toEqual(["lame", "bord"]);
  });

  it("Bouclier de feu : sa lumière (§266) reste déclarée", () => {
    expect(CONTENT["fire-shield"].light).toMatchObject({ on: "effect", bright: 10, dim: 20 });
  });

  it("schéma : `caster` demande un rayon, `activity` n'existe que pour lui", () => {
    expect(validateEntry({ light: { on: "caster" } }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ light: { on: "effect", dim: 10, units: "ft", activity: "o3kffaumfNGjVvg9" } }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ light: { on: "caster", dim: 10, units: "ft", activity: "court" } }, { at: "x." }).length).toBeGreaterThan(0);
  });
});
