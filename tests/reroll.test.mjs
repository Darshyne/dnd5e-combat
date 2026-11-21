/**
 * La relance d'un jet raté payée par une activité (`rollBonus.reroll`). Contre-charme (Barde 7, SRD 5.2) relance la sauvegarde avec
 * l'Avantage ; vu en jeu, la relance était un seul d20, et sa question parlait d'« une fois par Rage ».
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rerollFormula } from "../module/scripts/core/reroll.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("rerollFormula", () => {
  it("un d20, deux avec l'Avantage, le bonus s'il y en a un", () => {
    expect(rerollFormula({})).toBe("1d20");
    expect(rerollFormula(null)).toBe("1d20");
    expect(rerollFormula({ bonus: "0" })).toBe("1d20");
    expect(rerollFormula({ bonus: "@scale.barbarian.rage-damage" })).toBe("1d20 + @scale.barbarian.rage-damage");
    expect(rerollFormula({ advantage: true })).toBe("2d20kh");
    expect(rerollFormula({ advantage: true, bonus: "2" })).toBe("2d20kh + 2");
  });
});

describe("le schéma et le contenu", () => {
  const paid = reroll => ({ rollBonus: { activity: "dnd5eactivity000", on: ["save"], reroll } });
  it("`advantage: true` : seulement pour une relance qu'une activité paie", () => {
    expect(validateEntry(paid({ advantage: true }))).toEqual([]);
    expect(validateEntry(paid({ advantage: false })).length).toBeGreaterThan(0);
    const unpaid = { rollBonus: { on: ["save"], reroll: { bonus: "1", during: "rage", advantage: true } } };
    expect(validateEntry(unpaid).length).toBeGreaterThan(0);
  });
  it("Contre-charme relance avec l'Avantage", () => {
    expect(CONTENT.countercharm.rollBonus.reroll).toEqual({ advantage: true });
  });
  it("la question de la relance payée ne parle pas de Rage, et dit l'Avantage", () => {
    for ( const lang of ["en", "fr", "it"] ) {
      const table = JSON.parse(readFileSync(new URL(`../module/lang/${lang}.json`, import.meta.url), "utf8"));
      for ( const key of ["QuestionPayee", "QuestionAvantage"] ) {
        const text = table[`DND5ECOMBAT.Relance.${key}`];
        expect(text, `${lang} ${key}`).toBeTruthy();
        expect(text, `${lang} ${key}`).not.toMatch(/Rage|Ira|rage/);
        expect(text, `${lang} ${key}`).toContain("{item}");
      }
    }
  });
});
