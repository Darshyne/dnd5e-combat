import { describe, it, expect } from "vitest";
import { reduceDamageOfType, hitDiceAllowed, halveUnresisted, attractorOf } from "../module/scripts/core/defenses.mjs";
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
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", do: [{ type: "attackBonus" }] }] }, { facts: {} })).toContain("triggers[0].do[0].formula: formula required");
  });
});

describe("O8d (§347) : défenses contre les attaques à distance", () => {
  it("Résistance aux dégâts d'une arme à distance : chaque part divisée par deux, arrondie à l'inférieur", () => {
    const r = halveUnresisted([{ value: 7, type: "piercing" }, { value: 4, type: "fire" }]);
    expect(r.damages.map(d => d.value)).toEqual([3, 2]);
    expect(r.reduced).toBe(6);
  });
  it("un type déjà résisté ou immunisé n'est pas réduit deux fois ; soins inchangés", () => {
    const r = halveUnresisted([{ value: 8, type: "piercing" }, { value: 6, type: "fire" }, { value: 5, type: "healing" }],
      { resisted: ["piercing"], immune: [] });
    expect(r.damages.map(d => d.value)).toEqual([8, 3, 5]);
  });
  it("le porteur le plus proche à portée prend la place de la cible ; aucun à portée : personne", () => {
    expect(attractorOf([{ id: "a", distance: 10, within: true }, { id: "b", distance: 5, within: true }, { id: "c", distance: 1, within: false }])).toBe("b");
    expect(attractorOf([{ id: "a", distance: 15, within: false }])).toBe(null);
    expect(attractorOf([])).toBe(null);
  });
  it("validation : rangedDefense et l'étape intercept", () => {
    expect(validateEntry({ rangedDefense: { ac: 2 } })).toEqual([]);
    expect(validateEntry({ rangedDefense: { resistance: true, attract: 10 } })).toEqual([]);
    expect(validateEntry({ rangedDefense: {} }).length).toBe(1);
    expect(validateEntry({ rangedDefense: { ac: 1.5, resistance: "yes", attract: -1, other: 1 } }).length).toBe(4);
    expect(validateEntry({ triggers: [{ on: "enemyAttacks", do: [{ type: "use", activity: "KZLj6yQjI7Ps1KkW" }, { type: "intercept" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use", activity: "KZLj6yQjI7Ps1KkW" }, { type: "intercept" }] }] }).length).toBe(1);
    expect(validateEntry({ triggers: [{ on: "enemyAttacks", do: [{ type: "intercept" }] }] }).length).toBe(1);
  });
});

import { weaponFeed } from "../module/scripts/core/defenses.mjs";

describe("§355 : armes qui nourrissent leur porteur", () => {
  const v = (id, o={}) => ({ id, type: "humanoid", hit: true, critical: false, fell: false, maxHp: 30, ...o });
  it("Noirtranchant : tombée à 0, tuée et son maximum de PV en PV temporaires ; pas un Mort-vivant", () => {
    expect(weaponFeed({ devours: true, victims: [v("a", { fell: true }), v("b", { fell: true, type: "undead", maxHp: 90 })] })).toEqual({ tempHp: 30, slain: ["a"] });
    expect(weaponFeed({ devours: true, victims: [v("a")] })).toEqual({ tempHp: 0, slain: [] });
  });
  it("Épée voleuse de vie : 15 sur un critique, pas sur une Créature artificielle", () => {
    expect(weaponFeed({ critAmount: 15, victims: [v("a", { critical: true })] }).tempHp).toBe(15);
    expect(weaponFeed({ critAmount: 15, victims: [v("a", { critical: true, type: "construct" })] }).tempHp).toBe(0);
    expect(weaponFeed({ critAmount: 15, victims: [v("a")] }).tempHp).toBe(0);
  });
  it("validation", () => {
    expect(validateEntry({ devours: true, critFeeds: { amount: 15 }, maxSpellDamageVs: ["fiend"] })).toEqual([]);
    expect(validateEntry({ devours: 1, critFeeds: { amount: 0 }, maxSpellDamageVs: ["dragonkin"] }).length).toBe(3);
  });
});

import { wrathSaveDue, wrathEnds } from "../module/scripts/core/defenses.mjs";

describe("§356 : armes maudites, colère du porteur", () => {
  it("la sauvegarde : blessé par un autre, pas déjà en colère ; la vengeance seulement en combat", () => {
    expect(wrathSaveDue({ kind: "berserk", byOther: true, inCombat: false, marked: false })).toBe(true);
    expect(wrathSaveDue({ kind: "vengeance", byOther: true, inCombat: false, marked: false })).toBe(false);
    expect(wrathSaveDue({ kind: "vengeance", byOther: true, inCombat: true, marked: false })).toBe(true);
    expect(wrathSaveDue({ kind: "berserk", byOther: false, inCombat: true, marked: false })).toBe(false);
    expect(wrathSaveDue({ kind: "berserk", byOther: true, inCombat: true, marked: true })).toBe(false);
  });
  it("la fin : folie furieuse sans créature à 18 m, vengeance quand l'un des deux tombe", () => {
    expect(wrathEnds({ kind: "berserk", othersNear: false, foeDown: false, bearerDown: false })).toBe(true);
    expect(wrathEnds({ kind: "berserk", othersNear: true, foeDown: true, bearerDown: false })).toBe(false);
    expect(wrathEnds({ kind: "vengeance", othersNear: true, foeDown: true, bearerDown: false })).toBe(true);
    expect(wrathEnds({ kind: "vengeance", othersNear: false, foeDown: false, bearerDown: false })).toBe(false);
    expect(wrathEnds({ kind: "vengeance", othersNear: true, foeDown: false, bearerDown: true })).toBe(true);
  });
  it("validation", () => {
    expect(validateEntry({ wrath: { kind: "berserk", save: { ability: "wis", dc: 15 } } })).toEqual([]);
    expect(validateEntry({ wrath: { kind: "rage", save: { ability: "wis", dc: 15 } } }).length).toBe(1);
  });
});
