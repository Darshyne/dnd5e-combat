/**
 * Survivant (Guerrier, Champion 18 — SRD 5.2). Défier la mort : un 18 à 20 à une sauvegarde contre la mort vaut un 20. Sursaut
 * héroïque : au début de chacun de ses tours, le Champion Ensanglanté qui a au moins 1 point de vie regagne des points de vie.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { turnStartHealDue, deathSaveCriticalOf } from "../module/scripts/core/self-care.mjs";

describe("Sursaut héroïque — turnStartHealDue", () => {
  const rule = { activity: "5Fo0QwzexIPyLP3W", bloodied: true };
  it("Ensanglanté (la moitié des PV ou moins) et au moins 1 PV", () => {
    expect(turnStartHealDue(rule, { hp: 30, max: 60 })).toBe(true);
    expect(turnStartHealDue(rule, { hp: 1, max: 60 })).toBe(true);
    expect(turnStartHealDue(rule, { hp: 31, max: 60 })).toBe(false);
    expect(turnStartHealDue(rule, { hp: 0, max: 60 })).toBe(false);
    expect(turnStartHealDue(rule, { hp: 30, max: 61 })).toBe(true);
  });
  it("sans `bloodied` : dès qu'il manque des PV ; jamais à PV pleins ni sans règle", () => {
    expect(turnStartHealDue({ activity: "5Fo0QwzexIPyLP3W" }, { hp: 59, max: 60 })).toBe(true);
    expect(turnStartHealDue({ activity: "5Fo0QwzexIPyLP3W" }, { hp: 60, max: 60 })).toBe(false);
    expect(turnStartHealDue(undefined, { hp: 10, max: 60 })).toBe(false);
  });
});

describe("Défier la mort — deathSaveCriticalOf", () => {
  it("le plus bas des seuils déclarés, ou rien", () => {
    expect(deathSaveCriticalOf([undefined, 18, null])).toBe(18);
    expect(deathSaveCriticalOf([19, 18])).toBe(18);
    expect(deathSaveCriticalOf([undefined])).toBe(null);
    expect(deathSaveCriticalOf([20, 1, 18.5])).toBe(null);
  });
});

describe("l'entrée et le schéma", () => {
  it("Survivant", () => {
    expect(CONTENT["survivor"]).toEqual({ deathSaveCritical: 18, turnStartHeal: { activity: "5Fo0QwzexIPyLP3W", bloodied: true } });
    expect(validateEntry(CONTENT["survivor"])).toEqual([]);
  });
  it("formes refusées", () => {
    expect(validateEntry({ turnStartHeal: { activity: "court" } }).length).toBe(1);
    expect(validateEntry({ turnStartHeal: { activity: "5Fo0QwzexIPyLP3W", bloodied: false } }).length).toBe(1);
    expect(validateEntry({ deathSaveCritical: 20 }).length).toBe(1);
    expect(validateEntry({ deathSaveCritical: 18 })).toEqual([]);
  });
});
