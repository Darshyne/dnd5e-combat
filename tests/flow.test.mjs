import { describe, it, expect } from "vitest";
import { offersReaction, REACTION_MODES } from "../module/scripts/core/flow.mjs";

// §418 : le réglage « Réactions » du cadre « Déroulement ».
describe("offersReaction", () => {
  it("par défaut et « selon le niveau » : proposée à chacun", () => {
    for ( const mode of ["level", "ask", undefined, "inconnu"] ) {
      expect(offersReaction(mode, { playerOwned: true })).toBe(true);
      expect(offersReaction(mode, { playerOwned: false })).toBe(true);
    }
  });
  it("aux joueurs seulement : pas pour une créature du MJ", () => {
    expect(offersReaction("players", { playerOwned: true })).toBe(true);
    expect(offersReaction("players", { playerOwned: false })).toBe(false);
    expect(offersReaction("players")).toBe(false);
  });
  it("jamais : pour personne", () => {
    expect(offersReaction("off", { playerOwned: true })).toBe(false);
    expect(offersReaction("off", { playerOwned: false })).toBe(false);
  });
  it("quatre modes, « level » en tête (le défaut)", () => {
    expect(REACTION_MODES).toEqual(["level", "ask", "players", "off"]);
  });
});

// §419 : le réglage « Dégâts ».
describe("damageSteps", async () => {
  const { damageSteps, DAMAGE_MODES } = await import("../module/scripts/core/flow.mjs");
  it("par défaut et « selon le niveau » : ni clic ni validation", () => {
    for ( const mode of ["level", "auto", undefined, "inconnu"] ) expect(damageSteps(mode)).toEqual({ click: false, validate: false });
  });
  it("au clic, validés, ou les deux", () => {
    expect(damageSteps("click")).toEqual({ click: true, validate: false });
    expect(damageSteps("validate")).toEqual({ click: false, validate: true });
    expect(damageSteps("clickValidate")).toEqual({ click: true, validate: true });
  });
  it("cinq modes, « level » en tête (le défaut)", () => {
    expect(DAMAGE_MODES).toEqual(["level", "auto", "click", "validate", "clickValidate"]);
  });
});
