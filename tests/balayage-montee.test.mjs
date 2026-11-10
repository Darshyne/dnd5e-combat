/**
 * §406 : le calcul des dés attendus du balayage `MONTEE` (tools/lib/balayage.mjs), sur des données d'activité du Manuel recopiées
 * dans leur forme (pas de texte d'item) — même règle que `DamageData#scaledFormula` de dnd5e 6.0.6.
 */
import { describe, it, expect } from "vitest";
import { upcastDice, missingDice } from "../tools/lib/balayage.mjs";

const part = (number, denomination, scaling={}, custom=null) => ({ number, denomination, types: ["fire"],
  custom: custom ? { enabled: true, formula: custom } : { enabled: false, formula: "" }, scaling: { mode: "", number: 1, formula: "", ...scaling } });

describe("balayage MONTEE — dés attendus (§406)", () => {
  it("mode « whole » : un dé de plus par niveau (Orbe chromatique 3d8, deux niveaux au-dessus → 5d8)", () => {
    expect(upcastDice({ damage: { parts: [part(3, 8, { mode: "whole" })] } }, 2)).toEqual([{ count: 5, faces: 8, part: 0 }]);
  });

  it("mode « half » : un niveau sur deux (Arme spirituelle 1d8, +2 niveaux → 2d8 ; +1 → rien qui monte)", () => {
    expect(upcastDice({ damage: { parts: [part(1, 8, { mode: "half" })] } }, 2)).toEqual([{ count: 2, faces: 8, part: 0 }]);
    expect(upcastDice({ damage: { parts: [part(1, 8, { mode: "half" })] } }, 1)).toEqual([]);
  });

  it("sans montée, ou montée de 0 dé : rien d'attendu", () => {
    expect(upcastDice({ damage: { parts: [part(1, 10)] } }, 2)).toEqual([]);
    expect(upcastDice({ damage: { parts: [part(1, 10, { mode: "whole", number: 0 })] } }, 2)).toEqual([]);
    expect(upcastDice({ type: "utility" }, 2)).toEqual([]);
  });

  it("formule personnalisée : le premier dé monte ; `scaling.formula` s'ajoute autant de fois", () => {
    expect(upcastDice({ damage: { parts: [part(null, null, { mode: "whole", number: 2 }, "4d6 + @mod")] } }, 2)).toEqual([{ count: 8, faces: 6, part: 0 }]);
    expect(upcastDice({ damage: { parts: [part(2, 8, { mode: "whole", number: 0, formula: "1d6" })] } }, 3))
      .toEqual([{ count: 3, faces: 6, part: 0, formula: true }]);
  });

  it("le soin d'une activité de soin (Soins 2d8, +2 → 6d8 avec 2 dés par niveau)", () => {
    expect(upcastDice({ healing: part(2, 8, { mode: "whole", number: 2 }) }, 2)).toEqual([{ count: 6, faces: 8, part: 0 }]);
  });

  it("missingDice : le compte juste ou son double (critique) passe ; le niveau de base est un manque", () => {
    const want = [{ count: 5, faces: 8 }];
    expect(missingDice(want, ["5d8"])).toEqual([]);
    expect(missingDice(want, ["10d8"])).toEqual([]);
    expect(missingDice(want, ["3d8"])).toEqual(["5d8 attendu"]);
    expect(missingDice([{ count: 4, faces: 6 }, { count: 2, faces: 6 }], ["4d6 + 2d6 + 5"])).toEqual([]);
  });
});
