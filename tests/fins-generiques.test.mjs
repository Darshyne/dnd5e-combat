/** §258 : fins génériques (`endsWhen`) relevées par l'audit CAT / CPR — décisions pures, schéma, contenu livré. */
import { describe, it, expect } from "vitest";
import { armorEnds, tooFarApart, nobodyAffected } from "../module/scripts/core/endings.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const target = (over={}) => ({ unaffected: null, hit: null, save: null, ...over });

describe("fins génériques — décisions", () => {
  it("armure : toute armure, ou seulement lourde ; un bouclier ne compte pas", () => {
    expect(armorEnds("any", "light")).toBe(true);
    expect(armorEnds("any", "shield")).toBe(false);
    expect(armorEnds("heavy", "medium")).toBe(false);
    expect(armorEnds("heavy", "heavy")).toBe(true);
  });

  it("distance : strictement au-delà de la limite", () => {
    expect(tooFarApart(60, 60)).toBe(false);
    expect(tooFarApart(65, 60)).toBe(true);
    expect(tooFarApart(NaN, 60)).toBe(false);
  });

  it("personne d'affecté : toutes les sauvegardes réussies", () => {
    const saved = { targets: [target({ save: { success: true } }), target({ save: { success: true } })] };
    expect(nobodyAffected(saved, "failedSave")).toBe(true);
    const one = { targets: [target({ save: { success: true } }), target({ save: { success: false } })] };
    expect(nobodyAffected(one, "failedSave")).toBe(false);
  });

  it("une sauvegarde pas encore jugée ne décide rien ; une cible inaffectable ne compte pas", () => {
    expect(nobodyAffected({ targets: [target()] }, "failedSave")).toBe(false);
    const immune = { targets: [target({ unaffected: { reason: "type" } }), target({ save: { success: true } })] };
    expect(nobodyAffected(immune, "failedSave")).toBe(true);
    expect(nobodyAffected({ targets: [target({ unaffected: { reason: "immune" } })] }, "noTargets")).toBe(true);
  });

  it("aucun coup au but", () => {
    expect(nobodyAffected({ targets: [target({ hit: false }), target({ hit: false })] }, "noHits")).toBe(true);
    expect(nobodyAffected({ targets: [target({ hit: false }), target({ hit: true })] }, "noHits")).toBe(false);
  });
});

describe("fins génériques — schéma", () => {
  it("accepte les quatre fins et `spell`", () => {
    expect(validateEntry({ endsWhen: { armor: "any" } })).toEqual([]);
    expect(validateEntry({ endsWhen: { apart: { distance: 30, units: "ft", at: "casterTurnEnd" }, zeroHp: true, spell: true } })).toEqual([]);
    expect(validateEntry({ endsWhen: { unaffected: "noHits" } })).toEqual([]);
  });
  it("refuse le reste", () => {
    expect(validateEntry({ endsWhen: {} })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { armor: "shield" } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { apart: { distance: 0, units: "ft" } } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { apart: { distance: 30, units: "ft", at: "never" } } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { unaffected: "nobody" } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { later: true } })).toHaveLength(1);
  });
});

describe("fins génériques — contenu livré", () => {
  it("Armure du mage, Rage, Lien de garde, Duel forcé", () => {
    expect(CONTENT["mage-armor"].endsWhen).toEqual({ armor: "any" });
    expect(CONTENT["rage"].endsWhen).toEqual({ armor: "heavy" });
    expect(CONTENT["rage"].rage).toBeTruthy();
    expect(CONTENT["warding-bond"].endsWhen).toEqual({ apart: { distance: 60, units: "ft" }, zeroHp: true, spell: true });
    expect(CONTENT["warding-bond"].triggers).toBeTruthy();
    expect(CONTENT["compelled-duel"].endsWhen.apart.at).toBe("casterTurnEnd");
    expect(CONTENT["compelled-duel"].triggers).toBeTruthy();
  });
  it("les sorts de sauvegarde à concentration finissent quand personne n'est affecté", () => {
    for ( const id of ["hold-person", "banishment", "slow", "hypnotic-pattern", "polymorph"] ) {
      expect(CONTENT[id].endsWhen?.unaffected).toBe("failedSave");
      expect(validateEntry(CONTENT[id])).toEqual([]);
    }
  });
});
