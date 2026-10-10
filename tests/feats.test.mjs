import { describe, it, expect } from "vitest";
import { twiceKeepHighest, rerollOnesOnce, swapPartners } from "../module/scripts/core/feats.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { eligibleReactions } from "../module/scripts/core/reaction.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

describe("§129 : Sauvagerie martiale", () => {
  it("chaque terme de dés lancé deux fois, le meilleur gardé ; le modificateur ne bouge pas", () => {
    expect(twiceKeepHighest("1d12 + @mod")).toBe("{1d12,1d12}kh + @mod");
    expect(twiceKeepHighest("2d6min3 + 3")).toBe("{2d6min3,2d6min3}kh + 3");
  });
});

describe("§129 : Guérisseur", () => {
  it("un 1 relancé une fois ; un terme qui relance déjà n'est pas touché", () => {
    expect(rerollOnesOnce("2d8 + @mod")).toBe("2d8r1 + @mod");
    expect(rerollOnesOnce("1d8r1 + @prof")).toBe("1d8r1 + @prof");
  });
});

describe("§129 : Vigilant", () => {
  const me = { id: "a", disposition: 1, initiative: 12 };
  it("les alliés du même camp qui ont leur initiative, ni Neutralisés ni à terre", () => {
    const others = [me, { id: "b", disposition: 1, initiative: 18 }, { id: "c", disposition: -1, initiative: 20 },
      { id: "d", disposition: 1, initiative: null }, { id: "e", disposition: 1, initiative: 5, incapacitated: true }];
    expect(swapPartners(me, others)).toEqual(["b"]);
  });
  it("Neutralisé : pas d'échange", () => {
    expect(swapPartners({ ...me, incapacitated: true }, [{ id: "b", disposition: 1, initiative: 18 }])).toEqual([]);
  });
});

