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
    system: { version: "6.0.3" }, settings: { register() {} }, users: {}
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
    expect(Object.keys(api.api.mcp).sort()).toEqual(["actionEnd", "animations", "attackReasons", "budget", "chatCards", "closeWindow", "dash", "effectOrigins", "enchant", "endings", "familiar", "familiarPocket", "familiarRecall", "follow", "followState", "heal", "hurt", "identify", "inventory", "issues", "move", "movement", "naturalOne", "overrideContent", "perceived", "perf", "placeRegionAt", "plan", "planning", "portent", "reload", "reports", "restoreItem", "rollCard", "rollCheck", "rollSave", "runMacro", "saveChance", "sequencer", "setting", "skillAid", "skillAids", "stairs", "stairsAt", "stats", "status", "storm", "stormStrike", "summonAt", "takeStairs", "teleport", "teleportPick", "threats", "transpose", "unfollow", "use", "view", "windows"]);
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
      "résolution interrompue", "concentration : traitement interrompu", "réserve : recharge non écrite", "cibles relâchées", "Déluge de coups : visée non ouverte",
      "budget : dépense non consignée", "Dissipation de la magie : rien dissipé", "trace ou marque non traitée", "botte d'arme : marque non consommée", "manœuvre : Chassé-croisé ou Frappe commandée non joués", "Rage : entretien non noté", "avaler / engloutir : action non suivie", "soutien", "lien : non noté", "carte unique : jet non replié", "purge du journal", "retour visuel : effet qui cesse"
    ]);
  });

  it("relance d'abord (§16.21), puis la visée (ui), l'utilisation sans fenêtre (§68), la Métamagie, la légalité (runtime), les portes, sur dnd5e.preUseActivity", () => {
    expect(api.api.routes()["dnd5e.preUseActivity"].map(r => r.label)).toEqual([
      "relance d'un sort qui dure", "visée : cible attendue", "projectiles : un par cible, le reste enchaîné", "utilisation sans fenêtre", "métamagie : sort non modifié", "légalité de l'utilisation", "portes : Sanctuaire, Contresort, réactions avant l'attaque, Présage", "zone sur soi : sans case « Placer le gabarit »", "Témérité : question",
      "avaler : Morsure non refusée", "potion : concentration non retirée", "objet lumineux : placé au lancement"
    ]);
  });

  it("déclare annulables les hooks `pre…` du système et du cœur, et `dnd5e.teleport` (appelé par Hooks.call), et eux seuls", () => {
    const cancellable = Object.entries(api.api.routes()).filter(([, rs]) => rs.some(r => r.cancellable)).map(([h]) => h).sort();
    expect(cancellable).toEqual(["dnd5e.postAttackRollConfiguration", "dnd5e.preCreateMeasuredTemplate", "dnd5e.preRollAttackV2", "dnd5e.preRollDamageV2", "dnd5e.preUseActivity", "dnd5e.teleport", "preCreateActiveEffect", "preCreateItem", "preMoveToken", "preUpdateActiveEffect", "preUpdateItem", "preUpdateToken"]);
  });

  it("enregistre les requêtes entre clients", () => {
    expect(Object.keys(CONFIG.queries).sort()).toEqual([
      "dnd5e-combat.actionEnd", "dnd5e-combat.allocation", "dnd5e-combat.choice", "dnd5e-combat.contest", "dnd5e-combat.cure", "dnd5e-combat.deathSave", "dnd5e-combat.dismissSummon", "dnd5e-combat.enchant", "dnd5e-combat.extinguish", "dnd5e-combat.familiarPocket", "dnd5e-combat.familiarRecall", "dnd5e-combat.moveZone", "dnd5e-combat.opportunity", "dnd5e-combat.portent", "dnd5e-combat.reaction", "dnd5e-combat.revertForm", "dnd5e-combat.rollSave", "dnd5e-combat.search", "dnd5e-combat.setTargets", "dnd5e-combat.skillAid", "dnd5e-combat.stabilize", "dnd5e-combat.transform"
    ]);
  });
});
