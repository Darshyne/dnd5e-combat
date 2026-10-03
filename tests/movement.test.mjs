import { describe, it, expect } from "vitest";
import { findPath, corners, cellDistance } from "../module/scripts/core/pathfind.mjs";
import {
  remainingMovement, affordableSteps, footprintGap, approach, chooseBasicAttack, spentMovement
} from "../module/scripts/core/movement.mjs";

const key = c => `${c.i},${c.j}`;

/** Monde de test : `#` = mur (case interdite), lettres = repères. */
function world(rows) {
  const blocked = new Set();
  const marks = {};
  rows.forEach((row, i) => [...row].forEach((ch, j) => {
    if ( ch === "#" ) blocked.add(`${i},${j}`);
    else if ( ch !== "." ) marks[ch] = { i, j };
  }));
  const inside = c => (c.i >= 0) && (c.j >= 0) && (c.i < rows.length) && (c.j < rows[0].length);
  return { marks, canStep: (from, to) => inside(to) && !blocked.has(key(to)) };
}

describe("findPath", () => {
  it("va tout droit quand rien ne gêne", () => {
    const w = world(["S....G"]);
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep });
    expect(r.path).toHaveLength(6);
    expect(r.cost).toBe(5);
  });

  it("contourne un mur", () => {
    const w = world([
      "S.#..",
      "..#.G",
      "..#..",
      "....."
    ]);
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep });
    expect(r).not.toBeNull();
    expect(r.path.some(c => c.i === 3)).toBe(true);
    expect(r.path.every(c => w.canStep(c, c))).toBe(true);
  });

  it("rend null quand la cible est murée", () => {
    const w = world([
      "S.#G",
      "..##"
    ]);
    expect(findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep })).toBeNull();
  });

  it("traverse une case où l'on ne peut pas s'arrêter, sans y finir", () => {
    const w = world(["S.A.G"]);
    const canEnd = c => key(c) !== key(w.marks.A);
    const through = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep, canEnd });
    expect(through.path.map(key)).toContain(key(w.marks.A));
    expect(findPath({ start: w.marks.S, goals: [w.marks.A], canStep: w.canStep, canEnd })).toBeNull();
  });

  it("paie le terrain difficile et l'évite si c'est plus court", () => {
    const w = world([
      "S...G",
      "....."
    ]);
    const difficult = new Set(["0,1", "0,2", "0,3"]);
    const stepCost = (from, to) => difficult.has(key(to)) ? 2 : 1;
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep, stepCost });
    expect(r.cost).toBe(4);
    expect(r.path.some(c => c.i === 1)).toBe(true);
  });

  it("préfère la ligne droite à coût égal", () => {
    const w = world([
      ".....",
      "S...G",
      "....."
    ]);
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep });
    expect(r.path.every(c => c.i === 1)).toBe(true);
  });

  it("s'arrête au garde-fou", () => {
    const canStep = () => true;
    expect(findPath({ start: { i: 0, j: 0 }, goals: [{ i: 500, j: 500 }], canStep, maxNodes: 50 })).toBeNull();
  });

  it("déjà arrivé : chemin d'une case", () => {
    const r = findPath({ start: { i: 2, j: 2 }, goals: [{ i: 2, j: 2 }], canStep: () => true });
    expect(r.path).toEqual([{ i: 2, j: 2 }]);
  });
});

describe("corners", () => {
  it("ne garde que les virages", () => {
    const path = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 1, j: 3 }, { i: 2, j: 4 }, { i: 2, j: 5 }];
    expect(corners(path)).toEqual([{ i: 0, j: 0 }, { i: 0, j: 2 }, { i: 2, j: 4 }, { i: 2, j: 5 }]);
  });
  it("cellDistance compte à huit voisins", () => {
    expect(cellDistance({ i: 0, j: 0 }, { i: 3, j: -2 })).toBe(3);
  });
});

describe("budget de déplacement", () => {
  it("reste à parcourir, jamais négatif", () => {
    expect(remainingMovement(30, 10)).toBe(20);
    expect(remainingMovement(30, 45)).toBe(0);
  });
  it("coupe le chemin à ce qu'on peut payer", () => {
    expect(affordableSteps([5, 5, 5, 5], 12)).toBe(2);
    expect(affordableSteps([5, 10, 5], 15)).toBe(2);
    expect(affordableSteps([5, 5], 0)).toBe(0);
    expect(affordableSteps([5, 5], 10)).toBe(2);
  });
});

