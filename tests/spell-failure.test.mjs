import { describe, it, expect } from "vitest";
import { failureFor, spellFailed } from "../module/scripts/core/spell-failure.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("échec d'un sort sous Lenteur", () => {
  const slow = { chance: 25, component: "somatic", name: "Lenteur" };

  it("vaut pour un sort à composante somatique, pas pour un autre", () => {
    expect(failureFor([slow], ["vocal", "somatic"])?.chance).toBe(25);
    expect(failureFor([slow], ["vocal"])).toBeNull();
    expect(failureFor([], ["somatic"])).toBeNull();
  });

  it("garde la plus forte chance, sans cumul", () => {
    expect(failureFor([slow, { chance: 50, name: "Autre" }], ["somatic"])).toMatchObject({ chance: 50, name: "Autre" });
    expect(failureFor([slow, slow], ["somatic"]).chance).toBe(25);
  });

  it("échoue de 1 à la chance comprise", () => {
    expect(spellFailed(25, 1)).toBe(true);
    expect(spellFailed(25, 25)).toBe(true);
    expect(spellFailed(25, 26)).toBe(false);
    expect(spellFailed(25, NaN)).toBe(false);
  });

  it("Lenteur déclare la règle, et le schéma la valide", () => {
    expect(CONTENT.slow?.spellFailure).toEqual({ chance: 25, component: "somatic" });
    expect(validateEntry({ spellFailure: { chance: 25, component: "somatic" } }, { at: "x." })).toEqual([]);
    expect(validateEntry({ spellFailure: { chance: 0 } }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ spellFailure: { chance: 25, component: "gestures" } }, { at: "x." }).length).toBeGreaterThan(0);
  });
});

describe("dégâts sans type dans la donnée", () => {
  it("Sphère glacée d'Otiluke : froid, et le schéma refuse un type inconnu", () => {
    expect(CONTENT["otilukes-freezing-sphere"]?.untypedDamage).toBe("cold");
    expect(validateEntry({ untypedDamage: "cold" }, { at: "x." })).toEqual([]);
    expect(validateEntry({ untypedDamage: "ice" }, { at: "x." }).length).toBeGreaterThan(0);
  });
});
