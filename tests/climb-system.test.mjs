import { describe, it, expect, afterEach } from "vitest";
import { climbSystemOn, setClimbSystemState, whileClimbSystem } from "../module/scripts/core/climb-system.mjs";
import { SETTINGS_TABS } from "../module/scripts/core/settings-layout.mjs";
import { FEATURE_LEVELS } from "../module/scripts/core/levels.mjs";

describe("§224 : interrupteur du système d'escalade et de chute", () => {
  afterEach(() => setClimbSystemState(true));

  it("allumé par défaut ; seul `false` le coupe", () => {
    expect(climbSystemOn()).toBe(true);
    setClimbSystemState(false);
    expect(climbSystemOn()).toBe(false);
    setClimbSystemState(undefined);
    expect(climbSystemOn()).toBe(true);
  });

  it("coupé : aucune entrée proposée, et rien n'est calculé", () => {
    setClimbSystemState(false);
    let called = 0;
    const entries = whileClimbSystem(() => { called++; return [{ label: "Grimper au mur" }]; });
    expect(entries).toEqual([]);
    expect(called).toBe(0);
  });

  it("allumé : les entrées telles quelles ; l'état peut être passé explicitement", () => {
    expect(whileClimbSystem(() => ["a", "b"])).toEqual(["a", "b"]);
    expect(whileClimbSystem(() => ["a"], false)).toEqual([]);
    setClimbSystemState(false);
    expect(whileClimbSystem(() => ["a"], true)).toEqual(["a"]);
  });

  it("les deux réglages sont en tête de l'onglet Déplacement, et l'interrupteur existe à tout niveau d'automatisation", () => {
    const movement = SETTINGS_TABS.find(t => t.id === "movement");
    expect(movement.keys.slice(0, 3)).toEqual(["climbSystem", "climbSystemButton", "altitude"]);
    expect(FEATURE_LEVELS.registerClimbSystem).toBe("essentials");
  });
});
