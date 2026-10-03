import { describe, it, expect } from "vitest";
import { canMoveArea, translateShapes, shapeCenter, expiryTime } from "../module/scripts/core/area.mjs";

describe("zone déplaçable (§16.14)", () => {
  it("pas au tour de la pose ; aux tours suivants, et hors combat, oui", () => {
    expect(canMoveArea({ turnKey: "2-1" }, "2-1")).toBe(false);
    expect(canMoveArea({ turnKey: "2-1" }, "3-1")).toBe(true);
    expect(canMoveArea({ turnKey: "hors-combat" }, "hors-combat")).toBe(true);
    expect(canMoveArea(null, "3-1")).toBe(false);
  });
  it("translate cercles, rectangles et polygones", () => {
    expect(translateShapes([{ type: "circle", x: 100, y: 200, radius: 70 }], 140, -140)).toEqual([{ type: "circle", x: 240, y: 60, radius: 70 }]);
    expect(translateShapes([{ type: "polygon", points: [0, 0, 10, 0, 10, 10] }], 5, 7)).toEqual([{ type: "polygon", points: [5, 7, 15, 7, 15, 17] }]);
  });
  it("centre d'une forme", () => {
    expect(shapeCenter({ type: "circle", x: 100, y: 200 })).toEqual({ x: 100, y: 200 });
    expect(shapeCenter({ type: "rectangle", x: 0, y: 0, width: 140, height: 280 })).toEqual({ x: 70, y: 140 });
    expect(shapeCenter({ type: "polygon", points: [0, 0, 20, 0, 20, 20, 0, 20] })).toEqual({ x: 10, y: 10 });
  });
});

import { stepsInside, actsOnPose, shouldTrigger as trig } from "../module/scripts/core/area.mjs";
describe("zone parcourue (§16.20, moves)", () => {
  it("compte les cases d'arrivée dans la zone", () => {
    expect(stepsInside([false, true, true, false])).toBe(2);
    expect(stepsInside([])).toBe(0);
  });
  it("n'agit pas à la pose si elle n'agit qu'au déplacement", () => {
    expect(actsOnPose(["moves"])).toBe(false);
    expect(actsOnPose(["enter", "turnEnd"])).toBe(true);
    expect(actsOnPose(null)).toBe(true);
  });
  it("chaque déplacement compte, sans limite par tour", () => {
    const area = { on: ["moves"], turnKey: "1-0", hit: ["t"] };
    expect(trig(area, { event: "moves", token: "t", turnKey: "1-0" })).toBe(true);
  });
});

describe("fin d'une zone qui dure sans concentration (§16.37)", () => {
  const minutesPer = { round: 0.1, turn: 0.1, minute: 1, hour: 60, day: 1440 };
  it("Lumière du jour : une heure après la pose", () => {
    expect(expiryTime(1000, { value: "1", units: "hour" }, minutesPer)).toBe(4600);
  });
  it("en rounds (6 s chacun)", () => {
    expect(expiryTime(0, { value: 10, units: "round" }, minutesPer)).toBe(60);
  });
  it("pas de fin pour une durée qui ne se compte pas", () => {
    expect(expiryTime(0, { value: "", units: "perm" }, minutesPer)).toBe(null);
    expect(expiryTime(0, { value: "1", units: "inst" }, minutesPer)).toBe(null);
    expect(expiryTime(0, { value: 0, units: "hour" }, minutesPer)).toBe(null);
  });
});
