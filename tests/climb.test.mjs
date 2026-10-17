import { describe, it, expect } from "vitest";
import {
  segmentTouchesRect, isClimbableWall, climbSpeed, climbMultiplier, climbFallReason, climbableCells, climbCheckDue, MAX_CLIMB_CELLS
} from "../module/scripts/core/climb.mjs";
import { overlapsVertically } from "../module/scripts/core/space.mjs";

const cell = { x: 100, y: 100, width: 100, height: 100 };

describe("près d'un mur (§192)", () => {
  it("un mur sur le bord de la case la touche, un mur à côté non", () => {
    expect(segmentTouchesRect({ x: 100, y: 0 }, { x: 100, y: 300 }, cell)).toBe(true);     // le long du bord gauche
    expect(segmentTouchesRect({ x: 0, y: 200 }, { x: 300, y: 200 }, cell)).toBe(true);     // le long du bord bas
    expect(segmentTouchesRect({ x: 50, y: 0 }, { x: 50, y: 300 }, cell)).toBe(false);      // une demi-case plus loin
    expect(segmentTouchesRect({ x: 0, y: 0 }, { x: 300, y: 300 }, cell)).toBe(true);       // la diagonale traverse
    expect(segmentTouchesRect({ x: 0, y: 250 }, { x: 300, y: 250 }, cell)).toBe(false);    // sous la case
  });
  it("la tolérance rattrape un mur tracé un peu à côté", () => {
    expect(segmentTouchesRect({ x: 92, y: 0 }, { x: 92, y: 300 }, cell, 10)).toBe(true);
    expect(segmentTouchesRect({ x: 80, y: 0 }, { x: 80, y: 300 }, cell, 10)).toBe(false);
  });
  it("un segment entièrement dans la case compte", () => {
    expect(segmentTouchesRect({ x: 120, y: 120 }, { x: 180, y: 180 }, cell)).toBe(true);
  });
  it("une porte ouverte, un mur sans restriction de déplacement, un mur de sort (sauf Mur de pierre) ne se grimpent pas", () => {
    expect(isClimbableWall({ move: true, openDoor: false })).toBe(true);
    expect(isClimbableWall({ move: true, openDoor: true })).toBe(false);
    expect(isClimbableWall({ move: false, openDoor: false })).toBe(false);
    expect(isClimbableWall({ move: true, openDoor: false, spell: "wall-of-fire" })).toBe(false);
    expect(isClimbableWall({ move: true, openDoor: false, spell: "wall-of-stone" })).toBe(true);
  });
});

describe("vitesse et coût", () => {
  it("l'escalade borne le tour si la fiche en a une, sinon la marche", () => {
    expect(climbSpeed({ walk: 30, climb: 20 })).toEqual({ speed: 20, native: true });
    expect(climbSpeed({ walk: 30 })).toEqual({ speed: 30, native: false });
    expect(climbSpeed({ walk: 30, climb: 0 })).toEqual({ speed: 30, native: false });
    expect(climbSpeed({})).toEqual({ speed: 0, native: false });
  });
  it("un pied coûte deux pieds sans vitesse d'escalade", () => {
    expect(climbMultiplier({ walk: 30 })).toBe(2);
    expect(climbMultiplier({ walk: 30, climb: 30 })).toBe(1);
  });
  it("les cases qu'on peut monter : budget, plafond, limite", () => {
    // 30 ft restants, 5 ft la case, ×2 : trois cases.
    expect(climbableCells({ remaining: 30, gridDistance: 5, multiplier: 2 })).toBe(3);
    expect(climbableCells({ remaining: 30, gridDistance: 5, multiplier: 1 })).toBe(6);
    expect(climbableCells({ remaining: 30, gridDistance: 5, multiplier: 1, ceilingCells: 2 })).toBe(2);
    expect(climbableCells({ remaining: 7, gridDistance: 5, multiplier: 2 })).toBe(0);
    expect(climbableCells({ remaining: Infinity, gridDistance: 5, multiplier: 2 })).toBe(MAX_CLIMB_CELLS);
    expect(climbableCells({ remaining: Infinity, gridDistance: 5, multiplier: 2, ceilingCells: 2.9 })).toBe(2);
    expect(climbableCells({ remaining: Infinity, gridDistance: 5, multiplier: 2, ceilingCells: 0 })).toBe(0);
  });
});

describe("chute", () => {
  it("À terre, Neutralisé, Agrippé ou sans vitesse : on tombe", () => {
    expect(climbFallReason({ speed: 30 })).toBeNull();
    expect(climbFallReason({ prone: true, speed: 30 })).toBe("prone");
    expect(climbFallReason({ incapacitated: true, speed: 30 })).toBe("incapacitated");
    expect(climbFallReason({ grappled: true, speed: 30 })).toBe("grappled");
    expect(climbFallReason({ speed: 0 })).toBe("noSpeed");
  });
  it("le test « maison » est dû après l'intervalle, ou s'il n'a jamais été fait", () => {
    expect(climbCheckDue(null, 1000, 10000)).toBe(true);
    expect(climbCheckDue(0, 9000, 10000)).toBe(false);
    expect(climbCheckDue(0, 10000, 10000)).toBe(true);
  });
});

describe("occupation en trois dimensions", () => {
  it("un grimpeur au-dessus d'une créature au sol n'occupe pas sa case", () => {
    expect(overlapsVertically({ elevation: 0, depth: 1 }, { elevation: 0, depth: 1 }, 5)).toBe(true);
    expect(overlapsVertically({ elevation: 10, depth: 1 }, { elevation: 0, depth: 1 }, 5)).toBe(false);
    expect(overlapsVertically({ elevation: 5, depth: 1 }, { elevation: 0, depth: 1 }, 5)).toBe(true);   // tête contre pieds : contact
    expect(overlapsVertically({ elevation: 5, depth: 1 }, { elevation: 0, depth: 2 }, 5)).toBe(true);   // un Grand de 10 ft
    expect(overlapsVertically({ elevation: 15, depth: 1 }, { elevation: 0, depth: 2 }, 5)).toBe(false);
  });
});
