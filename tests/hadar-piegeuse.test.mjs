/** §80 : Faim de Hadar (une activité sœur par moment de zone) et Frappe piégeuse (dégâts au début du tour de l'entravée). */
import { describe, it, expect } from "vitest";
import { siblingFor, hitKey, siblingsByMoment, shouldTrigger, markHit, openArea } from "../module/scripts/core/area.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("une activité sœur par moment", () => {
  it("siblingsByMoment : seulement quand elles diffèrent", () => {
    expect(siblingsByMoment([{ on: ["turnStart"], activity: "cold" }, { on: ["turnEnd"], activity: "acid" }])).toEqual({ turnStart: "cold", turnEnd: "acid" });
    expect(siblingsByMoment([{ on: ["enter", "turnEnd"], activity: "save" }])).toBeNull();   // Cordon de flèches
    expect(siblingsByMoment([{ on: ["enter", "turnEnd"], activity: null }])).toBeNull();     // Rayon de lune
  });
  it("siblingFor : celle du moment, sinon la seule", () => {
    const hadar = { activity: "acid", activities: { turnStart: "cold", turnEnd: "acid" } };
    expect(siblingFor(hadar, "turnStart")).toBe("cold");
    expect(siblingFor(hadar, "turnEnd")).toBe("acid");
    expect(siblingFor({ activity: "save" }, "enter")).toBe("save");
    expect(siblingFor({ activity: null }, "enter")).toBeNull();
  });
  it("le froid du début du tour n'empêche pas l'acide de la fin, chacun une fois par tour", () => {
    const area = { ...openArea(["turnStart", "turnEnd"], "1-0"), activities: { turnStart: "cold", turnEnd: "acid" } };
    const at = event => ({ event, token: hitKey(area, event, "T"), turnKey: "1-0" });
    const afterStart = { ...area, ...markHit(area, at("turnStart")) };
    expect(shouldTrigger(afterStart, at("turnEnd"))).toBe(true);
    expect(shouldTrigger(afterStart, at("turnStart"))).toBe(false);
  });
  it("une zone à une seule activité garde « une fois par tour » (Rayon de lune)", () => {
    const area = openArea(["enter", "turnEnd"], "1-0");
    const ctx = event => ({ event, token: hitKey(area, event, "T"), turnKey: "1-0" });
    const after = { ...area, ...markHit(area, ctx("enter")) };
    expect(shouldTrigger(after, ctx("turnEnd"))).toBe(false);
  });
});

describe("contenu", () => {
  it("Faim de Hadar", () => {
    expect(CONTENT["hunger-of-hadar"].triggers).toEqual([
      { on: "turnStart", do: [{ type: "replay", activity: "G6bH5mBR3kkEYjYe" }] },
      { on: "turnEnd", do: [{ type: "replay", activity: "FGDyvqQz5JQQc5mf" }] }
    ]);
    expect(validateEntry(CONTENT["hunger-of-hadar"])).toEqual([]);
  });
  it("Frappe piégeuse : dégâts au début du tour, et l'évasion par un autre reste", () => {
    expect(CONTENT["ensnaring-strike"].triggers).toEqual([{ on: "startOfTurn", via: "effect", fromEffect: "tFGMG3cjQTEeAhv2",
      do: [{ type: "damage", to: "bearer", activity: "ZWId9mbOE9zFnP6f" }] }]);
    expect(CONTENT["ensnaring-strike"].actionEnds).toEqual({ tFGMG3cjQTEeAhv2: { by: "other", roll: "check" } });
    expect(validateEntry(CONTENT["ensnaring-strike"])).toEqual([]);
  });
});
