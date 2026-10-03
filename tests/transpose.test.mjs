import { describe, it, expect } from "vitest";
import { canTranspose } from "../module/scripts/core/pilot.mjs";

describe("§38.2 : Troc du filou", () => {
  const base = { inCombat: true, ownTurn: true, turnKey: "c.2.0", command: null, createdTurn: null, usedTurn: null };
  it("hors combat : toujours", () => {
    expect(canTranspose({ ...base, inCombat: false, ownTurn: false })).toBe(true);
  });
  it("en combat : l'illusion créée ou déplacée par une commande payée ce tour-ci", () => {
    expect(canTranspose(base)).toBe(false);
    expect(canTranspose({ ...base, createdTurn: "c.2.0" })).toBe(true);
    expect(canTranspose({ ...base, createdTurn: "c.1.0" })).toBe(false);
    expect(canTranspose({ ...base, command: { turn: "c.2.0", paid: true, move: true, used: 0 } })).toBe(true);
    expect(canTranspose({ ...base, command: { turn: "c.2.0", paid: true, move: false, used: 1 } })).toBe(false);
    expect(canTranspose({ ...base, command: { turn: "c.1.0", paid: true, move: true, used: 0 } })).toBe(false);
  });
  it("à son tour seulement, une fois par tour", () => {
    expect(canTranspose({ ...base, createdTurn: "c.2.0", ownTurn: false })).toBe(false);
    expect(canTranspose({ ...base, createdTurn: "c.2.0", usedTurn: "c.2.0" })).toBe(false);
    expect(canTranspose({ ...base, createdTurn: "c.2.0", usedTurn: "c.1.0" })).toBe(true);
  });
});