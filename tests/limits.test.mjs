import { describe, it, expect } from "vitest";
import { usageLimitIssues, lowestSlotLevel, effectRefs, secondRageOption } from "../module/scripts/core/limits.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { resourceFeedback } from "../module/scripts/core/feedback.mjs";

const rule = { oncePerTurn: true, whenEmpty: "wild-shape" };
const base = { inCombat: true, ownTurn: true, usedThisTurn: false, remaining: 0 };

describe("Regain sauvage : limites d'utilisation", () => {
  it("à son tour, pas encore utilisé, Forme sauvage vide : rien ne cloche", () => {
    expect(usageLimitIssues(rule, base)).toEqual([]);
  });
  it("hors de son tour, ou déjà utilisé ce tour", () => {
    expect(usageLimitIssues(rule, { ...base, ownTurn: false })).toEqual(["notOwnTurn"]);
    expect(usageLimitIssues(rule, { ...base, usedThisTurn: true })).toEqual(["oncePerTurn"]);
  });
  it("il reste des utilisations de Forme sauvage", () => {
    expect(usageLimitIssues(rule, { ...base, remaining: 2 })).toEqual(["notEmpty"]);
  });
  it("hors combat : ni tour ni limite par tour", () => {
    expect(usageLimitIssues(rule, { inCombat: false, ownTurn: false, usedThisTurn: true, remaining: 0 })).toEqual([]);
  });
  it("l'emplacement le plus bas disponible", () => {
    expect(lowestSlotLevel({ 1: 0, 2: 3, 3: 1 })).toBe(2);
    expect(lowestSlotLevel({ 1: 4 })).toBe(1);
    expect(lowestSlotLevel({ 1: 0, 2: 0 })).toBe(null);
  });
  it("retour des ressources : seulement pour une activité qui rend quelque chose", () => {
    // Regain de Forme sauvage : +1 Forme sauvage, −1 emplacement niv. 2.
    expect(resourceFeedback([{ type: "itemUses", value: -1, name: "Forme sauvage" }, { type: "spellSlots", value: 1, level: 2 }]))
      .toEqual([{ kind: "gain", type: "itemUses", n: 1, name: "Forme sauvage" }, { kind: "spend", type: "spellSlots", n: 1, level: 2 }]);
    // Un sort ordinaire : rien.
    expect(resourceFeedback([{ type: "spellSlots", value: 1, level: 3 }])).toEqual([]);
  });
  it("schéma", () => {
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { ...rule, lowestSlot: true, noDialog: true, cost: "bonus" } } })).toEqual([]);
    // §298 : « free » est admis (Arme sacrée) ; un autre mot non.
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { cost: "free" } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { cost: "gratis" } } })).toEqual(["usageLimits.7nAgPNN2dth7SR0D.cost: action, bonus, reaction, free"]);
    expect(validateEntry({ usageLimits: { court: { oncePerTurn: 1 } } }))
      .toEqual(["usageLimits.court: activity id (16 characters) expected", "usageLimits.court.oncePerTurn: true or absent"]);
  });
});

describe("§486 : activité permise seulement sous un effet (whileEffect / unlessEffect)", () => {
  const off = { inCombat: false, ownTurn: false, usedThisTurn: false, remaining: null };
  it("sans l'effet requis : refusé, en combat ou non ; avec : permis", () => {
    expect(usageLimitIssues({ whileEffect: "alter-self" }, { ...off, underEffect: false })).toEqual(["needsEffect"]);
    expect(usageLimitIssues({ whileEffect: "alter-self" }, { ...base, underEffect: false })).toEqual(["needsEffect"]);
    expect(usageLimitIssues({ whileEffect: "alter-self" }, { ...off, underEffect: true })).toEqual([]);
  });
  it("sous un effet qui l'interdit : refusé ; hors de lui : permis", () => {
    expect(usageLimitIssues({ unlessEffect: ["aaaaaaaaaaaaaaaa"] }, { ...off, barredByEffect: true })).toEqual(["barredByEffect"]);
    expect(usageLimitIssues({ unlessEffect: ["aaaaaaaaaaaaaaaa"] }, { ...off, barredByEffect: false })).toEqual([]);
  });
  it("état inconnu (non calculé) : rien", () => {
    expect(usageLimitIssues({ whileEffect: "alter-self", unlessEffect: "x" }, off)).toEqual([]);
  });
  it("références : chaîne seule ou liste", () => {
    expect(effectRefs("alter-self")).toEqual(["alter-self"]);
    expect(effectRefs(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"])).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
    expect(effectRefs(undefined)).toEqual([]);
  });
  it("schéma", () => {
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { whileEffect: "alter-self" } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { whileEffect: ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"], oncePerTurn: true } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { unlessEffect: "some-form" } } })).toEqual([]);
    for ( const bad of [[], "", 3, [""], [1]] ) {
      expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { whileEffect: bad } } }))
        .toEqual(["usageLimits.7nAgPNN2dth7SR0D.whileEffect: item identifier or effect id, or a non-empty list of them"]);
    }
  });
});

describe("§509 (Core#98) : Rage du prédateur, une option par Rage", () => {
  it("en Rage, une option déjà prise refuse la suivante (souci forçable)", () => {
    expect(secondRageOption({ oneOption: true, raging: true, taken: 1 })).toBe(true);
    expect(secondRageOption({ oneOption: true, raging: true, taken: 0 })).toBe(false);
  });
  it("hors Rage, ou sans la règle, rien à refuser", () => {
    expect(secondRageOption({ oneOption: true, raging: false, taken: 1 })).toBe(false);
    expect(secondRageOption({ oneOption: false, raging: true, taken: 1 })).toBe(false);
    expect(secondRageOption()).toBe(false);
  });
  it("la clé est validée", () => {
    expect(validateEntry({ duringRage: { copiesEnd: true, oneOption: true } })).toEqual([]);
    expect(validateEntry({ duringRage: { oneOption: 1 } })).toHaveLength(1);
  });
});

describe("usageLimits.light : seulement dans la pénombre ou les ténèbres (Ne faire qu'un avec les ombres)", () => {
  const rule = { light: ["dim", "dark"] };
  const at = light => usageLimitIssues(rule, { inCombat: false, ownTurn: true, usedThisTurn: false, remaining: null, light });
  it("lumière faible, ténèbres : rien à reprocher ; pleine lumière : « wrongLight »", () => {
    expect(at("dim")).toEqual([]);
    expect(at("dark")).toEqual([]);
    expect(at("bright")).toEqual(["wrongLight"]);
  });
  it("lumière inconnue (pas de token sur la scène) : on ne reproche rien", () => {
    expect(at(null)).toEqual([]);
    expect(at(undefined)).toEqual([]);
  });
  it("sans la clé, la lumière ne compte pas", () => {
    const state = { inCombat: false, ownTurn: true, usedThisTurn: false, remaining: null, light: "bright" };
    expect(usageLimitIssues({}, state)).toEqual([]);
  });
});
