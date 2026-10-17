import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, placeSettings, matchesQuery, validateWindow } from "../module/scripts/core/settings-layout.mjs";

describe("plan de la fenêtre de réglages", () => {
  it("chaque réglage n'est rangé qu'une fois", () => {
    const keys = SETTINGS_TABS.flatMap(t => t.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("les onglets ont un id unique et une icône", () => {
    expect(new Set(SETTINGS_TABS.map(t => t.id)).size).toBe(SETTINGS_TABS.length);
    for ( const t of SETTINGS_TABS ) expect(t.icon).toMatch(/^fa-/);
  });
  it("un réglage non rangé tombe dans le dernier onglet, un réglage absent n'apparaît pas", () => {
    const tabs = placeSettings(["cover", "nouveauReglage"]);
    expect(tabs.find(t => t.id === "combat").keys).toEqual(["cover"]);
    expect(tabs.at(-1).keys).toEqual(["nouveauReglage"]);
    expect(tabs.find(t => t.id === "general").keys).toEqual([]);
  });
  it("la recherche ignore la casse et les accents", () => {
    expect(matchesQuery("lumiere", "Indicateur de lumière")).toBe(true);
    expect(matchesQuery("FURTIV", "Règles de Furtivité")).toBe(true);
    expect(matchesQuery("abri", "Cônes de vision")).toBe(false);
    expect(matchesQuery("", "n'importe quoi")).toBe(true);
  });
  it("un plan voisin : ses onglets gardent leurs champs, ses réglages non rangés tombent dans son dernier onglet", () => {
    const tabs = [{ id: "a", label: "X.A", keys: ["one"] }, { id: "b", label: "X.B", keys: ["two"] }];
    const placed = placeSettings(["two", "one", "loose"], tabs);
    expect(placed.map(t => [t.id, t.label, t.keys])).toEqual([["a", "X.A", ["one"]], ["b", "X.B", ["two", "loose"]]]);
    expect(placed[0].tools).toEqual([]);
  });
  it("la déclaration d'un module voisin est vérifiée", () => {
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: ["k"], tools: [{ id: "t", open: () => null }] }] })).toEqual([]);
    expect(validateWindow({ namespace: "", tabs: [] }).length).toBe(2);
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: "k" }, { id: "a", keys: [] }] }).length).toBe(2);
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: [], tools: [{ id: "t" }] }] }).length).toBe(1);
  });
});
