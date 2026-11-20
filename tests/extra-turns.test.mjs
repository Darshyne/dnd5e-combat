import { describe, expect, it } from "vitest";
import { takesAnotherTurn, movedForward, validateExtraTurns } from "../module/scripts/core/extra-turns.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("extraTurns : des tours d'affilée (Arrêt du temps)", () => {
  it("le tracker a avancé : round suivant, ou tour plus loin dans le même round", () => {
    expect(movedForward({ round: 1, turn: 0 }, { round: 1, turn: 1 })).toBe(true);
    expect(movedForward({ round: 1, turn: 3 }, { round: 2, turn: 0 })).toBe(true);
    expect(movedForward({ round: 2, turn: 0 }, { round: 1, turn: 3 })).toBe(false);
    expect(movedForward({ round: 1, turn: 1 }, { round: 1, turn: 1 })).toBe(false);
    expect(movedForward(null, { round: 1, turn: 0 })).toBe(false);
  });
  it("un tour de plus tant qu'il en reste, dans ce combat, quand le tracker avance", () => {
    const state = { combat: "c1", left: 2 };
    expect(takesAnotherTurn(state, { combat: "c1", forward: true })).toBe(true);
    expect(takesAnotherTurn(state, { combat: "c1", forward: false })).toBe(false);
    expect(takesAnotherTurn(state, { combat: "c2", forward: true })).toBe(false);
    expect(takesAnotherTurn({ combat: "c1", left: 0 }, { combat: "c1", forward: true })).toBe(false);
    expect(takesAnotherTurn(null, { combat: "c1", forward: true })).toBe(false);
  });
  it("Arrêt du temps : 1d4 + 1 ; la clé est validée", () => {
    expect(CONTENT["time-stop"].extraTurns).toEqual({ formula: "1d4 + 1" });
    expect(validateExtraTurns({ formula: "1d4 + 1" }, "")).toEqual([]);
    expect(validateExtraTurns({ formula: "" }, "")).toHaveLength(1);
    expect(validateEntry({ extraTurns: { formula: "1d4 + 1", free: true } })).not.toEqual([]);
  });
});
