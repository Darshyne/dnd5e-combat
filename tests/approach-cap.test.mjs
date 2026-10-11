import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * §152 : le plafond de coût que `approachDoor` et `walkToGap` passent à l'A*. Le 2026-10-11 (§147), `approachDoor` lisait un
 * `maxCost` jamais déclaré (ReferenceError : portes du menu inaccessibles à distance) et `walkToGap` ignorait le sien (la fuite de
 * Murmures dissonants bornée au budget du tour au lieu de la Vitesse entière). Seul `planPath` est remplacé ; la géométrie est la vraie,
 * sur une grille carrée factice. Un token sans acteur est hors combat : `movementCap` = Infinity.
 */
const calls = [];
vi.mock("../module/scripts/adapter/movement.mjs", async importOriginal => ({
  ...(await importOriginal()),
  planPath: (token, to, options) => { calls.push(options); return { arrives: true, waypoints: [] }; }
}));
const { approachDoor, walkToGap } = await import("../module/scripts/runtime/actions.mjs");

const grid = { isGridless: false, isSquare: true, size: 100, sizeX: 100, sizeY: 100,
  getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }) };
const scene = { grid, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 2000, sceneHeight: 2000 } };
const tokenAt = (x, y) => ({ actor: null, parent: scene, _source: { x, y, width: 1, height: 1, elevation: 0 } });

beforeEach(() => { calls.length = 0; });

describe("§152 : plafond de déplacement vers une porte, et de la fuite", () => {
  it("approachDoor : une porte à distance se rejoint dans le budget du tour, sans erreur", async () => {
    const wall = { document: { c: [500, 0, 500, 300] } };
    await expect(approachDoor(tokenAt(0, 0), wall)).resolves.toBe(true);
    expect(calls).toEqual([expect.objectContaining({ maxCost: Infinity })]);
  });
  it("walkToGap : le plafond donné (Réaction de Murmures dissonants) est celui de l'A*", async () => {
    await walkToGap(tokenAt(0, 0), tokenAt(1000, 1000), 3, { maxCost: 42 });
    expect(calls.at(-1).maxCost).toBe(42);
  });
  it("walkToGap : sans plafond donné, le budget du tour", async () => {
    await walkToGap(tokenAt(0, 0), tokenAt(1000, 1000), 3);
    expect(calls.at(-1).maxCost).toBe(Infinity);
  });
});
