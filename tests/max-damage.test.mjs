import { describe, it, expect } from "vitest";
import { validateEntry, WEAPON_KINDS } from "../module/scripts/core/content.mjs";
import { maximizeDice } from "../module/scripts/core/max-dice.mjs";

const v = entry => validateEntry(entry, { facts: {} });

describe("§279 : dégâts maximaux et types de dégâts d'une arme", () => {
  it("maxDamage : activité, genres d'arme, remboursement sur un coup", () => {
    expect(v({ maxDamage: { activity: "essaiActivite001" } })).toEqual([]);
    expect(v({ maxDamage: { activity: "essaiActivite001", weapons: ["unarmed", "simpleM", "improv"], refundOnHit: true } })).toEqual([]);
    expect(v({ maxDamage: { activity: "court" } })[0]).toMatch(/maxDamage/);
    expect(v({ maxDamage: { activity: "essaiActivite001", weapons: ["fists"] } })[0]).toMatch(/maxDamage/);
  });

  it("maxNextHit et weaponDamageTypes", () => {
    expect(v({ maxNextHit: true })).toEqual([]);
    expect(v({ maxNextHit: "yes" })[0]).toMatch(/maxNextHit/);
    expect(v({ weaponDamageTypes: { weapons: ["unarmed", "improv"], types: ["force"] } })).toEqual([]);
    expect(v({ weaponDamageTypes: { weapons: [], types: ["force"] } })[0]).toMatch(/weaponDamageTypes/);
    expect(WEAPON_KINDS).toContain("unarmed");
  });

  it("le maximum des dés d'un jet d'arme : les dés seulement, le bonus reste", () => {
    expect(maximizeDice("1d8 + @mod")).toBe("(1*8) + @mod");
    expect(maximizeDice("2d6r1")).toBe("(2*6)");
  });
});
