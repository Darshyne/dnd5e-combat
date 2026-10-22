import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readUsage } from "../module/scripts/adapter/usage.mjs";

// §226 : les effets d'un item `zoneEffects` sont portés par sa zone (comportement `applyActiveEffect` du cœur) — l'utilisation ne les
// pose jamais sur les cibles, quel que soit le type de l'activité. Exemples synthétiques, sans Foundry : `identifier` d'un sort livré
// `zoneEffects` (Silence), un autre sans clé.
const saved = {};
beforeAll(() => {
  for ( const key of ["game", "fromUuidSync"] ) saved[key] = globalThis[key];
  globalThis.game = { settings: { get: () => ({}) }, user: { isGM: false }, actors: { get: () => null } };
  globalThis.fromUuidSync = () => null;
});
afterAll(() => {
  for ( const [key, value] of Object.entries(saved) ) globalThis[key] = value;
});

const effect = { _id: "effAAAAAAAAAAAAA" };
const itemOf = identifier => ({ name: identifier, type: "feat", flags: {}, system: { identifier }, effects: { get: () => null } });
const activityOf = (identifier, type, extra={}) => ({
  id: "actAAAAAAAAAAAAA", uuid: `Item.x.Activity.${type}`, type, item: itemOf(identifier), effects: [effect], target: {}, range: {}, ...extra
});
const messageOf = activity => ({
  id: "msgAAAAAAAAAAAAA", system: { targets: [{ token: "Scene.s.Token.t", actor: "Actor.a", name: "Zombi" }] }, speaker: {},
  flags: {}, getFlag: () => undefined, getAssociatedActivity: () => activity, getAssociatedActor: () => null
});

describe("effets portés par la zone (§226)", () => {
  it("utilitaire : un item `zoneEffects` n'a rien à résoudre, un autre pose ses effets", () => {
    expect(readUsage(messageOf(activityOf("silence", "utility")))).toBeNull();
    expect(readUsage(messageOf(activityOf("sans-zone", "utility")))?.plan.effects.map(e => e.id)).toEqual([effect._id]);
  });
  it("sauvegarde, dégâts, soin : le plan reste, sans effets sur les cibles", () => {
    const save = { save: { ability: new Set(["con"]), dc: { value: 15 } }, damage: { parts: [{ number: 2, denomination: 10 }] } };
    const damage = { damage: { parts: [{ number: 2, denomination: 10 }] } };
    const heal = { healing: { formula: "1d8" } };
    for ( const [type, extra] of [["save", save], ["damage", damage], ["heal", heal]] ) {
      expect(readUsage(messageOf(activityOf("silence", type, extra)))?.plan.effects, type).toEqual([]);
      expect(readUsage(messageOf(activityOf("sans-zone", type, extra)))?.plan.effects.map(e => e.id), type).toEqual([effect._id]);
    }
  });
});
