/** §272 : minuteries au-dessus des tokens — ce qui se calcule sans Foundry. */
import { describe, it, expect } from "vitest";
import { TIMER_GRADIENT, timerSecondsText, timerState } from "../module/scripts/core/timers.mjs";

describe("minuteries", () => {
  it("avance, secondes restantes arrondies au-dessus, fin", () => {
    expect(timerState({ startedAt: 1000, seconds: 5 }, 1000)).toEqual({ pct: 0, left: 5, done: false });
    expect(timerState({ startedAt: 1000, seconds: 5 }, 3600)).toEqual({ pct: 0.52, left: 3, done: false });
    expect(timerState({ startedAt: 1000, seconds: 5 }, 9000)).toEqual({ pct: 1, left: 0, done: true });
    expect(timerState({ startedAt: 1000, seconds: 0 }, 1000).done).toBe(true);
  });
  it("les secondes s'écrivent, sauf si la table les masque", () => {
    expect(timerSecondsText(4)).toBe("4 s");
    expect(timerSecondsText(4, { hideSeconds: true })).toBe("");
  });
  it("le dégradé du logo DAS", () => {
    expect(TIMER_GRADIENT).toEqual(["#e005f4", "#ee0388", "#fc0016"]);
  });
});
