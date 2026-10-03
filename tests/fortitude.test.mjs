/** §61 : Robustesse de la non-vie — sauvegarde de Constitution (DD 5 + dégâts) en tombant à 0 PV, sauf radiant ou critique. */
import { describe, it, expect } from "vitest";
import { fortitudeSave } from "../module/scripts/core/fortitude.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("fortitudeSave", () => {
  it("tomber à 0 PV : sauvegarde de Constitution, DD 5 + dégâts subis", () => {
    expect(fortitudeSave({ hp: 6, through: 9, taken: 9, types: ["slashing"] })).toEqual({ ability: "con", dc: 14 });
  });
  it("tomber pile à 0 PV compte", () => {
    expect(fortitudeSave({ hp: 6, through: 6, taken: 6 })).toEqual({ ability: "con", dc: 11 });
  });
  it("les PV temporaires absorbés comptent dans le DD (dégâts subis), pas dans la chute", () => {
    expect(fortitudeSave({ hp: 4, through: 4, taken: 10 })?.dc).toBe(15);
    expect(fortitudeSave({ hp: 4, through: 3, taken: 10 })).toBeNull();
  });
  it("rester au-dessus de 0 PV, ou y être déjà : rien", () => {
    expect(fortitudeSave({ hp: 10, through: 9, taken: 9 })).toBeNull();
    expect(fortitudeSave({ hp: 0, through: 5, taken: 5 })).toBeNull();
  });
  it("dégâts radiants (même mêlés à d'autres) ou coup critique : pas de sauvegarde", () => {
    expect(fortitudeSave({ hp: 5, through: 8, taken: 8, types: ["radiant"] })).toBeNull();
    expect(fortitudeSave({ hp: 5, through: 8, taken: 8, types: ["slashing", "radiant"] })).toBeNull();
    expect(fortitudeSave({ hp: 5, through: 8, taken: 8, types: ["slashing"], critical: true })).toBeNull();
  });
  it("le DD ne garde que les dégâts entiers", () => {
    expect(fortitudeSave({ hp: 3, through: 7.5, taken: 7.5 })?.dc).toBe(12);
  });
});

describe("contenu", () => {
  it("undead-fortitude porte la règle, et l'entrée est valide", () => {
    expect(CONTENT["undead-fortitude"]?.fortitude).toBe(true);
    expect(validateEntry(CONTENT["undead-fortitude"])).toEqual([]);
  });
  it("fortitude n'admet que true", () => {
    expect(validateEntry({ fortitude: "oui" }).length).toBeGreaterThan(0);
  });
});
