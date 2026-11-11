import { describe, it, expect } from "vitest";
import { somaticBlocked, handsUsed, handsCheckedFor } from "../module/scripts/core/hands.mjs";
import { conditionUseIssues } from "../module/scripts/core/conditions.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

// §409 (issue #44, lot 2) : la main libre de la composante somatique ; le Neutralisé qui lance un rituel ou un sort long.
const mace = { name: "Masse", hands: 1, armament: true };
const shield = { name: "Bouclier", hands: 1, armament: true };
const staff = { name: "Bâton", hands: 1, focus: true, armament: true };
const greatsword = { name: "Épée à deux mains", hands: 2, twoHanded: true, armament: true };
const torch = { name: "Torche", hands: 1 };
const crystal = { name: "Cristal", hands: 1, focus: true };
const spell = (held, extra={}) => ({ spell: true, somatic: true, material: false, held, ...extra });

describe("somaticBlocked", () => {
  it("une main libre : le sort passe", () => {
    expect(somaticBlocked(spell([]))).toBeNull();
    expect(somaticBlocked(spell([mace]))).toBeNull();
    expect(somaticBlocked(spell([staff]))).toBeNull();
  });

  it("deux mains prises : refusé, avec ce qui les occupe", () => {
    expect(somaticBlocked(spell([mace, shield]))).toEqual({ items: ["Masse", "Bouclier"] });
    expect(somaticBlocked(spell([shield, torch]))).toEqual({ items: ["Bouclier", "Torche"] });
  });

  it("une arme à deux mains ne prend qu'une main hors de l'attaque (2024)", () => {
    expect(handsUsed([greatsword])).toBe(1);
    expect(somaticBlocked(spell([greatsword]))).toBeNull();
    expect(somaticBlocked(spell([greatsword, shield]))).not.toBeNull();
  });

  it("la main du focaliseur suffit si le sort a aussi une composante matérielle", () => {
    expect(somaticBlocked(spell([crystal, shield], { material: true }))).toBeNull();
    expect(somaticBlocked(spell([crystal, shield], { material: false }))).toEqual({ items: ["Cristal", "Bouclier"] });
    expect(somaticBlocked(spell([mace, shield], { material: true }))).not.toBeNull();
  });

  it("Mage de guerre : armes et bouclier en main, pas une torche", () => {
    expect(somaticBlocked(spell([mace, shield], { freeSomatic: true }))).toBeNull();
    expect(somaticBlocked(spell([shield, torch], { freeSomatic: true }))).not.toBeNull();
  });

  it("sans composante S, composante levée (Sort subtil), pas un sort : rien", () => {
    expect(somaticBlocked(spell([mace, shield], { somatic: false }))).toBeNull();
    expect(somaticBlocked(spell([mace, shield], { waived: true }))).toBeNull();
    expect(somaticBlocked({ spell: false, somatic: true, held: [mace, shield] })).toBeNull();
  });
});

describe("handsCheckedFor", () => {
  it("personnages joueurs par défaut, tous, ou personne", () => {
    expect(handsCheckedFor("pc", true)).toBe(true);
    expect(handsCheckedFor("pc", false)).toBe(false);
    expect(handsCheckedFor(undefined, true)).toBe(true);
    expect(handsCheckedFor("all", false)).toBe(true);
    expect(handsCheckedFor("off", true)).toBe(false);
  });
});

describe("Neutralisé : sorts longs, rituels, activités longues", () => {
  it("un sort lancé est refusé, quel que soit son coût", () => {
    expect(conditionUseIssues({ statuses: ["paralyzed"], cost: null, castsSpell: true })).toEqual(["incapacitatedCasting"]);
    expect(conditionUseIssues({ statuses: ["stunned"], cost: "action", castsSpell: true })).toEqual(["incapacitated"]);
  });

  it("une activité d'une minute ou plus aussi", () => {
    expect(conditionUseIssues({ statuses: ["unconscious"], cost: null, longActivation: true })).toEqual(["incapacitatedCasting"]);
  });

  it("sans état neutralisant, rien ; sans sort ni activité longue, comme avant", () => {
    expect(conditionUseIssues({ statuses: [], cost: null, castsSpell: true })).toEqual([]);
    expect(conditionUseIssues({ statuses: ["incapacitated"], cost: null })).toEqual([]);
  });
});

describe("contenu `freeSomatic`", () => {
  it("Mage de guerre le déclare, la clé est validée", () => {
    expect(SHIPPED["war-caster"]?.freeSomatic).toBe(true);
    expect(validateEntry({ freeSomatic: true })).toEqual([]);
    expect(validateEntry({ freeSomatic: "yes" }).length).toBeGreaterThan(0);
  });
});
