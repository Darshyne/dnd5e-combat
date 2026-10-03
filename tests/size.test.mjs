import { describe, it, expect } from "vitest";
import { shiftSize } from "../module/scripts/core/size.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];

describe("changer de taille (§16.58)", () => {
  it("décale d'autant de catégories, borné aux extrêmes", () => {
    expect(shiftSize("med", 1, SIZES)).toBe("lg");
    expect(shiftSize("med", -1, SIZES)).toBe("sm");
    expect(shiftSize("grg", 1, SIZES)).toBe("grg");
    expect(shiftSize("tiny", -2, SIZES)).toBe("tiny");
    expect(shiftSize("sm", 3, SIZES)).toBe("huge");
  });
  it("taille inconnue : rien", () => {
    expect(shiftSize("colossal", 1, SIZES)).toBe(null);
  });
  it("schéma : { id d'effet: crans }, entier non nul de -5 à 5", () => {
    expect(validateEntry({ resize: { Wi2E10l7n6Ka8k6u: 1, NXdtOxX4HvPeodml: -1 } }, { facts: {} })).toEqual([]);
    expect(validateEntry({ resize: { court: 1, NXdtOxX4HvPeodml: 0 } }, { facts: {} }))
      .toEqual(["resize.court : id d'effet (16 caractères)", "resize.NXdtOxX4HvPeodml : entier non nul, de -5 à 5"]);
  });
});
