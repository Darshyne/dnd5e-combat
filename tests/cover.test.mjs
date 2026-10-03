import { describe, it, expect } from "vitest";
import { coverBetween, segmentCrossesRect, corners, shrink, COVER } from "../module/scripts/core/cover.mjs";

// Cases de 100 px. Attaquant en (0,0), cible deux cases à droite.
const cell = (i, j, w=1, h=1) => ({ x: j * 100, y: i * 100, width: w * 100, height: h * 100 });
const attacker = cell(0, 0);
const target = cell(0, 3);

/** Un mur vertical en x, entre y0 et y1 : bloque toute ligne qui le traverse. */
const wall = (x, y0, y1) => (a, b) => {
  if ( (a.x < x) === (b.x < x) ) return false;
  const t = (x - a.x) / (b.x - a.x);
  const y = a.y + t * (b.y - a.y);
  return (y >= y0) && (y <= y1);
};

describe("géométrie", () => {
  it("un segment traverse un rectangle, pas s'il l'effleure ou le manque", () => {
    const r = cell(0, 1);
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 250, y: 50 }, r)).toBe(true);
    expect(segmentCrossesRect({ x: 50, y: 150 }, { x: 250, y: 150 }, r)).toBe(false);   // passe dessous
    expect(segmentCrossesRect({ x: 0, y: 100 }, { x: 200, y: 100 }, r)).toBe(false);     // longe le bord
    expect(segmentCrossesRect({ x: 100, y: 0 }, { x: 100, y: 100 }, r)).toBe(false);     // longe le bord
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 80, y: 50 }, r)).toBe(false);       // s'arrête avant
  });

  it("coins et retrait", () => {
    expect(corners(cell(0, 0))).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]);
    expect(shrink(cell(0, 0), 10)).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    expect(shrink(cell(0, 0), 500).width).toBeGreaterThan(0);   // jamais au-delà du centre
  });
});

describe("abri (règle du DMG, 2024)", () => {
  it("à découvert : pas d'abri", () => {
    expect(coverBetween({ attacker, target })).toMatchObject({ degree: "none", bonus: 0, blockedLines: 0 });
  });

  it("un mur qui coupe toutes les lignes : abri total, intouchable", () => {
    const cover = coverBetween({ attacker, target, blocked: wall(200, -1000, 1000), inset: 10 });
    expect(cover).toMatchObject({ degree: "total", bonus: null, blockedLines: 4 });
  });

  it("un muret qui ne coupe que les lignes basses : demi-abri depuis le meilleur coin", () => {
    // Mur en x=200 de y=40 à y=1000. Depuis le coin haut-droit (90,10) : seule la ligne vers (310,90)
    // le coupe (y=50 en x=200) ; depuis les coins du bas, tout est coupé. Le meilleur coin donne un demi-abri.
    const cover = coverBetween({ attacker, target, blocked: wall(200, 40, 1000), inset: 10 });
    expect(cover.degree).toBe("half");
    expect(cover.bonus).toBe(COVER.half.bonus);
  });

  it("trois lignes bloquées depuis le meilleur coin : abri de trois quarts", () => {
    // Tout est bloqué sauf une ligne, du coin haut de l'attaquant vers le coin haut-gauche de la cible.
    const blocked = (a, b) => !((a.y === 10) && (b.y === 10) && (b.x === 310));
    const cover = coverBetween({ attacker, target, blocked, inset: 10 });
    expect(cover).toMatchObject({ degree: "threeQuarters", bonus: 5, blockedLines: 3 });
  });

  it("l'attaquant choisit le coin qui laisse le moins d'abri", () => {
    // Bloque tout depuis les coins de gauche (x=10), rien depuis ceux de droite (x=90).
    const blocked = a => a.x === 10;
    expect(coverBetween({ attacker, target, blocked, inset: 10 }).degree).toBe("none");
  });

  it("une créature interposée donne un demi-abri, jamais plus", () => {
    // Un corps de deux cases de haut, entre les deux : toutes les lignes le traversent.
    const bodies = [cell(-1, 1, 1, 3)];
    const cover = coverBetween({ attacker, target, bodies, inset: 10 });
    expect(cover).toMatchObject({ degree: "half", bonus: 2, byCreature: true });
  });

  it("un mur et une créature : l'abri du mur prime, la créature ne l'aggrave pas", () => {
    const cover = coverBetween({ attacker, target, bodies: [cell(0, 1)], blocked: wall(250, -1000, 1000), inset: 10 });
    expect(cover).toMatchObject({ degree: "total", byCreature: false });
  });

  it("une créature qui n'est pas entre les deux ne compte pas", () => {
    expect(coverBetween({ attacker, target, bodies: [cell(3, 3)], inset: 10 }).degree).toBe("none");
  });
});

import { bodyGivesCover } from "../module/scripts/core/cover.mjs";

describe("un mort interposé", () => {
  it("ne couvre que s'il est Grand ou plus", () => {
    expect(bodyGivesCover({ dead: false, size: "med" })).toBe(true);
    expect(bodyGivesCover({ dead: true, size: "med" })).toBe(false);
    expect(bodyGivesCover({ dead: true, size: "sm" })).toBe(false);
    expect(bodyGivesCover({ dead: true, size: "lg" })).toBe(true);
    expect(bodyGivesCover({ dead: true, size: "huge" })).toBe(true);
  });
});
