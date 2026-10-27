import { describe, it, expect } from "vitest";
import { eventRounds, eventEnded } from "../module/scripts/core/combat-events.mjs";

describe("§250 : évènements dans l'initiative", () => {
  it("du round courant pour n rounds ; avant le combat, dès le round 1", () => {
    expect(eventRounds(1, 1)).toEqual({ from: 1, until: 1 });
    expect(eventRounds(0, 1)).toEqual({ from: 1, until: 1 });
    expect(eventRounds(3, 2)).toEqual({ from: 3, until: 4 });
  });
  it("sans fin : rounds null ou nul", () => {
    expect(eventRounds(2, null)).toEqual({ from: 2, until: null });
    expect(eventRounds(2, 0)).toEqual({ from: 2, until: null });
  });
  it("fini une fois joué son dernier round", () => {
    expect(eventEnded({ until: 1 }, 1)).toBe(true);
    expect(eventEnded({ until: 2 }, 1)).toBe(false);
    expect(eventEnded({ until: null }, 9)).toBe(false);
    expect(eventEnded(null, 1)).toBe(false);
  });
});
