import { describe, it, expect } from "vitest";
import { sneakAttackIssue, parseDice, sneakDiceAtLevel, affordableStrikes, settleStrikes, hasNotActedYet } from "../module/scripts/core/sneak.mjs";
import { open, advance, applicationPlan } from "../module/scripts/core/action.mjs";
import { attackModifiers } from "../module/scripts/core/conditions.mjs";
import { usageLimitIssues } from "../module/scripts/core/limits.mjs";
import { movementAllowance, freshBudget } from "../module/scripts/core/turn.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§20 Attaque sournoise : quand elle s'applique", () => {
  const ok = { weapon: true, finesse: true, rangedWeapon: false, advantageMode: 1, allyNear: false };
  it("arme de Finesse avec l'Avantage", () => expect(sneakAttackIssue(ok)).toBe(null));
  it("arme à distance, sans Avantage mais un allié à 1,50 m de la cible", () => {
    expect(sneakAttackIssue({ ...ok, finesse: false, rangedWeapon: true, advantageMode: 0, allyNear: true })).toBe(null);
  });
  it("allié à côté mais Désavantage : non", () => expect(sneakAttackIssue({ ...ok, advantageMode: -1, allyNear: true })).toBe("disadvantage"));
  it("ni Avantage ni allié : non", () => expect(sneakAttackIssue({ ...ok, advantageMode: 0 })).toBe("noAdvantage"));
  it("arme ni de Finesse ni à distance (hache, lance lancée) : non", () => expect(sneakAttackIssue({ ...ok, finesse: false })).toBe("weaponKind"));
  it("un sort ou une attaque à mains nues : non", () => expect(sneakAttackIssue({ ...ok, weapon: false })).toBe("notWeapon"));
  it("déjà utilisée ce tour : non", () => expect(sneakAttackIssue({ ...ok, spent: true })).toBe("spent"));
});

describe("§20 Attaque sournoise : les dés", () => {
  it("la formule de l'échelle, ou le niveau", () => {
    expect(parseDice("3d6")).toEqual({ number: 3, faces: 6 });
    expect(parseDice(" 10d6 ")).toEqual({ number: 10, faces: 6 });
    expect(parseDice("@scale.rogue.sneak-attack")).toBe(null);
    expect(sneakDiceAtLevel(1)).toEqual({ number: 1, faces: 6 });
    expect(sneakDiceAtLevel(5)).toEqual({ number: 3, faces: 6 });
    expect(sneakDiceAtLevel(20)).toEqual({ number: 10, faces: 6 });
    expect(sneakDiceAtLevel(0)).toBe(null);
  });
});

describe("§20 Frappes rusées", () => {
  const options = [
    { key: "poison", cost: 1, available: false }, { key: "trip", cost: 1 }, { key: "withdraw", cost: 1 },
    { key: "daze", cost: 2 }, { key: "knockOut", cost: 6 }, { key: "obscure", cost: 3 }
  ];
  it("seulement ce qu'on peut payer, et ce qui est possible (trousse d'empoisonneur)", () => {
    expect(affordableStrikes(options, 3).map(o => o.key)).toEqual(["trip", "withdraw", "daze", "obscure"]);
    expect(affordableStrikes(options, 1).map(o => o.key)).toEqual(["trip", "withdraw"]);
  });
  it("un effet au niveau 5 : le second est écarté", () => {
    expect(settleStrikes(["trip", "withdraw"], affordableStrikes(options, 3), { dice: 3, max: 1 })).toEqual({ strikes: ["trip"], cost: 1, dice: 2 });
  });
  it("deux effets au niveau 11, dans la limite des dés ; pas deux fois le même", () => {
    const opts = affordableStrikes(options, 6);
    expect(settleStrikes(["trip", "withdraw"], opts, { dice: 6, max: 2 })).toEqual({ strikes: ["trip", "withdraw"], cost: 2, dice: 4 });
    expect(settleStrikes(["trip", "trip"], opts, { dice: 6, max: 2 })).toEqual({ strikes: ["trip"], cost: 1, dice: 5 });
    expect(settleStrikes(["knockOut", "trip"], opts, { dice: 6, max: 2 })).toEqual({ strikes: ["knockOut"], cost: 6, dice: 0 });
    expect(settleStrikes(["inconnu"], opts, { dice: 6, max: 2 })).toEqual({ strikes: [], cost: 0, dice: 6 });
  });
});

