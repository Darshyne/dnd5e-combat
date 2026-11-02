import { describe, it, expect } from "vitest";
import { dataFixPlan, planIsEmpty, matchesFrom, validateDataFixes } from "../module/scripts/core/data-fixes.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const ACT = "aaaaaaaaaaaaaaa1";
const FX = "bbbbbbbbbbbbbbb1";
const source = () => ({
  name: "Wand", system: {
    uses: { max: "", recovery: [], spent: 0 },
    activities: { [ACT]: { _id: ACT, activation: { type: "special", override: false }, consumption: { targets: [{ type: "activityUses", value: "2", target: "", scaling: { mode: "" } }] } } }
  },
  effects: [{ _id: FX, name: "Oops", transfer: true, disabled: true, system: { changes: [{ key: "system.traits.dr.value", value: "bludegoning", priority: null, type: "add" }] } }]
});

describe("corrections de la donnée premium (§335)", () => {
  it("corrige un champ d'activité, d'item et d'effet, et crée l'effet manquant", () => {
    const plan = dataFixPlan(source(), [
      { path: `system.activities.${ACT}.activation.type`, from: "special", value: "action" },
      { path: "system.uses.max", from: "", value: "7" },
      { effect: FX, path: "disabled", from: true, value: false },
      { effect: "ccccccccccccccc1", create: { name: "New", type: "base", transfer: true } }
    ]);
    expect(plan.item).toEqual({ [`system.activities.${ACT}.activation.type`]: "action", "system.uses.max": "7" });
    expect(plan.effects).toEqual([{ _id: FX, disabled: false }]);
    expect(plan.create).toEqual([{ name: "New", type: "base", transfer: true, _id: "ccccccccccccccc1" }]);
    expect(plan.fields).toHaveLength(4);
  });

  it("laisse une valeur modifiée à la main, une activité absente et ce qui est déjà juste", () => {
    const edited = source();
    edited.system.uses.max = "3";
    const plan = dataFixPlan(edited, [
      { path: "system.uses.max", from: "", value: "7" },
      { path: "system.activities.zzzzzzzzzzzzzzz1.activation.type", value: "action" },
      { path: `system.activities.${ACT}.activation.override`, value: false },
      { effect: FX, create: { name: "Already there" } }
    ]);
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("compare l'origine sur les seules clés déclarées (dnd5e complète la donnée)", () => {
    const plan = dataFixPlan(source(), [{ path: `system.activities.${ACT}.consumption.targets`,
      from: [{ type: "activityUses", value: "2" }], value: [{ type: "itemUses", value: "2", target: "", scaling: {} }] }]);
    expect(Object.keys(plan.item)).toEqual([`system.activities.${ACT}.consumption.targets`]);
    expect(matchesFrom([{ a: 1, b: 2 }], [{ a: 1 }])).toBe(true);
    expect(matchesFrom([{ a: 1 }, { a: 2 }], [{ a: 1 }])).toBe(false);
    expect(matchesFrom("", null)).toBe(false);
  });

  it("tient un champ nul non enregistré pour nul, et ajoute une activité entière", () => {
    const src = source();
    src.system.activities[ACT].spell = { challenge: { override: false } };
    const plan = dataFixPlan(src, [
      { path: `system.activities.${ACT}.spell.challenge`, from: { attack: null, save: null, override: false }, value: { attack: null, save: 18, override: true } },
      { path: "system.activities.dasReloadAction0", value: { _id: "dasReloadAction0", type: "utility" } }
    ]);
    expect(Object.keys(plan.item)).toEqual([`system.activities.${ACT}.spell.challenge`, "system.activities.dasReloadAction0"]);
    src.system.activities.dasReloadAction0 = { _id: "dasReloadAction0", type: "utility", name: "", activation: {} };
    expect(Object.keys(dataFixPlan(src, [{ path: "system.activities.dasReloadAction0", value: { _id: "dasReloadAction0", type: "utility" } }]).item)).toEqual([]);
  });

  it("réécrit en entier un tableau de changements", () => {
    const fixed = [{ key: "system.traits.dr.value", value: "bludgeoning", priority: null, type: "add" }];
    const plan = dataFixPlan(source(), [{ effect: FX, path: "system.changes",
      from: [{ key: "system.traits.dr.value", value: "bludegoning", priority: null, type: "add" }], value: fixed }]);
    expect(plan.effects).toEqual([{ _id: FX, "system.changes": fixed }]);
    // Appliqué une seconde fois : rien à faire.
    const after = source();
    after.effects[0].system.changes = fixed;
    expect(planIsEmpty(dataFixPlan(after, [{ effect: FX, path: "system.changes", value: fixed }]))).toBe(true);
  });

  it("valide la clé", () => {
    expect(validateDataFixes([{ path: "system.uses.max", value: "1" }])).toEqual([]);
    expect(validateDataFixes([{ effect: FX, create: { name: "x" } }])).toEqual([]);
    expect(validateDataFixes([{ path: "flags.x", value: 1 }])).toHaveLength(1);
    expect(validateDataFixes([{ effect: "short", path: "disabled", value: false }])).toHaveLength(1);
    expect(validateDataFixes([])).toHaveLength(1);
  });

  it("chaque correction livrée vise un id de 16 caractères et déclare son origine ou crée un effet", () => {
    for ( const [id, entry] of Object.entries(CONTENT) ) {
      for ( const fix of entry.dataFixes ?? [] ) {
        expect(validateDataFixes([fix]), id).toEqual([]);
        const activity = fix.path?.match(/^system\.activities\.([^.]+)/)?.[1];
        if ( activity ) expect(activity, id).toMatch(/^[A-Za-z0-9]{16}$/);
        const adds = /^system\.activities\.das[A-Za-z0-9]{13}$/.test(fix.path ?? "");
        expect(("from" in fix) || ("create" in fix) || adds, `${id} ${fix.path}`).toBe(true);
      }
    }
  });
});