describe("approche d'une cible", () => {
  it("écart entre emprises", () => {
    const m = { i: 0, j: 0, w: 1, h: 1 };
    expect(footprintGap(m, { i: 0, j: 0, w: 1, h: 1 })).toBe(0);
    expect(footprintGap(m, { i: 1, j: 1, w: 1, h: 1 })).toBe(1);
    expect(footprintGap(m, { i: 0, j: 3, w: 1, h: 1 })).toBe(3);
    // Grande créature 2×2 en (2,2) : la case (1,1) la touche en diagonale, (2,2) la chevauche.
    expect(footprintGap({ i: 1, j: 1, w: 1, h: 1 }, { i: 2, j: 2, w: 2, h: 2 })).toBe(1);
    expect(footprintGap({ i: 3, j: 3, w: 1, h: 1 }, { i: 2, j: 2, w: 2, h: 2 })).toBe(0);
  });

  it("au contact : s'arrête à côté, jamais dessus", () => {
    const target = { i: 0, j: 5, w: 1, h: 1 };
    const { isGoal, heuristic } = approach(target, { w: 1, h: 1 }, 1);
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 4 });
    expect(isGoal({ i: 0, j: 5 })).toBe(false);
  });

  it("avec allonge de deux cases : s'arrête plus tôt", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 2);
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 3 });
  });

  it("déjà à portée : ne bouge pas", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 1, w: 1, h: 1 }, { w: 1, h: 1 }, 1);
    expect(findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true }).path).toHaveLength(1);
  });

  it("case d'approche occupée : prend la suivante", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 1);
    const canEnd = c => key(c) !== "0,4";
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true, canEnd });
    expect(["1,4", "-1,4"]).toContain(key(r.path.at(-1)));
  });
});

describe("attaque de base", () => {
  it("la mêlée équipée d'abord", () => {
    const pick = chooseBasicAttack([
      { id: "arc", melee: false, equipped: true, sort: 1 },
      { id: "epee", melee: true, equipped: true, sort: 2 },
      { id: "morsure", melee: true, equipped: false, sort: 0 }
    ]);
    expect(pick.id).toBe("epee");
  });
  it("à défaut de mêlée, la distance", () => {
    expect(chooseBasicAttack([{ id: "arc", melee: false, equipped: true, sort: 1 }]).id).toBe("arc");
    expect(chooseBasicAttack([])).toBeNull();
  });
});

describe("findPath — niveaux (P2)", () => {
  // Deux niveaux superposés : « 0 » et « 1 ». Un escalier E relie la case (0,3) de l'un à l'autre.
  const stairs = { i: 0, j: 3 };
  const world = {
    canStep: (from, to) => (to.i >= 0) && (to.j >= 0) && (to.i < 2) && (to.j < 6) && (to.level === from.level),
    transitions: cell => (cell.i === stairs.i) && (cell.j === stairs.j)
      ? [{ cell: { i: cell.i, j: cell.j, level: cell.level === "0" ? "1" : "0" }, cost: 4 }] : []
  };
  it("rejoint une case d'un autre niveau par l'escalier, au coût de la hauteur", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 1, j: 5, level: "1" }], ...world });
    expect(r).not.toBeNull();
    expect(r.path.map(c => `${c.i},${c.j}@${c.level}`)).toEqual(["0,0@0", "0,1@0", "0,2@0", "0,3@0", "0,3@1", "0,4@1", "1,5@1"]);
    expect(r.cost).toBe(3 + 4 + 2);
  });
  it("sans escalier, l'autre niveau est inaccessible", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 1, j: 5, level: "1" }], canStep: world.canStep });
    expect(r).toBeNull();
  });
  it("une case garde son niveau ; les mêmes i, j sur deux niveaux sont deux cases", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 0, j: 0, level: "1" }], ...world });
    expect(r.path).toHaveLength(8);   // 4 cases à l'aller, l'escalier, 3 cases au retour
    expect(r.path[0]).toEqual({ i: 0, j: 0, level: "0" });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 0, level: "1" });
  });
  it("un chemin sans niveau se comporte comme avant", () => {
    const r = findPath({ start: { i: 0, j: 0 }, goals: [{ i: 0, j: 5 }], canStep: (f, t) => t.i >= 0 && t.j >= 0 && t.i < 2 && t.j < 6 });
    expect(r.path).toHaveLength(6);
    expect(r.path[0]).toEqual({ i: 0, j: 0 });
  });
});

describe("déplacement dépensé (§16.10)", () => {
  it("une téléportation ou un déplacement forcé ne consomme pas de déplacement", () => {
    const history = [{ cost: 10 }, { cost: 30, teleport: true }, { cost: 5 }, { cost: 10, teleport: true }, { cost: NaN }];
    expect(spentMovement(history)).toEqual({ spent: 15, excluded: 40 });
  });
  it("un historique vide : rien", () => {
    expect(spentMovement([])).toEqual({ spent: 0, excluded: 0 });
    expect(spentMovement(undefined)).toEqual({ spent: 0, excluded: 0 });
  });
});

import { facingRotation } from "../module/scripts/core/movement.mjs";

describe("facingRotation (§18.27)", () => {
  it("sud = 0, ouest = 90, nord = 180, est = 270", () => {
    expect(facingRotation(0, 1)).toBe(0);
    expect(facingRotation(-1, 0)).toBe(90);
    expect(facingRotation(0, -1)).toBe(180);
    expect(facingRotation(1, 0)).toBe(270);
  });
  it("diagonale sud-est = 315 ; sans déplacement : null", () => {
    expect(facingRotation(1, 1)).toBe(315);
    expect(facingRotation(0, 0)).toBeNull();
  });
});
