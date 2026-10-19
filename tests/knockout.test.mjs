import { describe, it, expect } from "vitest";
import { nonLethalAttackerOf, knockOutAtZero } from "../module/scripts/adapter/knockout.mjs";

// Un acteur, un message de dégâts et son activité, sans Foundry.
const actorWith = nonLethal => ({ name: "Guerrier", getFlag: (scope, key) => (key === "nonLethal" ? nonLethal : undefined) });
const options = ({ nonLethal=true, type="attack", range="melee", mode="" }={}) => {
  const activity = { type, actor: actorWith(nonLethal), attack: { type: { value: range } } };
  return { originatingMessage: { getAssociatedActivity: () => activity, rolls: [{ options: { attackMode: mode } }] } };
};
const target = hp => ({ system: { attributes: { hp: { value: hp, max: 20 } } } });

describe("assommer (§210)", () => {
  it("une attaque au corps à corps d'un acteur en coups non létaux", () => {
    expect(nonLethalAttackerOf(options())?.name).toBe("Guerrier");
    expect(nonLethalAttackerOf(options({ nonLethal: false }))).toBeNull();
    expect(nonLethalAttackerOf(options({ range: "ranged" }))).toBeNull();
    expect(nonLethalAttackerOf(options({ mode: "thrown" }))).toBeNull();     // une arme de mêlée lancée
    expect(nonLethalAttackerOf(options({ type: "save" }))).toBeNull();       // pas une attaque
  });
  it("des dégâts qui feraient tomber à 0 PV laissent à 1 PV ; sinon rien", () => {
    const updates = {};
    expect(knockOutAtZero(target(8), 12, updates, options())).toBe("Guerrier");
    expect(updates["system.attributes.hp.value"]).toBe(1);
    const none = {};
    expect(knockOutAtZero(target(8), 5, none, options())).toBeNull();          // ne tombe pas
    expect(knockOutAtZero(target(0), 5, none, options())).toBeNull();          // déjà à 0
    expect(knockOutAtZero(target(8), 12, none, options({ nonLethal: false }))).toBeNull();
    expect(none).toEqual({});
  });
});
