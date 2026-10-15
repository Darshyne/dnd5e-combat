import { describe, it, expect } from "vitest";
import { tokenCenter } from "../module/scripts/adapter/turn.mjs";

/** `tokenCenter` : le centre en pixels, à hauteur des pieds, à la position validée (`_source`) ou à une position donnée. */
const grid = { sizeX: 100, sizeY: 100 };
const token = (src) => ({ parent: { grid }, _source: { x: 0, y: 0, elevation: 0, width: 1, height: 1, ...src } });

describe("tokenCenter", () => {
  it("à la position validée : le milieu de son espace, à son élévation", () => {
    expect(tokenCenter(token({ x: 200, y: 300, width: 2, height: 2, elevation: 10 }))).toEqual({ x: 300, y: 400, elevation: 10 });
  });
  it("à une position donnée (point de passage) : sa taille et son élévation si la position ne les dit pas", () => {
    expect(tokenCenter(token({ width: 2, height: 1, elevation: 5 }), { x: 0, y: 0 })).toEqual({ x: 100, y: 50, elevation: 5 });
    expect(tokenCenter(token({}), { x: 0, y: 0, width: 3, height: 3, elevation: 0 })).toEqual({ x: 150, y: 150, elevation: 0 });
  });
});
