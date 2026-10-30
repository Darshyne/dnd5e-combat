import { describe, it, expect } from "vitest";
import { confusionBehavior, wanderCells, DIRECTIONS } from "../module/scripts/core/control.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§285 : table de Confusion", () => {
  it("1 erre, 2–6 rien, 7–8 frappe, 9–10 libre", () => {
    expect([1, 2, 6, 7, 8, 9, 10].map(n => confusionBehavior(n).kind)).toEqual(["wander", "idle", "idle", "lash", "lash", "free", "free"]);
    expect(confusionBehavior(1)).toMatchObject({ move: true, action: false });
    expect(confusionBehavior(4)).toMatchObject({ move: false, action: false });
    expect(confusionBehavior(7)).toMatchObject({ move: false, action: true });
  });

  it("l'errance va du plus loin au plus près dans la direction du d8, dans la scène", () => {
    const bounds = { i0: 0, j0: 0, i1: 20, j1: 20 };
    expect(DIRECTIONS).toHaveLength(8);
    expect(wanderCells({ i: 10, j: 10 }, 3, 3, { w: 1, h: 1 }, bounds)).toEqual([{ i: 10, j: 13 }, { i: 10, j: 12 }, { i: 10, j: 11 }]);
    expect(wanderCells({ i: 1, j: 5 }, 1, 3, { w: 1, h: 1 }, bounds)).toEqual([{ i: 0, j: 5 }]);
  });
});

describe("§285 : contenu des sorts de contrôle", () => {
  it("Terreur, Mauvais œil, Confusion, Couronne du dément, Fou rire", () => {
    expect(CONTENT.fear.panic).toEqual({ drop: true });
    expect(CONTENT.eyebite.panic).toMatchObject({ effect: "Kj1GwWXD5k0Zen75", endsAt: { distance: 60, units: "ft" } });
    expect(CONTENT.confusion).toMatchObject({ confusion: "VxmsgUz9OIUet6WC", noBonus: "VxmsgUz9OIUet6WC", noReactions: true });
    expect(CONTENT["crown-of-madness"]).toMatchObject({ forcedAttack: "0zixJ8ZoYFgSJtMV", upkeep: true });
    for ( const id of ["tashas-hideous-laughter", "hideous-laughter"] ) {
      expect(CONTENT[id].keepsProne, id).toBe(true);
      expect(CONTENT[id].triggers.find(d => [d.on].flat().includes("isDamaged")).do[0]).toEqual({ type: "resave", advantage: true });
    }
  });

  it("le schéma refuse les formes fausses", () => {
    expect(validateEntry({ panic: { drop: "yes" } }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ panic: { endsAt: { distance: 60 } } }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ confusion: "short" }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ upkeep: 1 }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ panic: { effect: "Kj1GwWXD5k0Zen75", endsAt: { distance: 60, units: "ft" } } }, { at: "x." })).toEqual([]);
  });
});
