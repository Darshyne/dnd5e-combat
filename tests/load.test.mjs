/**
 * Chargement du module entier hors de Foundry, avec des globals factices : attrape un import ou
 * un export cassé (ce que les tests du cœur ne voient pas), et vérifie le contrat du routeur —
 * un seul écouteur par hook de Foundry, quel que soit le nombre de fonctionnalités inscrites.
 */
import { describe, it, expect, beforeAll } from "vitest";

const hooks = {};
const once = {};
const api = {};

beforeAll(async () => {
  const same = fn => fn;
  globalThis.Hooks = { on: (h, f) => (hooks[h] ??= []).push(f), once: (h, f) => (once[h] ??= []).push(f), callAll() {} };
  globalThis.foundry = { utils: { throttle: same, debounce: same, isNewerVersion: () => false } };
  globalThis.game = {
    modules: { get: id => (id === "dnd5e-combat" ? api : null) },
    system: { version: "6.0.3" }, settings: { register() {}, get() { return undefined; } }, users: {}
  };
  globalThis.CONFIG = { queries: {}, DND5E: { statusEffects: {} } };
  await import("../module/scripts/dnd5e-combat.mjs");
  once.init.forEach(fn => fn());
});

describe("chargement du module", () => {
  it("se charge et s'active sans Midi-QOL", () => {
    expect(api.api.active).toBe(true);
    expect(api.api.reason).toBe(null);
  });

  it("expose ses fonctions de test au connecteur sous api.mcp (call-module-api), et elles seules", () => {
    expect(Object.keys(api.api.mcp).sort()).toEqual(["actionEnd", "advanceTime", "animations", "attackReasons", "budget", "burning",
      "chatCards", "climb", "climbCeiling", "climbDown", "climbHolds", "climbState", "climbToward", "closeWindow", "controls",
      "cover", "dash", "diagnosticBackups", "diagnosticForget", "diagnosticRepair", "diagnosticRestore", "diagnosticScan",
      "door", "dropDown", "effectOrigins", "enchant", "endings", "etherealWalls", "factions", "familiar", "familiarPocket", "familiarRecall",
      "flammable", "follow", "followState", "grab", "heal", "hoist", "hurt", "identify", "inventory", "issues", "jump",
      "lightState", "masteries", "move", "movement", "naturalOne", "overrideContent", "perceived", "perf", "placeRegionAt",
      "plan", "planning", "portent", "rawMove", "reachCheck", "ready", "reload", "reports", "restoreItem", "rollCard",
      "rollCheck", "rollSave", "runMacro", "saveChance", "scatter", "sees", "sequencer", "setting", "skillAid", "skillAids",
      "stairs", "stairsAt", "stats", "status", "stealth", "storm", "stormStrike", "summonAt", "takeStairs", "teleport",
      "teleportPick", "threats", "toggleLight", "transpose", "unfollow", "use", "view", "wall", "wallSide", "windows"]);
    expect(Object.isFrozen(api.api.mcp)).toBe(true);
  });

  it("§196 : publie l'escalade (api.climb) et l'écart en trois dimensions (api.gap) pour les voisins", () => {
    expect(Object.keys(api.api.climb).sort()).toEqual(["ceiling", "down", "drop", "edges", "enabled", "entries", "grab", "holds", "run", "setEnabled", "state", "toward", "up"]);
    expect(Object.isFrozen(api.api.climb)).toBe(true);
    expect(typeof api.api.gap).toBe("function");
    expect(api.api.gap(null, null)).toBe(null);
    expect(api.api.climb.state(null)).toBe(null);
    expect(api.api.climb.holds(null, { i: 0, j: 0 })).toBe(true);
  });

  it("ne branche qu'un écouteur par hook de Foundry", () => {
    for ( const [hook, listeners] of Object.entries(hooks) ) expect(listeners, hook).toHaveLength(1);
  });

  it("aucune fonctionnalité ne s'inscrit par Hooks.once : seul le point d'entrée (un écouteur par hook)", () => {
    for ( const [hook, listeners] of Object.entries(once) ) expect(listeners, hook).toHaveLength(1);
  });

  it("appelle les inscrits de createChatMessage dans l'ordre voulu : résolution d'abord", () => {
    expect(api.api.routes().createChatMessage.map(r => r.label)).toEqual([
      "resolution interrupted", "concentration: processing interrupted", "pool: recharge not written", "targets released", "Flurry of Blows: targeting not opened",
      "budget: spending not recorded", "Dispel Magic: nothing dispelled", "trace or mark not handled", "weapon mastery: mark not used up", "maneuver: Bait and Switch or Commander's Strike not played", "Initiative d20 not rerolled", "Rage: upkeep not recorded", "swallow / engulf: action not tracked", "fall damage not applied", "Ready: \"attacks / casts a spell\" trigger not checked", "help", "tether: not recorded", "single card: roll not folded", "chat log purge", "visual feedback: effect ending"
    ]);
  });

  it("relance d'abord (§16.21), puis la visée (ui), l'utilisation sans fenêtre (§68), la Métamagie, la légalité (runtime), les portes, sur dnd5e.preUseActivity", () => {
    expect(api.api.routes()["dnd5e.preUseActivity"].map(r => r.label)).toEqual([
      "recast of a lasting spell", "targeting: target expected", "projectiles: one per target, the rest chained", "use without dialog", "metamagic: spell not modified", "use legality", "gates: Sanctuary, Counterspell, pre-attack reactions, Portent", "summon on targets: neighbours asked", "Ritual: cast without a spell slot", "self area: without the \"Place Template\" box", "Sneak Attack: item activity not redirected", "Reckless Attack: prompt",
      "swallow: Bite not refused", "potion: concentration not removed", "ground item: area placed on use, copy kept", "light object: placed on cast", "light source: dnd5e consumption not skipped"
    ]);
  });

  it("déclare annulables les hooks `pre…` du système et du cœur, `dnd5e.teleport`, `dnd5e.createMeasuredTemplate` (§190) et `dropCanvasData` (appelés par Hooks.call, board.mjs:2490), et eux seuls", () => {
    const cancellable = Object.entries(api.api.routes()).filter(([, rs]) => rs.some(r => r.cancellable)).map(([h]) => h).sort();
    expect(cancellable).toEqual(["dnd5e.createMeasuredTemplate", "dnd5e.postAttackRollConfiguration", "dnd5e.preCreateMeasuredTemplate", "dnd5e.preDisplayCardV2", "dnd5e.preRollAttackV2", "dnd5e.preRollConcentrationV2", "dnd5e.preRollDamageV2", "dnd5e.preSummon", "dnd5e.preUseActivity", "dnd5e.teleport", "dropCanvasData", "preCreateActiveEffect", "preCreateItem", "preMoveToken", "preUpdateActiveEffect", "preUpdateActor", "preUpdateItem", "preUpdateToken"]);
  });

  it("enregistre les requêtes entre clients", () => {
    expect(Object.keys(CONFIG.queries).sort()).toEqual([
      "dnd5e-combat.actionEnd", "dnd5e-combat.allocation", "dnd5e-combat.choice", "dnd5e-combat.climbCheck", "dnd5e-combat.concentration", "dnd5e-combat.contest", "dnd5e-combat.criticalTable", "dnd5e-combat.cure", "dnd5e-combat.deathSave", "dnd5e-combat.dismissSummon", "dnd5e-combat.enchant", "dnd5e-combat.extinguish", "dnd5e-combat.familiarPocket", "dnd5e-combat.familiarRecall", "dnd5e-combat.flipWallSide", "dnd5e-combat.ignite", "dnd5e-combat.improvised", "dnd5e-combat.masteryWindow", "dnd5e-combat.moveZone", "dnd5e-combat.opportunity", "dnd5e-combat.pickUp", "dnd5e-combat.portent", "dnd5e-combat.reaction", "dnd5e-combat.revertForm", "dnd5e-combat.rollSave", "dnd5e-combat.search", "dnd5e-combat.setTargets", "dnd5e-combat.skillAid", "dnd5e-combat.stabilize", "dnd5e-combat.toppleSave", "dnd5e-combat.transform", "dnd5e-combat.wake"
    ]);
  });
});
