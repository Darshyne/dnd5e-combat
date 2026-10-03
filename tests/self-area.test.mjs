import { describe, it, expect } from "vitest";
import { selfAreaShape, aimedAreaShape, aimFrom, cubeBeside } from "../module/scripts/core/self-area.mjs";

describe("zone « sur soi » posée d'office (§47)", () => {
  it("émanation de portée personnelle : rattachée au lanceur (Lames tourbillonnantes, Esprits gardiens)", () => {
    expect(selfAreaShape({ rangeUnits: "self", type: "radius", count: "", size: 10 })).toBe("emanation");
  });
  it("sphère ou cercle de portée personnelle : centré sur le lanceur (Hurlement terrifiant)", () => {
    expect(selfAreaShape({ rangeUnits: "self", type: "sphere", size: 30 })).toBe("circle");
    expect(selfAreaShape({ rangeUnits: "self", type: "circle", size: 30 })).toBe("circle");
  });
  it("une direction ou un endroit à choisir : pose de dnd5e (souffles, Vague tonnante, Mur de feu)", () => {
    for ( const type of ["cone", "line", "cube", "cylinder", "wall", "square"] ) {
      expect(selfAreaShape({ rangeUnits: "self", type, size: 15 })).toBe(null);
    }
  });
  it("une autre portée, plusieurs zones ou pas de taille : pose de dnd5e", () => {
    expect(selfAreaShape({ rangeUnits: "ft", type: "radius", size: 10 })).toBe(null);
    expect(selfAreaShape({ rangeUnits: "self", type: "radius", count: 2, size: 10 })).toBe(null);
    expect(selfAreaShape({ rangeUnits: "self", type: "radius", size: null })).toBe(null);
  });
});

describe("cône ou ligne visé depuis le lanceur (§59)", () => {
  it("cône ou ligne de portée personnelle : visé autour du lanceur (souffles, Mains brûlantes, Éclair)", () => {
    expect(aimedAreaShape({ rangeUnits: "self", type: "cone", size: 15 })).toBe("cone");
    expect(aimedAreaShape({ rangeUnits: "self", type: "line", size: 100 })).toBe("line");
    expect(aimedAreaShape({ rangeUnits: "self", type: "cube", size: 15 })).toBe("cube");
  });
  it("autre forme, autre portée, plusieurs zones ou pas de taille : pose de dnd5e", () => {
    for ( const type of ["radius", "sphere", "cylinder", "wall"] ) expect(aimedAreaShape({ rangeUnits: "self", type, size: 15 })).toBe(null);
    expect(aimedAreaShape({ rangeUnits: "ft", type: "cone", size: 15 })).toBe(null);
    expect(aimedAreaShape({ rangeUnits: "self", type: "cone", count: 2, size: 15 })).toBe(null);
    expect(aimedAreaShape({ rangeUnits: "self", type: "cone", size: 0 })).toBe(null);
  });
  const body = { x: 100, y: 100, width: 100, height: 100 };   // centre (150, 150)
  const near = (got, want) => { for ( const k of Object.keys(want) ) expect(got[k]).toBeCloseTo(want[k], 6); };
  it("le sommet est sur le bord de l'espace, du côté visé — jamais sous le lanceur", () => {
    near(aimFrom(body, { x: 400, y: 150 }), { x: 200, y: 150, rotation: 0 });
    near(aimFrom(body, { x: 150, y: 400 }), { x: 150, y: 200, rotation: 90 });
    near(aimFrom(body, { x: -50, y: 150 }), { x: 100, y: 150, rotation: 180 });
    near(aimFrom(body, { x: 150, y: 0 }), { x: 150, y: 100, rotation: 270 });
  });
  it("en diagonale, le sommet est au coin (le point d'origine sur une intersection de la grille)", () => {
    near(aimFrom(body, { x: 300, y: 300 }), { x: 200, y: 200, rotation: 45 });
    near(aimFrom(body, { x: 0, y: 0 }), { x: 100, y: 100, rotation: 225 });
  });
  it("un grand lanceur pivote autour de son centre", () => {
    near(aimFrom({ x: 0, y: 0, width: 200, height: 200 }, { x: 100, y: 500 }), { x: 100, y: 200, rotation: 90 });
  });
  it("espace elliptique : le sommet est sur l'ellipse", () => {
    const p = aimFrom(body, { x: 300, y: 300 }, { ellipse: true });
    expect(Math.hypot(p.x - 150, p.y - 150)).toBeCloseTo(50, 6);
  });
  it("souris au centre : la direction de repli (dernière visée), sinon vers la droite", () => {
    near(aimFrom(body, { x: 150, y: 150 }), { x: 200, y: 150, rotation: 0 });
    near(aimFrom(body, { x: 150, y: 150 }, { fallback: { x: 0, y: 1 } }), { x: 150, y: 200, rotation: 90 });
  });
});

describe("cube accolé au lanceur (§59, Vague tonnante)", () => {
  // Lanceur Moyen en (100, 100), cases de 100 px ; cube de 15 ft = 300 px.
  const body = { x: 100, y: 100, width: 100, height: 100 };
  const opts = { step: 100 };
  it("du côté de la souris, centré sur elle quand c'est possible", () => {
    expect(cubeBeside(body, { x: 600, y: 150 }, 300, opts)).toEqual({ x: 200, y: 0 });
    expect(cubeBeside(body, { x: -400, y: 150 }, 300, opts)).toEqual({ x: -200, y: 0 });
    expect(cubeBeside(body, { x: 150, y: 600 }, 300, opts)).toEqual({ x: 0, y: 200 });
    expect(cubeBeside(body, { x: 150, y: -400 }, 300, opts)).toEqual({ x: 0, y: -200 });
  });
  it("glisse le long du côté, calé sur la grille, jusqu'au coin — jamais par-dessus le lanceur", () => {
    expect(cubeBeside(body, { x: 600, y: 260 }, 300, opts)).toEqual({ x: 200, y: 100 });
    expect(cubeBeside(body, { x: 600, y: 900 }, 300, opts)).toEqual({ x: 200, y: 200 });
    expect(cubeBeside(body, { x: 600, y: -700 }, 300, opts)).toEqual({ x: 200, y: -200 });
  });
  it("en diagonale : le cube touche le lanceur par le coin", () => {
    expect(cubeBeside(body, { x: 700, y: 700 }, 300, opts)).toEqual({ x: 200, y: 200 });
    expect(cubeBeside(body, { x: -500, y: -500 }, 300, opts)).toEqual({ x: -200, y: -200 });
  });
  it("sans grille : position libre le long du côté", () => {
    expect(cubeBeside(body, { x: 600, y: 170 }, 300)).toEqual({ x: 200, y: 20 });
  });
  it("souris au centre : la direction de repli", () => {
    expect(cubeBeside(body, { x: 150, y: 150 }, 300, { ...opts, fallback: { x: 0, y: 1 } })).toEqual({ x: 0, y: 200 });
  });
});
