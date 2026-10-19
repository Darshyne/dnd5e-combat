import { describe, it, expect } from "vitest";
import { attackModifiers } from "../module/scripts/core/conditions.mjs";

describe("§214 formation au port d'armure", () => {
  const base = { attacker: [], target: [], adjacent: true, ranged: false };
  it("armure sans formation : Désavantage à l'attaque", () => {
    expect(attackModifiers({ ...base, untrainedArmor: true }).disadvantage).toContainEqual({ who: "situation", key: "untrainedArmor" });
  });
  it("formé : rien", () => {
    expect(attackModifiers({ ...base }).disadvantage).toEqual([]);
  });
});
