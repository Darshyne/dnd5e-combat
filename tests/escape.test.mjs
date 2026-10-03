import { describe, it, expect } from "vitest";
import { parseEscapeCheck, escapableStatuses } from "../module/scripts/core/escape.mjs";

const known = { abilities: ["str", "dex", "con", "int", "wis", "cha"], skills: ["acr", "ath", "inv", "prc"] };

describe("se libérer par un test (§16.54)", () => {
  it("lit l'enrichisseur des sorts du PHB (paires clé=valeur)", () => {
    const text = "<p>Une créature Entravée peut entreprendre une action pour effectuer un test de "
      + "[[/check ability=str skill=ath dc=@attributes.spell.dc]] assorti de votre DD.</p>";
    expect(parseEscapeCheck(text, known)).toEqual({ ability: "str", skill: "ath", dc: "@attributes.spell.dc" });
  });
  it("lit les valeurs seules du Monster Manual, et ignore format=", () => {
    expect(parseEscapeCheck("[[/check ath dc=@skills.ath.passive format=long]]", known))
      .toEqual({ ability: null, skill: "ath", dc: "@skills.ath.passive" });
    expect(parseEscapeCheck("un test de [[/skill ath 10]] pour s'en extraire", known)).toEqual({ ability: null, skill: "ath", dc: "10" });
  });
  it("une caractéristique seule suffit ; sans DD ni test, rien", () => {
    expect(parseEscapeCheck("[[/check str 15]]", known)).toEqual({ ability: "str", skill: null, dc: "15" });
    expect(parseEscapeCheck("[[/check ath]]", known)).toBe(null);
    expect(parseEscapeCheck("[[/damage 2d6 fire]]", known)).toBe(null);
    expect(parseEscapeCheck("", known)).toBe(null);
  });
  it("Entravé sans Agrippé seulement (l'empoignade a son propre S'échapper)", () => {
    expect(escapableStatuses(["restrained"])).toBe(true);
    expect(escapableStatuses(["grappled", "restrained"])).toBe(false);
    expect(escapableStatuses(["poisoned"])).toBe(false);
  });
});
