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

describe("§291 : une seule fenêtre pour la suite DAS", async () => {
  const { isSuiteTitle, shortTitle, orderModules } = await import("../module/scripts/core/settings-layout.mjs");

  it("un module de la suite se reconnaît à son titre public « DAS · … »", () => {
    expect(isSuiteTitle("DAS · Combat UI")).toBe(true);
    expect(isSuiteTitle("DAS·Loot & Trade")).toBe(true);
    expect(isSuiteTitle("Dice So Nice")).toBe(false);
    expect(isSuiteTitle("DASH · Something")).toBe(false);
    expect(isSuiteTitle(undefined)).toBe(false);
  });

  it("l'onglet porte le nom court", () => {
    expect(shortTitle("DAS · Shadows & Ambience")).toBe("Shadows & Ambience");
    expect(shortTitle("Autre module")).toBe("Autre module");
  });

  it("le moteur d'abord, puis par nom", () => {
    const order = orderModules([{ id: "b", title: "Loot" }, { id: "core", title: "Core" }, { id: "a", title: "Animations" }], "core");
    expect(order.map(m => m.id)).toEqual(["core", "a", "b"]);
  });
});

describe("§291 : un atelier à la fin", async () => {
  const { orderModules, validateWindow } = await import("../module/scripts/core/settings-layout.mjs");

  it("un module qui demande la fin passe après les autres, le moteur reste premier", () => {
    const order = orderModules([{ id: "hb", title: "Homebrew", end: true }, { id: "z", title: "Zeta" }, { id: "core", title: "Core" }, { id: "a", title: "Animations" }], "core");
    expect(order.map(m => m.id)).toEqual(["core", "a", "z", "hb"]);
  });

  it("l'onglet se déclare : objet, `kind` settings ou workshop", () => {
    const tabs = [{ id: "w", keys: [] }];
    expect(validateWindow({ namespace: "x", tabs, tab: { end: true, kind: "workshop", icon: "fa-solid fa-flask" } })).toEqual([]);
    expect(validateWindow({ namespace: "x", tabs, tab: "fin" })).toEqual(["tab: object expected"]);
    expect(validateWindow({ namespace: "x", tabs, tab: { kind: "atelier" } })).toEqual(["tab.kind: \"settings\" or \"workshop\" expected"]);
  });
});