describe("§20 Assassinat : une créature qui n'a pas encore joué", () => {
  it("premier round seulement, celles qui passent après le tour en cours", () => {
    expect(hasNotActedYet({ round: 1, turn: 0, targetTurn: 2 })).toBe(true);
    expect(hasNotActedYet({ round: 1, turn: 2, targetTurn: 1 })).toBe(false);
    expect(hasNotActedYet({ round: 1, turn: 2, targetTurn: 2 })).toBe(false);
    expect(hasNotActedYet({ round: 2, turn: 0, targetTurn: 3 })).toBe(false);
    expect(hasNotActedYet({ round: 1, turn: 1, targetTurn: null })).toBe(true);
  });
});

describe("§20 Esquive totale", () => {
  const base = { id: "r", carrier: "M", origin: "M", activity: "Act", source: "Src" };
  const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
  const multipliers = (save, targets, totals) => {
    let { resolution } = open({ ...base, plan: { save, damage: "author", effects: [] }, targets });
    totals.forEach((total, i) => ({ resolution } = advance(resolution, { type: "saveRolled", actor: `A${i + 1}`, total, messageId: `s${i}` })));
    return applicationPlan(resolution).map(e => e.multiplier);
  };
  const dex = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
  it("sauvegarde de Dextérité pour la moitié : rien sur une réussite, la moitié sur un échec", () => {
    expect(multipliers(dex, [T(1, { evasion: true }), T(2, { evasion: true }), T(3)], [20, 3, 20])).toEqual([0, 0.5, 0.5]);
  });
  it("pas pour une autre caractéristique, ni pour une sauvegarde sans moitié", () => {
    expect(multipliers({ ...dex, ability: "con" }, [T(1, { evasion: true })], [3])).toEqual([1]);
    expect(multipliers({ ...dex, onSave: "none" }, [T(1, { evasion: true })], [20])).toEqual([0]);
    expect(multipliers({ ...dex, onSave: "none" }, [T(1, { evasion: true })], [3])).toEqual([1]);
  });
});

describe("§20 Insaisissable", () => {
  const ctx = { attacker: ["hidden"], target: ["prone"], adjacent: true, ranged: false, declared: { advantage: ["Tactique de meute"], disadvantage: [] } };
  it("aucune raison d'Avantage ne compte ; le Désavantage, si", () => {
    expect(attackModifiers(ctx).advantage.length).toBeGreaterThan(0);
    const elusive = attackModifiers({ ...ctx, elusive: true, attacker: ["restrained"] });
    expect(elusive.advantage).toEqual([]);
    expect(elusive.disadvantage.map(r => r.key)).toEqual(["restrained"]);
  });
});

describe("§20 Visée appliquée et Repli", () => {
  it("« si vous ne vous êtes pas déplacé pendant ce tour » — en combat", () => {
    const state = { inCombat: true, ownTurn: true, usedThisTurn: false, remaining: null };
    expect(usageLimitIssues({ unmoved: true }, { ...state, moved: true })).toEqual(["moved"]);
    expect(usageLimitIssues({ unmoved: true }, { ...state, moved: false })).toEqual([]);
    expect(usageLimitIssues({ unmoved: true }, { ...state, inCombat: false, moved: true })).toEqual([]);
  });
  it("Repli ouvre la moitié de la Vitesse en plus ; Foncer ne la double pas", () => {
    expect(movementAllowance({ ...freshBudget(), bonusMove: 15 }, 30)).toBe(45);
    expect(movementAllowance({ ...freshBudget(), dashed: true, bonusMove: 15 }, 30)).toBe(75);
    expect(movementAllowance(freshBudget(), 30)).toBe(30);
  });
});

