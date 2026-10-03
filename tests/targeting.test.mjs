import { describe, it, expect } from "vitest";
import { targetRule, targetRefusal, relationOf } from "../module/scripts/core/targeting.mjs";

const rule = (affects, more={}) => targetRule({ type: "utility", affects, rangeUnits: "touch", ...more });

describe("règle de visée", () => {
  it("une créature, une créature consentante, n'importe laquelle, un allié : le lanceur compris (Invisibilité)", () => {
    for ( const affects of ["creature", "willing", "any", "ally", "creatureOrObject"] ) expect(rule(affects).self).toBe(true);
  });
  it("un ennemi, un objet, une attaque : jamais soi-même", () => {
    expect(rule("enemy")).toEqual({ self: false, side: "enemy" });
    expect(rule("object").self).toBe(false);
    expect(targetRule({ type: "attack", affects: "creature", rangeUnits: "ft" })).toEqual({ self: false, side: null });
  });
  it("ne se vise pas d'un clic : zone, portée personnelle, espace, soi", () => {
    expect(rule("creature", { template: "sphere" })).toBe(null);
    expect(rule("creature", { rangeUnits: "self" })).toBe(null);
    expect(rule("space")).toBe(null);
    expect(rule("self")).toBe(null);
    expect(rule("")).toBe(null);
  });
});

describe("refus", () => {
  it("soi-même : selon la règle", () => {
    expect(targetRefusal(rule("creature"), { isSelf: true, relation: "same" })).toBe(null);
    expect(targetRefusal(rule("enemy"), { isSelf: true, relation: "same" })).toBe("self");
    expect(targetRefusal(targetRule({ type: "attack" }), { isSelf: true, relation: "same" })).toBe("self");
  });
  it("le camp : seulement quand il est déclaré des deux côtés", () => {
    expect(targetRefusal(rule("ally"), { isSelf: false, relation: "opposed" })).toBe("notAlly");
    expect(targetRefusal(rule("enemy"), { isSelf: false, relation: "same" })).toBe("notEnemy");
    expect(targetRefusal(rule("enemy"), { isSelf: false, relation: "neutral" })).toBe(null);
    expect(targetRefusal(rule("creature"), { isSelf: false, relation: "opposed" })).toBe(null);
  });
  it("relation entre dispositions : neutre et secret ne tranchent pas", () => {
    expect(relationOf(1, 1)).toBe("same");
    expect(relationOf(1, -1)).toBe("opposed");
    expect(relationOf(1, 0)).toBe("neutral");
    expect(relationOf(-2, -1)).toBe("neutral");
  });
});
