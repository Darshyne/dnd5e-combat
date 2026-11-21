/**
 * Frappes bénies améliorées (Clerc 14, SRD 5.2), Incantation puissante : après un sort mineur de clerc qui a infligé des dégâts,
 * des points de vie temporaires (deux fois le modificateur de Sagesse) au lanceur ou à une autre créature à 18 m ou moins.
 */
import { describe, it, expect } from "vitest";
import { vitalityApplies, vitalityRecipients, vitalityGain } from "../module/scripts/core/vitality.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("vitalityApplies", () => {
  const rule = { class: "cleric", requires: ["blessed-strikes-potent-spellcasting", "potent-spellcasting"] };
  it("un sort mineur de clerc qui a blessé une créature, avec l'Incantation puissante choisie", () => {
    expect(vitalityApplies(rule, { cantripOfClass: true, damaged: 1, features: ["potent-spellcasting", "channel-divinity"] }))
      .toBe(true);
  });
  it("pas sans dégâts, pas un autre sort, pas avec l'Impact divin choisi", () => {
    expect(vitalityApplies(rule, { cantripOfClass: true, damaged: 0, features: ["potent-spellcasting"] })).toBe(false);
    expect(vitalityApplies(rule, { cantripOfClass: false, damaged: 2, features: ["potent-spellcasting"] })).toBe(false);
    expect(vitalityApplies(rule, { cantripOfClass: true, damaged: 1, features: ["divine-strike"] })).toBe(false);
    expect(vitalityApplies(null, { cantripOfClass: true, damaged: 1, features: [] })).toBe(false);
  });
});

describe("vitalityRecipients", () => {
  const tokens = [{ id: "far", name: "Loin", distance: 80, ally: true }, { id: "foe", name: "Ennemi", distance: 10, ally: false },
    { id: "b", name: "Allié B", distance: 40, ally: true }, { id: "a", name: "Allié A", distance: 10, ally: true },
    { id: "me", name: "Clerc", distance: 0, ally: true, self: true }];
  it("le lanceur d'abord, puis les créatures de son camp à portée, de la plus proche à la plus lointaine", () => {
    expect(vitalityRecipients(tokens, 60).map(t => t.id)).toEqual(["me", "a", "b"]);
  });
  it("la liste est bornée", () => {
    expect(vitalityRecipients(tokens, 60, 2).map(t => t.id)).toEqual(["me", "a"]);
  });
});

describe("vitalityGain", () => {
  it("les points de vie temporaires ne se cumulent pas", () => {
    expect(vitalityGain(8, 0)).toBe(8);
    expect(vitalityGain(8, 5)).toBe(8);
    expect(vitalityGain(8, 8)).toBe(0);
    expect(vitalityGain(8, 12)).toBe(0);
    expect(vitalityGain(0, 0)).toBe(0);
  });
});

describe("l'entrée et le schéma", () => {
  it("Frappes bénies améliorées", () => {
    const entry = CONTENT["improved-blessed-strikes"];
    expect(entry.cantripVitality).toEqual({ class: "cleric", tempHp: "2 * @abilities.wis.mod", range: { value: 60, units: "ft" },
      requires: ["blessed-strikes-potent-spellcasting", "potent-spellcasting"] });
    expect(validateEntry(entry)).toEqual([]);
    expect(validateEntry({ cantripVitality: { class: "cleric", tempHp: "4" } }).length).toBe(1);
  });
});
