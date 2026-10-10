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
    expect(Object.keys(api.api.mcp).sort()).toEqual(["actionEnd", "advanceTime", "animations", "attackReasons", "budget", "chatCards", "closeWindow", "dash", "effectOrigins", "enchant", "endings", "familiar", "familiarPocket", "familiarRecall", "follow", "followState", "heal", "hurt", "identify", "inventory", "issues", "lightState", "move", "movement", "naturalOne", "overrideContent", "perceived", "perf", "placeRegionAt", "plan", "planning", "portent", "reload", "reports", "restoreItem", "rollCard", "rollCheck", "rollSave", "runMacro", "saveChance", "sequencer", "setting", "skillAid", "skillAids", "stairs", "stairsAt", "stats", "status", "storm", "stormStrike", "summonAt", "takeStairs", "teleport", "teleportPick", "threats", "toggleLight", "transpose", "unfollow", "use", "view", "windows"]);
    expect(Object.isFrozen(api.api.mcp)).toBe(true);
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
      "budget: spending not recorded", "Dispel Magic: nothing dispelled", "trace or mark not handled", "weapon mastery: mark not used up", "maneuver: Bait and Switch or Commander's Strike not played", "Initiative d20 not rerolled", "Rage: upkeep not recorded", "swallow / engulf: action not tracked", "help", "tether: not recorded", "single card: roll not folded", "chat log purge", "visual feedback: effect ending"
    ]);
  });

  it("relance d'abord (§16.21), puis la visée (ui), l'utilisation sans fenêtre (§68), la Métamagie, la légalité (runtime), les portes, sur dnd5e.preUseActivity", () => {
    expect(api.api.routes()["dnd5e.preUseActivity"].map(r => r.label)).toEqual([
      "recast of a lasting spell", "targeting: target expected", "projectiles: one per target, the rest chained", "use without dialog", "metamagic: spell not modified", "use legality", "gates: Sanctuary, Counterspell, pre-attack reactions, Portent", "summon on targets: neighbours asked", "self area: without the \"Place Template\" box", "Reckless Attack: prompt",
      "swallow: Bite not refused", "potion: concentration not removed", "light object: placed on cast", "light source: dnd5e consumption not skipped"
    ]);
  });

  it("déclare annulables les hooks `pre…` du système et du cœur, et `dnd5e.teleport` (appelé par Hooks.call), et eux seuls", () => {
    const cancellable = Object.entries(api.api.routes()).filter(([, rs]) => rs.some(r => r.cancellable)).map(([h]) => h).sort();
    expect(cancellable).toEqual(["dnd5e.postAttackRollConfiguration", "dnd5e.preCreateMeasuredTemplate", "dnd5e.preRollAttackV2", "dnd5e.preRollDamageV2", "dnd5e.preSummon", "dnd5e.preUseActivity", "dnd5e.teleport", "preCreateActiveEffect", "preCreateItem", "preMoveToken", "preUpdateActiveEffect", "preUpdateItem", "preUpdateToken"]);
  });

  it("enregistre les requêtes entre clients", () => {
    expect(Object.keys(CONFIG.queries).sort()).toEqual([
      "dnd5e-combat.actionEnd", "dnd5e-combat.allocation", "dnd5e-combat.choice", "dnd5e-combat.contest", "dnd5e-combat.cure", "dnd5e-combat.deathSave", "dnd5e-combat.dismissSummon", "dnd5e-combat.enchant", "dnd5e-combat.extinguish", "dnd5e-combat.familiarPocket", "dnd5e-combat.familiarRecall", "dnd5e-combat.moveZone", "dnd5e-combat.opportunity", "dnd5e-combat.portent", "dnd5e-combat.reaction", "dnd5e-combat.revertForm", "dnd5e-combat.rollSave", "dnd5e-combat.search", "dnd5e-combat.setTargets", "dnd5e-combat.skillAid", "dnd5e-combat.stabilize", "dnd5e-combat.transform"
    ]);
  });
});
