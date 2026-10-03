import { describe, it, expect } from "vitest";
import { createCanvasWait } from "../module/scripts/runtime/shared.mjs";

/** Un canevas qui devient prêt après `after` millisecondes simulées. */
function fakeCanvas(after) {
  let now = 0;
  return {
    ports: { isReady: () => now >= after, sleep: async ms => { now += ms; } },
    elapsed: () => now
  };
}

describe("attente du canevas (redessin d'un changement de niveau)", () => {
  it("déjà prêt : aucune attente", async () => {
    const c = fakeCanvas(0);
    expect(await createCanvasWait(c.ports)()).toBe(true);
    expect(c.elapsed()).toBe(0);
  });

  it("en cours de redessin : attend qu'il soit prêt", async () => {
    const c = fakeCanvas(300);
    expect(await createCanvasWait(c.ports, 5000, 50)()).toBe(true);
    expect(c.elapsed()).toBe(300);
  });

  it("jamais prêt : rend la main au bout du délai, et le dit", async () => {
    const c = fakeCanvas(Infinity);
    expect(await createCanvasWait(c.ports, 500, 50)()).toBe(false);
    expect(c.elapsed()).toBe(500);
  });
});