describe("§129 : schéma", () => {
  it("les dons livrés se valident", () => {
    for ( const id of ["tavern-brawler", "savage-attacker", "lucky", "alert", "healer"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
  });
  it("faveur : poussée et mains nues", () => {
    expect(validateEntry({ hitRider: { push: { distance: 5, units: "ft" }, unarmed: true } })).toEqual([]);
    expect(validateEntry({ hitRider: { push: { distance: 0, units: "ft" } } }).length).toBe(1);
  });
  it("rollBonus.luck, et les clés vraies", () => {
    expect(validateEntry({ rollBonus: { activity: "DEX2YgxfqdMse2bT", on: ["attack"], luck: true } })).toEqual([]);
    expect(validateEntry({ savageAttacker: "oui" }).length).toBe(1);
  });
});

describe("§129 : une fenêtre `free` ne demande pas la Réaction", () => {
  const declared = [{ name: "Bouclier", on: ["isAttacked"] }, { name: "Chanceux", on: ["isAttacked"], free: true }];
  it("Réaction prise : seule la fenêtre libre reste", () => {
    expect(eligibleReactions(declared, "isAttacked", { reactionAvailable: false }).map(r => r.name)).toEqual(["Chanceux"]);
  });
  it("Neutralisé : rien", () => {
    expect(eligibleReactions(declared, "isAttacked", { reactionAvailable: true, incapacitated: true })).toEqual([]);
  });
});

describe("§129 : fusion", () => {
  it("les clés des dons survivent à la fusion du contenu livré", () => {
    expect(SHIPPED["savage-attacker"].savageAttacker).toBe(true);
    expect(SHIPPED["alert"].initiativeSwap).toBe(true);
    expect(SHIPPED["healer"].healingRerolls).toBe(true);
    expect(SHIPPED["lucky"].rollBonus.luck).toBe(true);
    expect(SHIPPED["tavern-brawler"].hitRider.push).toEqual({ distance: 5, units: "ft" });
  });
});

import { effectHolds, sameChanges } from "../module/scripts/core/feats.mjs";

describe("§130 : effets de don conditionnels", () => {
  const facts = (o={}) => ({ armor: null, weapons: [], inCombat: false, abilities: { dex: 14 }, ...o });
  it("Défense : seulement en armure", () => {
    const rule = SHIPPED["defense"].effectWhile.W0ObItz7sS8ZJ09Y.if;
    expect(effectHolds(rule, facts())).toBe(false);
    expect(effectHolds(rule, facts({ armor: "medium" }))).toBe(true);
  });
  it("Duel : une arme de corps à corps à une main, aucune autre", () => {
    const rule = SHIPPED["dueling"].effectWhile.VEodDUQvYPHhl0Ya.if;
    expect(effectHolds(rule, facts({ weapons: [{ melee: true, twoHanded: false }] }))).toBe(true);
    expect(effectHolds(rule, facts({ weapons: [{ melee: true, twoHanded: true }] }))).toBe(false);
    expect(effectHolds(rule, facts({ weapons: [{ melee: true, twoHanded: false }, { melee: true, twoHanded: false }] }))).toBe(false);
    expect(effectHolds(rule, facts({ weapons: [{ melee: false, twoHanded: false }] }))).toBe(false);
  });
  it("Maître des armures intermédiaires : armure intermédiaire et Dextérité 16", () => {
    const r = SHIPPED["medium-armor-master"].effectWhile.r6D3Ach1DcRanNcj;
    expect(effectHolds(r.if, facts({ armor: "medium", abilities: { dex: 16 } }))).toBe(true);
    expect(effectHolds(r.if, facts({ armor: "medium", abilities: { dex: 15 } }))).toBe(false);
    expect(sameChanges([{ key: "system.attributes.bonus", type: "add", value: 1 }], r.changes)).toBe(false);
    expect(sameChanges([{ key: "system.attributes.ac.bonus", type: "add", value: 1 }], r.changes)).toBe(true);
  });
  it("Rôdeur furtif : en combat", () => {
    expect(effectHolds(SHIPPED["skulker"].effectWhile["6moNnOl0izLMgVNl"].if, facts({ inCombat: true }))).toBe(true);
  });
  it("schéma", () => {
    for ( const id of ["defense", "dueling", "heavy-armor-master", "medium-armor-master", "skulker"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
    expect(validateEntry({ effectWhile: { W0ObItz7sS8ZJ09Y: { if: { armor: ["plate"] } } } }).length).toBe(1);
  });
});

import { rangedFeatsFor, coverLeft } from "../module/scripts/core/feats.mjs";

describe("§131 : dons de tir", () => {
  const ss = SHIPPED["sharpshooter"].rangedFeat, ce = SHIPPED["crossbow-expert"].rangedFeat, sp = SHIPPED["spell-sniper"].rangedFeat;
  const bow = { weapon: true, ranged: true, crossbow: false, spell: false };
  const handXbow = { weapon: true, ranged: true, crossbow: true, spell: false };
  const sword = { weapon: true, ranged: false, crossbow: false, spell: false };
  const bolt = { weapon: false, ranged: true, crossbow: false, spell: true };
  it("Tireur d'élite : arme à distance seulement", () => {
    expect(rangedFeatsFor([ss], bow)).toMatchObject({ cover: true, closeCombat: true, longRange: true });
    expect(rangedFeatsFor([ss], sword)).toMatchObject({ cover: false, closeCombat: false, longRange: false });
    expect(rangedFeatsFor([ss], bolt).cover).toBe(false);
  });
  it("Expert des arbalètes : arbalète seulement", () => {
    expect(rangedFeatsFor([ce], handXbow)).toMatchObject({ closeCombat: true, offhandModifier: true, longRange: false });
    expect(rangedFeatsFor([ce], bow).closeCombat).toBe(false);
  });
  it("Sniper de sorts : jets d'attaque de sort", () => {
    expect(rangedFeatsFor([sp], bolt)).toMatchObject({ cover: true, closeCombat: true, spellRange: { value: 60, units: "ft" } });
    expect(rangedFeatsFor([sp], bow).cover).toBe(false);
  });
  it("l'abri total reste", () => {
    expect(coverLeft({ degree: "half", bonus: 2 }, true)).toBeNull();
    expect(coverLeft({ degree: "threeQuarters", bonus: 5 }, true)).toBeNull();
    expect(coverLeft({ degree: "total", bonus: null }, true)).toEqual({ degree: "total", bonus: null });
    expect(coverLeft({ degree: "half", bonus: 2 }, false)).toEqual({ degree: "half", bonus: 2 });
  });
  it("schéma", () => {
    for ( const id of ["sharpshooter", "crossbow-expert", "spell-sniper"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
    expect(validateEntry({ rangedFeat: { kind: "bow" } }).length).toBe(1);
  });
});
