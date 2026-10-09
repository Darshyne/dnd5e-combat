import { describe, it, expect } from "vitest";
import { straightCells } from "../module/scripts/core/dash.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const keys = cells => cells.map(c => `${c.i},${c.j}`);

describe("straightCells (§57, ruée en ligne droite)", () => {
  it("en ligne : chaque case, départ et arrivée compris", () => {
    expect(keys(straightCells({ i: 2, j: 1 }, { i: 2, j: 5 }))).toEqual(["2,1", "2,2", "2,3", "2,4", "2,5"]);
    expect(keys(straightCells({ i: 4, j: 0 }, { i: 1, j: 0 }))).toEqual(["4,0", "3,0", "2,0", "1,0"]);
  });

  it("en diagonale : une case par pas", () => {
    expect(keys(straightCells({ i: 0, j: 0 }, { i: 3, j: 3 }))).toEqual(["0,0", "1,1", "2,2", "3,3"]);
  });

  it("en biais : un tracé continu (pas de trou entre deux positions)", () => {
    const cells = straightCells({ i: 0, j: 0 }, { i: 2, j: 6 });
    expect(cells[0]).toEqual({ i: 0, j: 0 });
    expect(cells.at(-1)).toEqual({ i: 2, j: 6 });
    for ( let k = 1; k < cells.length; k++ ) {
      expect(Math.max(Math.abs(cells[k].i - cells[k - 1].i), Math.abs(cells[k].j - cells[k - 1].j))).toBe(1);
    }
  });

  it("le même tracé dans les deux sens", () => {
    const a = keys(straightCells({ i: 0, j: 0 }, { i: 3, j: 7 }));
    const b = keys(straightCells({ i: 3, j: 7 }, { i: 0, j: 0 })).reverse();
    expect(b).toEqual(a);
  });

  it("sur place : la seule case", () => {
    expect(keys(straightCells({ i: 1, j: 1 }, { i: 1, j: 1 }))).toEqual(["1,1"]);
  });
});

describe("lineDash (contenu)", () => {
  it("portée positive et unité ; activité facultative", () => {
    expect(validateEntry({ lineDash: { reach: 5, units: "ft" } })).toEqual([]);
    expect(validateEntry({ lineDash: { reach: 5, units: "ft", activity: "pZRawQ5JyoxXkqPu" } })).toEqual([]);
    expect(validateEntry({ lineDash: { reach: 0, units: "", activity: "x", width: 1 } })).toEqual([
      "lineDash.reach: positive number", "lineDash.units: unit required", "lineDash.activity: activity id (16 characters) expected",
      "lineDash.width: unknown key"
    ]);
  });
});
