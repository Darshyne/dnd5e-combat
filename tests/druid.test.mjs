import { describe, it, expect } from "vitest";
import { holds } from "../module/scripts/core/triggers.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

/** Les faits d'un attaquant, métamorphosé ou non, avec ou sans Fureur élémentaire améliorée. */
const facts = ({ shaped=false, weapon=false, attack=true, improved=false }={}) => ({
  "source.wildShaped": want => (shaped === want),
  "activity.isWeapon": weapon,
  "activity.isAttack": attack,
  "source.hasFeature": id => improved && (id === "improved-elemental-fury")
});

describe("§30 Druide : conditions du contenu", () => {
  it("Forme lunaire : seulement une attaque sous Forme sauvage", () => {
    const [d] = CONTENT["lunar-form"].triggers;
    expect(holds(d.if, facts({ shaped: true }))).toBe(true);
    expect(holds(d.if, facts({ shaped: false, weapon: true }))).toBe(false);
    expect(holds(d.if, facts({ shaped: true, attack: false }))).toBe(false);
    expect(d.do[0]).toMatchObject({ formula: "2d10", damageType: "radiant" });
  });
  it("Attaques primitives : une arme, ou une attaque de Bête ; 1d8, 2d8 une fois améliorées", () => {
    const [basic, improved] = CONTENT["elemental-fury"].triggers;
    expect(holds(basic.if, facts({ weapon: true }))).toBe(true);
    expect(holds(basic.if, facts({ shaped: true }))).toBe(true);
    expect(holds(basic.if, facts({}))).toBe(false);   // un sort, sans Forme sauvage
    expect(holds(basic.if, facts({ weapon: true, improved: true }))).toBe(false);
    expect(holds(improved.if, facts({ weapon: true, improved: true }))).toBe(true);
    expect([basic.do[0].formula, improved.do[0].formula]).toEqual(["1d8", "2d8"]);
  });
  it("Foulée sélène : téléportation, trace, Avantage consommé, fin de tour", () => {
    const e = CONTENT["moonlight-step"];
    expect(e.teleport).toMatchObject({ distance: 30, units: "ft" });
    expect(e.trace.activity).toBe("dnd5eactivity000");
    expect(e.triggers.map(t => t.on)).toEqual(["preAttackRoll", "endOfTurn"]);
  });
});
