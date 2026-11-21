/**
 * Pas du vent (Moine, SRD 5.2) : « Foncer par une action Bonus ; ou, pour 1 point de crédo, Se désengager et Foncer, et la distance
 * de saut est doublée ». L'activité `0MuRZ0Ur95xQTKFq` est la version payée dans le Manuel des joueurs 2.2.0 et la version gratuite
 * dans le SRD 5.2 : vu en jeu avec l'item du SRD, la version gratuite donnait Foncer, Se désengager et le saut doublé.
 */
import { describe, it, expect } from "vitest";
import { basicKindsFor, hasPaidForm } from "../module/scripts/core/basic-kinds.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("basicKindsFor — la forme payée ou gratuite d'une déclaration", () => {
  const step = { paid: ["dash", "disengage"], free: "dash" };
  it("payée si l'activité dépense, gratuite sinon", () => {
    expect(basicKindsFor(step, true)).toEqual(["dash", "disengage"]);
    expect(basicKindsFor(step, false)).toBe("dash");
  });
  it("une forme absente : rien pour cette utilisation", () => {
    expect(basicKindsFor({ paid: "dash" }, false)).toBeNull();
    expect(basicKindsFor({ free: "dash" }, true)).toBeNull();
  });
  it("une déclaration sans ces formes passe telle quelle, qu'elle dépense ou non", () => {
    for ( const declared of ["hide", ["disengage", "dodge"], { choose: ["dash", "disengage"] }] ) {
      expect(basicKindsFor(declared, true)).toBe(declared);
      expect(basicKindsFor(declared, false)).toBe(declared);
      expect(hasPaidForm(declared)).toBe(false);
    }
    expect(basicKindsFor(undefined, true)).toBeNull();
    expect(hasPaidForm(step)).toBe(true);
  });
});

describe("le schéma et le contenu", () => {
  const entry = kind => ({ basicActions: { "0MuRZ0Ur95xQTKFq": kind } });
  it("`{ paid, free }` : un genre ou une liste pour chacune", () => {
    expect(validateEntry(entry({ paid: ["dash", "disengage"], free: "dash" }))).toEqual([]);
    expect(validateEntry(entry({ free: "dash" }))).toEqual([]);
    expect(validateEntry(entry({ paid: ["dash", "fly"] })).length).toBe(1);
    expect(validateEntry(entry({ paid: "dash", other: "hide" })).length).toBe(1);
  });
  it("Pas du vent : payé, Foncer et Se désengager ; gratuit, Foncer seul", () => {
    const declared = CONTENT["monks-focus"].basicActions["0MuRZ0Ur95xQTKFq"];
    expect(basicKindsFor(declared, true)).toEqual(["dash", "disengage"]);
    expect(basicKindsFor(declared, false)).toBe("dash");
    // L'activité payée du SRD 5.2 et du Manuel 3.0.0, distincte : inchangée.
    expect(CONTENT["monks-focus"].basicActions.Iv2YrISquTZWEjjN).toEqual(["dash", "disengage"]);
  });
});
