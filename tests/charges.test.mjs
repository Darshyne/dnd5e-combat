/**
 * Utilisation d'objets magiques (Roublard, Voleur 13 — SRD 5.2), Charges : 1d6 à chaque propriété d'objet magique qui dépense des
 * charges ; sur un 6, elles ne sont pas dépensées.
 */
import { describe, it, expect } from "vitest";
import { spendsCharges, chargesKept } from "../module/scripts/core/charges.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("spendsCharges", () => {
  const use = (over={}) => ({ magical: true, consumable: false, usesMax: 3, recovers: true, itemId: "wand000000000000",
    targets: [{ type: "itemUses", target: "" }], ...over });
  it("un objet magique dont l'activité consomme ses propres utilisations", () => {
    expect(spendsCharges(use())).toBe(true);
    expect(spendsCharges(use({ targets: [{ type: "itemUses", target: "wand000000000000" }] }))).toBe(true);
    expect(spendsCharges(use({ usesMax: 1 }))).toBe(true);
    expect(spendsCharges(use({ recovers: false }))).toBe(true);
  });
  it("pas un objet ordinaire, pas un consommable, pas une seule utilisation sans regain", () => {
    expect(spendsCharges(use({ magical: false }))).toBe(false);
    expect(spendsCharges(use({ consumable: true }))).toBe(false);
    expect(spendsCharges(use({ usesMax: 1, recovers: false }))).toBe(false);
  });
  it("pas quand l'activité consomme autre chose (un emplacement, les utilisations d'un autre item)", () => {
    expect(spendsCharges(use({ targets: [] }))).toBe(false);
    expect(spendsCharges(use({ targets: [{ type: "itemUses", target: "other00000000000" }] }))).toBe(false);
    expect(spendsCharges(use({ targets: [{ type: "spellSlots", target: "1" }] }))).toBe(false);
  });
});

describe("chargesKept", () => {
  it("un 6 seulement", () => {
    const rule = { die: 6, on: 6 };
    expect(chargesKept(6, rule)).toBe(true);
    expect(chargesKept(5, rule)).toBe(false);
    expect(chargesKept(NaN, rule)).toBe(false);
  });
});

describe("l'entrée et le schéma", () => {
  it("Utilisation d'objets magiques", () => {
    expect(CONTENT["use-magic-device"].savesCharges).toEqual({ die: 6, on: 6 });
    expect(validateEntry(CONTENT["use-magic-device"])).toEqual([]);
    expect(validateEntry({ savesCharges: { die: 6 } }).length).toBe(1);
    expect(validateEntry({ savesCharges: { die: 6, on: 7 } }).length).toBe(1);
  });
});
