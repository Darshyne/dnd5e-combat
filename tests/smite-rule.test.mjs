import { describe, it, expect } from "vitest";
import { smiteRuleOf } from "../module/scripts/adapter/smite.mjs";

/** Une collection d'activités à la Foundry : get / find. */
const coll = list => ({ get: id => list.find(a => a.id === id), find: f => list.find(f) });
const dice = (n, d) => ({ parts: [{ number: n, denomination: d }] });

describe("règle d'un châtiment selon l'exemplaire du sort (§128)", () => {
  const rule = { damage: "M4KS57lcf4K6fUMU", effect: "A0tTvLeRetrC708K" };
  it("le sort du compendium : la règle telle quelle", () => {
    const item = { system: { activities: coll([{ id: "dnd5eactivity000", damage: dice(1, 6) }, { id: "M4KS57lcf4K6fUMU", damage: dice(1, 6) }]) } };
    expect(smiteRuleOf(item, rule)).toBe(rule);
  });
  it("la copie des pré-tirés (une sauvegarde qui porte les dés) : son activité, l'effet s'il y est", () => {
    const item = { system: { activities: coll([{ id: "dnd5eactivity000", damage: dice(1, 6) }]) },
      effects: { get: id => (id === "A0tTvLeRetrC708K" ? {} : undefined) } };
    expect(smiteRuleOf(item, rule)).toMatchObject({ damage: "dnd5eactivity000", effect: "A0tTvLeRetrC708K" });
  });
  it("aucune activité à dés : rien", () => {
    const item = { system: { activities: coll([{ id: "dnd5eactivity000", damage: { parts: [] } }]) }, effects: { get: () => undefined } };
    expect(smiteRuleOf(item, rule)).toBeNull();
  });
  it("la sauvegarde déclarée n'est pas prise pour les dégâts", () => {
    const item = { system: { activities: coll([{ id: "save1", damage: dice(2, 6) }]) }, effects: { get: () => undefined } };
    expect(smiteRuleOf(item, { damage: "absent", save: "save1" })).toBeNull();
  });
});
