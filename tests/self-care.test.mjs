import { describe, it, expect } from "vitest";
import { ownConditionsRule, pickOwnCondition, initiativeRegain } from "../module/scripts/core/self-care.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const v = entry => validateEntry(entry, { facts: {} });

describe("§278 : mettre fin à un de ses états", () => {
  it("la liste d'états reste la règle de fin de tour (§236)", () => {
    expect(ownConditionsRule(["charmed", "frightened"])).toEqual({ statuses: ["charmed", "frightened"], at: "turnEnd", exhaustion: false, uses: false });
    expect(v({ endsOwnConditions: ["charmed"] })).toEqual([]);
  });

  it("au début du tour, un état de la liste, sinon un niveau d'Épuisement, contre une utilisation", () => {
    const rule = ownConditionsRule({ statuses: ["paralyzed", "stunned"], at: "turnStart", exhaustion: true, uses: true });
    expect(pickOwnCondition(rule, { statuses: new Set(["stunned", "prone"]), exhaustion: 2, usesLeft: 1 })).toEqual({ status: "stunned" });
    expect(pickOwnCondition(rule, { statuses: new Set(["prone"]), exhaustion: 2, usesLeft: 1 })).toEqual({ exhaustion: true });
    expect(pickOwnCondition(rule, { statuses: new Set(["prone"]), exhaustion: 0, usesLeft: 1 })).toBe(null);
    expect(pickOwnCondition(rule, { statuses: new Set(["stunned"]), exhaustion: 2, usesLeft: 0 })).toBe(null);
  });

  it("validation", () => {
    expect(v({ endsOwnConditions: { statuses: ["stunned"], at: "turnStart", exhaustion: true, uses: true } })).toEqual([]);
    expect(v({ endsOwnConditions: { exhaustion: true } })).toEqual([]);
    expect(v({ endsOwnConditions: { at: "turnStart" } })[0]).toMatch(/endsOwnConditions/);
    expect(v({ endsOwnConditions: { statuses: ["stunned"], at: "midTurn" } })[0]).toMatch(/endsOwnConditions/);
  });
});

describe("§278 : regagner au jet d'initiative", () => {
  it("{ item, upTo } (§236) : les utilisations remontent à upTo au moins", () => {
    expect(initiativeRegain({ item: "bardic-inspiration", upTo: 2 }, { items: { "bardic-inspiration": { max: 5, spent: 5 } } }))
      .toEqual({ spent: { "bardic-inspiration": 3 }, exhaustion: null, pay: false });
    expect(initiativeRegain({ item: "bardic-inspiration", upTo: 2 }, { items: { "bardic-inspiration": { max: 5, spent: 2 } } })).toBe(null);
  });

  it("plusieurs items en entier et un niveau d'Épuisement, contre une utilisation, seulement s'il y a à gagner", () => {
    const rule = { items: ["essai-a", "essai-b", "essai-c"], exhaustion: 1, uses: true };
    const items = { "essai-a": { max: 1, spent: 1 }, "essai-b": { max: 1, spent: 0 } };
    expect(initiativeRegain(rule, { items, exhaustion: 3, usesLeft: 1 })).toEqual({ spent: { "essai-a": 0 }, exhaustion: 2, pay: true });
    expect(initiativeRegain(rule, { items, exhaustion: 3, usesLeft: 0 })).toBe(null);
    expect(initiativeRegain(rule, { items: { "essai-a": { max: 1, spent: 0 } }, exhaustion: 0, usesLeft: 1 })).toBe(null);
  });

  it("validation", () => {
    expect(v({ regainOnInitiative: { item: "x", upTo: 2 } })).toEqual([]);
    expect(v({ regainOnInitiative: { items: ["x", "y"], exhaustion: 1, uses: true } })).toEqual([]);
    expect(v({ regainOnInitiative: { uses: true } })[0]).toMatch(/regainOnInitiative/);
    expect(v({ regainOnInitiative: { item: "x", items: ["y"], upTo: 1 } })[0]).toMatch(/regainOnInitiative/);
  });
});
