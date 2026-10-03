import { describe, it, expect } from "vitest";
import { reduceDamageOfType, hitDiceAllowed } from "../module/scripts/core/defenses.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("Résistance : réduire les dégâts d'un type", () => {
  it("retire au type protégé seulement", () => {
    const r = reduceDamageOfType([{ value: 8, type: "fire" }, { value: 5, type: "slashing" }], "fire", 3);
    expect(r.reduced).toBe(3);
    expect(r.damages).toEqual([{ value: 5, type: "fire" }, { value: 5, type: "slashing" }]);
  });
  it("jamais sous zéro, réparti sur plusieurs entrées", () => {
    const r = reduceDamageOfType([{ value: 1, type: "cold" }, { value: 2, type: "cold" }], "cold", 4);
    expect(r.reduced).toBe(3);
    expect(r.damages.map(d => d.value)).toEqual([0, 0]);
  });
  it("aucun dégât du type : rien", () => {
    expect(reduceDamageOfType([{ value: 6, type: "acid" }], "fire", 3).reduced).toBe(0);
  });
});

describe("Vigueur arcanique : combien de dés", () => {
  it("2 au niveau 2, +1 par niveau au-dessus, au plus ceux qui restent", () => {
    expect(hitDiceAllowed({ base: 2, spellLevel: 2, slotLevel: 2, available: 5 })).toBe(2);
    expect(hitDiceAllowed({ base: 2, spellLevel: 2, slotLevel: 3, available: 5 })).toBe(3);
    expect(hitDiceAllowed({ base: 2, spellLevel: 2, slotLevel: 3, available: 1 })).toBe(1);
    expect(hitDiceAllowed({ base: 2, spellLevel: 2, slotLevel: 2, available: 0 })).toBe(0);
  });
});

describe("schéma", () => {
  it("attackBonus, damageShield, hitDiceHeal", () => {
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", via: "effect", do: [{ type: "attackBonus", formula: "-1d4" }] }] }, { facts: {} })).toEqual([]);
    expect(validateEntry({ damageShield: { formula: "1d4", effects: { u2mf5JowVgwqCARq: "acid" }, oncePerTurn: true } })).toEqual([]);
    expect(validateEntry({ hitDiceHeal: { activity: "5paXkJ6hEw07yl8g", base: 2 } })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", do: [{ type: "attackBonus" }] }] }, { facts: {} })).toContain("triggers[0].do[0].formula : formule requise");
  });
});
