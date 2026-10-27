import { describe, it, expect } from "vitest";
import { normalizeTargetModes, saveModeFor, attackModeAgainst } from "../module/scripts/core/target-modes.mjs";

describe("§249 : Avantage / Désavantage donné par cible", () => {
  it("les modes inconnus sont retirés ; rien : null", () => {
    expect(normalizeTargetModes([{ token: "a", mode: "advantage" }, { token: "b", mode: "normal" }, { token: "c", mode: "disadvantage" },
      { token: "", mode: "advantage" }, null])).toEqual({ a: "advantage", c: "disadvantage" });
    expect(normalizeTargetModes([{ token: "b", mode: "x" }])).toBeNull();
    expect(normalizeTargetModes(null)).toBeNull();
    // Un objet indexé par UUID : le cœur en développe les points, il n'est pas lu.
    expect(normalizeTargetModes({ a: "advantage" })).toBeNull();
  });
  it("la sauvegarde de la cible prend son mode", () => {
    const modes = { a: "advantage", b: "disadvantage" };
    expect(saveModeFor(modes, "a")).toEqual({ advantage: true, disadvantage: false });
    expect(saveModeFor(modes, "b")).toEqual({ advantage: false, disadvantage: true });
    expect(saveModeFor(modes, "z")).toEqual({ advantage: false, disadvantage: false });
    expect(saveModeFor(null, "a")).toEqual({ advantage: false, disadvantage: false });
  });
  it("l'attaque contre elle : le mode inversé", () => {
    expect(attackModeAgainst(["advantage"])).toEqual({ advantage: false, disadvantage: true, agreed: true });
    expect(attackModeAgainst(["disadvantage", "disadvantage"])).toEqual({ advantage: true, disadvantage: false, agreed: true });
    expect(attackModeAgainst([null])).toEqual({ advantage: false, disadvantage: false, agreed: true });
  });
  it("des cibles qui ne s'accordent pas : rien n'est posé", () => {
    expect(attackModeAgainst(["advantage", null])).toEqual({ advantage: false, disadvantage: false, agreed: false });
  });
});
