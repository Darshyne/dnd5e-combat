import { describe, it, expect } from "vitest";
import { ORDERS, orderPlan, footprintDistance, cellsAtGap } from "../module/scripts/core/orders.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("ordre imposé (§16.59)", () => {
  it("chaque ordre du PHB 2024 a son plan", () => {
    for ( const o of ORDERS ) expect(orderPlan(o), o).not.toBe(null);
    expect(orderPlan("grovel")).toMatchObject({ prone: true, ends: "always" });
    expect(orderPlan("approach")).toMatchObject({ move: "toward", ends: "ifArrived" });
    expect(orderPlan("flee")).toMatchObject({ move: "away", ends: "always" });
    expect(orderPlan("drop")).toMatchObject({ drop: true, ends: "always" });
    expect(orderPlan("halt")).toMatchObject({ move: null, prone: false, drop: false, ends: "always" });
    expect(orderPlan("dance")).toBe(null);
  });
  it("écart entre emprises : contact 0, chevauchement -1, diagonale comptée comme une case", () => {
    const a = { i: 5, j: 5, w: 1, h: 1 };
    expect(footprintDistance({ i: 6, j: 5, w: 1, h: 1 }, a)).toBe(0);
    expect(footprintDistance({ i: 6, j: 6, w: 1, h: 1 }, a)).toBe(0);
    expect(footprintDistance({ i: 5, j: 5, w: 1, h: 1 }, a)).toBe(-1);
    expect(footprintDistance({ i: 9, j: 7, w: 1, h: 1 }, a)).toBe(3);
    expect(footprintDistance({ i: 7, j: 5, w: 2, h: 2 }, a)).toBe(1);
  });
  it("emprise non carrée : `i` (ligne) va avec la hauteur, `j` (colonne) avec la largeur", () => {
    // Deux cases de large sur une de haut, en (ligne 5, colonne 5) : occupe les colonnes 5 et 6.
    const wide = { i: 5, j: 5, w: 2, h: 1 };
    expect(footprintDistance({ i: 5, j: 7, w: 1, h: 1 }, wide)).toBe(0);    // juste à droite
    expect(footprintDistance({ i: 5, j: 6, w: 1, h: 1 }, wide)).toBe(-1);   // sous sa seconde colonne
    expect(footprintDistance({ i: 7, j: 5, w: 1, h: 1 }, wide)).toBe(1);    // deux lignes plus bas : une case d'écart
    expect(footprintDistance(wide, { i: 5, j: 7, w: 1, h: 1 })).toBe(0);    // symétrique
    const around = cellsAtGap(wide, { w: 1, h: 1 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(around).toHaveLength(10);
    expect(around.every(c => footprintDistance({ ...c, w: 1, h: 1 }, wide) === 0)).toBe(true);
    // Une emprise haute (une colonne, deux lignes) posée au bord bas de la scène : ses deux lignes doivent tenir dedans.
    const tall = cellsAtGap({ i: 19, j: 5, w: 1, h: 1 }, { w: 1, h: 2 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(tall.every(c => c.i + 1 <= 20)).toBe(true);
    expect(tall.every(c => footprintDistance({ ...c, w: 1, h: 2 }, { i: 19, j: 5, w: 1, h: 1 }) === 0)).toBe(true);
  });
  it("cases au contact d'une case : les huit autour, bornées à la scène", () => {
    const around = cellsAtGap({ i: 5, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(around).toHaveLength(8);
    const corner = cellsAtGap({ i: 0, j: 0, w: 1, h: 1 }, { w: 1, h: 1 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(corner).toHaveLength(3);
    const far = cellsAtGap({ i: 5, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 2, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(far.every(c => footprintDistance({ ...c, w: 1, h: 1 }, { i: 5, j: 5, w: 1, h: 1 }) === 2)).toBe(true);
    expect(far).toHaveLength(24);
  });
  it("schéma : orders, liste d'ordres connus", () => {
    expect(validateEntry({ orders: ["grovel", "halt"] }, { facts: {} })).toEqual([]);
    expect(validateEntry({ orders: ["grovel", "dance"] }, { facts: {} })).toHaveLength(1);
  });
});
