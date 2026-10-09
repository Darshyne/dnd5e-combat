import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LEVELS, DEFAULT_LEVEL, atLeast, levelRank, featureLevel, FEATURE_LEVELS } from "../module/scripts/core/levels.mjs";
import { createRouter } from "../module/scripts/runtime/router.mjs";

const entry = readFileSync(new URL("../module/scripts/dnd5e-combat.mjs", import.meta.url), "utf8");

describe("niveaux d'automatisation (§117)", () => {
  it("trois niveaux ordonnés, Intégral par défaut", () => {
    expect(LEVELS).toEqual(["essentials", "assisted", "full"]);
    expect(DEFAULT_LEVEL).toBe("full");
    expect(atLeast("full", "assisted")).toBe(true);
    expect(atLeast("assisted", "full")).toBe(false);
    expect(atLeast("essentials", "essentials")).toBe(true);
    expect(levelRank("inconnu")).toBe(levelRank("full"));
  });

  it("chaque fonction du point d'entrée passe par gated() et a son niveau dans la table", () => {
    const raw = Array.from(entry.matchAll(/^\s*(register[A-Z]\w*)\(\);/gm), m => m[1]).filter(n => n !== "registerLevel");
    expect(raw, "appelées sans gated()").toEqual([]);
    const gatedNames = Array.from(entry.matchAll(/gated\((register[A-Z]\w*)\)/g), m => m[1]);
    expect(gatedNames.length).toBeGreaterThan(90);
    expect(gatedNames.filter(n => !(n in FEATURE_LEVELS)), "absentes de FEATURE_LEVELS").toEqual([]);
    expect(Object.keys(FEATURE_LEVELS).filter(n => !gatedNames.includes(n)), "dans la table mais pas au point d'entrée").toEqual([]);
  });

  it("le niveau est déclaré avant toute autre fonction", () => {
    const init = entry.slice(entry.indexOf("Hooks.once(\"init\""));
    expect(init.indexOf("registerLevel()")).toBeGreaterThan(0);
    expect(init.indexOf("registerLevel()")).toBeLessThan(init.indexOf("gated("));
  });

  it("le socle de l'interface est au niveau Essentiel, la résolution à Assisté, le contenu à Intégral", () => {
    for ( const n of ["registerActions", "registerPointer", "registerTurn", "registerVision", "registerTracker"] ) expect(featureLevel(n), n).toBe("essentials");
    for ( const n of ["registerEngine", "registerConditions", "registerConcentration", "registerDeath"] ) expect(featureLevel(n), n).toBe("assisted");
    for ( const n of ["registerAuras", "registerSneak", "registerSmite", "registerWildShape"] ) expect(featureLevel(n), n).toBe("full");
    expect(featureLevel("registerInconnue")).toBe("full");
  });
});

describe("routeur : withoutRoutes", () => {
  it("une fonction lancée sans ses écoutes ne branche rien, et ce qu'elle a demandé se lit", () => {
    const subscribed = [];
    const router = createRouter({ subscribe: hook => subscribed.push(hook), isExecutor: () => true, report: () => {} });
    let ran = false;
    router.withoutRoutes("registerAuras", () => { ran = true; router.on("updateToken", () => {}, { label: "auras" }); });
    router.on("createToken", () => {}, { label: "autre" });
    expect(ran).toBe(true);
    expect(subscribed).toEqual(["createToken"]);
    expect(router.skipped()).toEqual([{ hook: "updateToken", label: "auras", feature: "registerAuras" }]);
    expect(Object.keys(router.describe())).toEqual(["createToken"]);
  });

  it("après withoutRoutes, les inscriptions reprennent normalement, même si la fonction a levé une erreur", () => {
    const subscribed = [];
    const router = createRouter({ subscribe: hook => subscribed.push(hook), isExecutor: () => true, report: () => {} });
    expect(() => router.withoutRoutes("x", () => { throw new Error("boom"); })).toThrow("boom");
    router.on("ready", () => {});
    expect(subscribed).toEqual(["ready"]);
  });
});
