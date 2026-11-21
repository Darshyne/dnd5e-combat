/**
 * Sort étendu (Métamagie, SRD 5.2) : la durée d'un sort d'au moins 1 minute doublée, 24 heures au plus ; l'Avantage aux sauvegardes
 * de Concentration si le sort en demande.
 */
import { describe, it, expect } from "vitest";
import { extendedSeconds } from "../module/scripts/core/extended.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("extendedSeconds — la durée doublée", () => {
  it("une minute et plus : le double, dans toutes les unités", () => {
    expect(extendedSeconds({ value: 60, units: "seconds" })).toBe(120);
    expect(extendedSeconds({ value: 1, units: "minute" })).toBe(120);
    expect(extendedSeconds({ value: 10, units: "minutes" })).toBe(1200);
    expect(extendedSeconds({ value: 10, units: "rounds" })).toBe(120);
    expect(extendedSeconds({ value: 8, units: "hours" })).toBe(57600);
  });
  it("24 heures au plus", () => {
    expect(extendedSeconds({ value: 16, units: "hours" })).toBe(86400);
    expect(extendedSeconds({ value: 24, units: "hours" })).toBe(null);
    expect(extendedSeconds({ value: 7, units: "days" })).toBe(null);
  });
  it("moins d'une minute, ou pas de durée chiffrée : rien", () => {
    expect(extendedSeconds({ value: 1, units: "round" })).toBe(null);
    expect(extendedSeconds({ value: 30, units: "seconds" })).toBe(null);
    expect(extendedSeconds({ value: null, units: "seconds" })).toBe(null);
    expect(extendedSeconds({ value: 1, units: "special" })).toBe(null);
    expect(extendedSeconds(null)).toBe(null);
  });
});

describe("l'entrée", () => {
  it("Sort étendu : une option retenue pour le prochain sort", () => {
    expect(CONTENT["extended-spell"]).toEqual({ metamagic: { activity: "WGQHGHweOlSpZDHp", kind: "extended" } });
    expect(validateEntry(CONTENT["extended-spell"])).toEqual([]);
  });
});