describe("§20 schéma et contenu du Roublard", () => {
  it("les clés nouvelles", () => {
    expect(validateEntry({ sneakAttack: true, evasion: true, elusive: true, holdsStill: true, cunningStrikeMax: 2 })).toEqual([]);
    expect(validateEntry({ sneakBonus: { formula: "@classes.rogue.levels", firstRound: true } })).toEqual([]);
    expect(validateEntry({ cunningStrikes: { trip: { cost: 1, activity: "dWcCw1vTWRMx4YzD", sizeAtMost: "lg" }, withdraw: { cost: 1, withdraw: true } } })).toEqual([]);
    expect(validateEntry({ cunningStrikes: { x: { cost: 0 } } })).toEqual(["cunningStrikes.x.cost : entier positif (dés)", "cunningStrikes.x : une activité ou withdraw"]);
    expect(validateEntry({ cunningStrikes: { x: { cost: 1, withdraw: true, sizeAtMost: "big" } } })).toEqual(["cunningStrikes.x.sizeAtMost : tiny, sm, med, lg, huge, grg"]);
    expect(validateEntry({ basicActions: { NiI5qEhg9TepZxMh: "hide" } })).toEqual([]);
    expect(validateEntry({ basicActions: { NiI5qEhg9TepZxMh: "fly" } })).toEqual(["basicActions.NiI5qEhg9TepZxMh : dash, disengage, dodge, hide, help (ou une liste)"]);
    expect(validateEntry({ usageLimits: { VGVYnecMRcu0f5Sq: { unmoved: true } } })).toEqual([]);
  });
  it("le contenu livré", () => {
    expect(CONTENT["sneak-attack"].sneakAttack).toBe(true);
    expect(Object.keys(CONTENT["cunning-strike"].cunningStrikes)).toEqual(["poison", "trip", "withdraw"]);
    expect(Object.keys(CONTENT["devious-strikes"].cunningStrikes)).toEqual(["daze", "knockOut", "obscure"]);
    expect(CONTENT["improved-cunning-strike"].cunningStrikeMax).toBe(2);
    expect(CONTENT["cunning-action"].basicActions).toEqual({ NtS3iThuWWwm8O62: "dash", AeCciDTvw3kS583a: "disengage", NiI5qEhg9TepZxMh: "hide" });
    expect(CONTENT["steady-aim"].holdsStill).toBe(true);
    expect(CONTENT.evasion.evasion).toBe(true);
    expect(CONTENT.elusive.elusive).toBe(true);
    expect(CONTENT.assassinate.sneakBonus).toEqual({ formula: "@classes.rogue.levels", firstRound: true });
    // Esquive instinctive reste où elle était (table des déclencheurs).
    expect(CONTENT["uncanny-dodge"].triggers[0].on).toBe("isHit");
  });
});

describe("§72 : Attaque sournoise d'un PNJ", () => {
  const base = { weapon: true, finesse: false, rangedWeapon: false, advantageMode: 0, allyNear: false };
  it("toute arme (anyWeapon), avec l'Avantage", () => expect(sneakAttackIssue({ ...base, anyWeapon: true, advantageMode: 1 })).toBe(null));
  it("sans anyWeapon, une arme ni Finesse ni à distance : non", () => expect(sneakAttackIssue({ ...base, advantageMode: 1 })).toBe("weaponKind"));
  it("contre un mort-vivant (freeTarget) : ni Avantage ni allié requis", () => expect(sneakAttackIssue({ ...base, anyWeapon: true, freeTarget: true })).toBe(null));
  it("déjà utilisée ce tour : non, même contre un mort-vivant", () => expect(sneakAttackIssue({ ...base, anyWeapon: true, freeTarget: true, spent: true })).toBe("spent"));
});
