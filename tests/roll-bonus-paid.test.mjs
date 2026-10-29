import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

const v = entry => validateEntry(entry, { facts: {} });

describe("§280 : relance payée par une activité, remboursement d'un test encore raté", () => {
  it("relance d'une sauvegarde ratée, payée par l'activité (bonus facultatif)", () => {
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["save"], reroll: {} } })).toEqual([]);
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["save"], reroll: { bonus: "2" }, abilities: ["str", "dex", "con"] } })).toEqual([]);
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["save"], reroll: { bonus: "2", during: "rage" } } })[0]).toMatch(/rollBonus/);
  });

  it("la forme sans activité reste celle de la Concentration fanatique", () => {
    expect(v({ rollBonus: { on: ["save"], reroll: { bonus: "@scale.barbarian.rage-damage", during: "rage" } } })).toEqual([]);
    expect(v({ rollBonus: { on: ["save"], reroll: { bonus: "2" } } })[0]).toMatch(/rollBonus/);
  });

  it("failRefund : seulement avec une activité, ni relance ni chance", () => {
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["check"], abilities: ["str", "cha"], failRefund: true } })).toEqual([]);
    expect(v({ rollBonus: { activity: "essaiActivite001", on: ["check"], luck: true, failRefund: true } })[0]).toMatch(/rollBonus/);
    expect(v({ rollBonus: { on: ["save"], reroll: { bonus: "2", during: "rage" }, failRefund: true } })[0]).toMatch(/rollBonus/);
  });
});
