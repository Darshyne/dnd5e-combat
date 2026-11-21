import { describe, expect, it } from "vitest";
import { saveResistApplies, saveReflectApplies, validateSaveResist } from "../module/scripts/core/save-resist.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("saveResist : un objet change une sauvegarde ratée en réussite (Bâton d'envoûtement)", () => {
  const rule = ITEM_FIXES["staff-of-charming"].saveResist;
  it("contre un sort d'enchantement qui ne cible que le porteur", () => {
    expect(rule).toEqual({ activity: "tEk1wNWngqDYOgOB", schools: ["enc"], singleTarget: true });
    expect(saveResistApplies(rule, { isSpell: true, school: "enc", targets: 1 })).toBe(true);
  });
  it("pas contre une autre école, plusieurs cibles, ou ce qui n'est pas un sort", () => {
    expect(saveResistApplies(rule, { isSpell: true, school: "evo", targets: 1 })).toBe(false);
    expect(saveResistApplies(rule, { isSpell: true, school: "enc", targets: 2 })).toBe(false);
    expect(saveResistApplies(rule, { isSpell: false, school: "enc", targets: 1 })).toBe(false);
    expect(saveResistApplies(null, { isSpell: true, school: "enc", targets: 1 })).toBe(false);
  });
  it("sans école ni cible unique déclarées : tout sort", () => {
    expect(saveResistApplies({ activity: "tEk1wNWngqDYOgOB" }, { isSpell: true, school: "evo", targets: 4 })).toBe(true);
  });
  it("la clé est validée", () => {
    const isId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);
    expect(validateSaveResist(rule, "", isId)).toEqual([]);
    expect(validateSaveResist({ activity: "short" }, "", isId)).toHaveLength(1);
    expect(validateSaveResist({ activity: "tEk1wNWngqDYOgOB", schools: [] }, "", isId)).toHaveLength(1);
    expect(validateEntry({ saveResist: rule })).toEqual([]);
  });
});

describe("saveReflect : une sauvegarde réussie retourne le sort contre son lanceur (Bâton d'envoûtement)", () => {
  const rule = ITEM_FIXES["staff-of-charming"].saveReflect;
  const enchantment = { isSpell: true, school: "enc", targets: 1 };
  it("un sort d'enchantement qui ne cible que le porteur, avec une charge et la Réaction", () => {
    expect(rule).toEqual({ activity: "t8vD0vJ4MzCZIku2", schools: ["enc"], singleTarget: true });
    expect(saveReflectApplies(rule, enchantment, { charges: 3, reaction: true })).toBe(true);
    expect(saveReflectApplies(rule, enchantment, { charges: 3, reaction: null })).toBe(true);   // hors combat
    expect(saveReflectApplies(rule, enchantment, { charges: 0, reaction: true })).toBe(false);
    expect(saveReflectApplies(rule, enchantment, { charges: 3, reaction: false })).toBe(false);
    expect(saveReflectApplies(rule, { ...enchantment, targets: 2 }, { charges: 3, reaction: true })).toBe(false);
    expect(saveReflectApplies(rule, { ...enchantment, school: "evo" }, { charges: 3, reaction: true })).toBe(false);
  });
  it("la clé est validée, sous son nom", () => {
    const isId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);
    expect(validateSaveResist(rule, "", isId, "saveReflect")).toEqual([]);
    expect(validateSaveResist({ activity: "x" }, "", isId, "saveReflect")[0]).toContain("saveReflect");
    expect(validateEntry(ITEM_FIXES["staff-of-charming"])).toEqual([]);
  });
});
