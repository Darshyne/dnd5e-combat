import { describe, it, expect } from "vitest";
import { flanks, crossesOpposite, touchesBox, cellCenters, flankingApplies } from "../module/scripts/core/flanking.mjs";
import { attackModifiers, netMode } from "../module/scripts/core/conditions.mjs";

// Espaces en cases : la cible Moyenne occupe la case (5, 5).
const at = (x, y, w=1, h=1) => ({ x, y, w, h });
const target = at(5, 5);

describe("prise en tenaille : géométrie (grille carrée)", () => {
  it("de part et d'autre, côtés opposés : gauche / droite, haut / bas", () => {
    expect(flanks(target, at(4, 5), at(6, 5))).toBe(true);
    expect(flanks(target, at(5, 4), at(5, 6))).toBe(true);
  });
  it("coins opposés", () => {
    expect(flanks(target, at(4, 4), at(6, 6))).toBe(true);
    expect(flanks(target, at(6, 4), at(4, 6))).toBe(true);
  });
  it("côtés adjacents, ou côte à côte : pas de tenaille", () => {
    expect(flanks(target, at(4, 5), at(5, 4))).toBe(false);   // gauche + haut
    expect(flanks(target, at(4, 5), at(4, 4))).toBe(false);   // côte à côte à gauche
    expect(flanks(target, at(4, 4), at(6, 4))).toBe(false);   // deux coins du haut
  });
  it("un coin et le côté opposé décalé : pas de tenaille (la ligne sort par un côté voisin)", () => {
    expect(flanks(target, at(4, 4), at(6, 5))).toBe(false);
  });
  it("l'un des deux pas au contact : pas de tenaille", () => {
    expect(flanks(target, at(3, 5), at(6, 5))).toBe(false);
  });
  it("une cible Grande : de part et d'autre de ses quatre cases", () => {
    const big = at(5, 5, 2, 2);
    expect(flanks(big, at(4, 5), at(7, 6))).toBe(true);    // gauche (haut) / droite (bas)
    expect(flanks(big, at(5, 4), at(6, 7))).toBe(true);    // haut / bas
    expect(flanks(big, at(4, 5), at(5, 4))).toBe(false);   // gauche / haut
  });
  it("un attaquant Grand : il suffit qu'une de ses cases convienne", () => {
    expect(flanks(target, at(3, 4, 2, 2), at(6, 5))).toBe(true);
    expect(flanks(target, at(3, 3, 2, 2), at(6, 6))).toBe(true);   // sa case (4, 4) et le coin (6, 6)
  });
  it("outils : contact, centres, traversée", () => {
    expect(touchesBox({ x: 4.5, y: 5.5 }, target)).toBe(true);
    expect(touchesBox({ x: 5.5, y: 5.5 }, target)).toBe(false);   // dans l'espace
    expect(touchesBox({ x: 3.5, y: 5.5 }, target)).toBe(false);
    expect(cellCenters(at(0, 0, 2, 1))).toEqual([{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }]);
    expect(cellCenters(at(0, 0, 0.5, 0.5))).toEqual([{ x: 0.25, y: 0.25 }]);
    expect(crossesOpposite({ x: 4.5, y: 5.5 }, { x: 6.5, y: 5.5 }, target)).toBe(true);
    expect(crossesOpposite({ x: 4.5, y: 4.5 }, { x: 4.5, y: 6.5 }, target)).toBe(false);   // passe à côté
  });
});

describe("prise en tenaille : réglages", () => {
  it("désactivée par défaut", () => {
    expect(flankingApplies({ mode: "off", side: "all", attackerIsPc: true })).toBe(false);
  });
  it("PJ et PNJ, PJ seulement, PNJ seulement", () => {
    expect(flankingApplies({ mode: "advantage", side: "all", attackerIsPc: false })).toBe(true);
    expect(flankingApplies({ mode: "advantage", side: "pc", attackerIsPc: true })).toBe(true);
    expect(flankingApplies({ mode: "advantage", side: "pc", attackerIsPc: false })).toBe(false);
    expect(flankingApplies({ mode: "advantage", side: "npc", attackerIsPc: false })).toBe(true);
    expect(flankingApplies({ mode: "advantage", side: "npc", attackerIsPc: true })).toBe(false);
  });
});

describe("prise en tenaille : Avantage", () => {
  const attack = over => attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false, ...over });
  it("donne l'Avantage, avec le nom de l'allié", () => {
    const m = attack({ flankedWith: "Bramo" });
    expect(m.advantage).toEqual([{ who: "situation", key: "flanking", ally: "Bramo" }]);
    expect(netMode(m)).toBe(1);
  });
  it("jamais à distance", () => {
    expect(attack({ ranged: true, flankedWith: "Bramo" }).advantage).toEqual([]);
  });
  it("un Désavantage l'annule ; Insaisissable l'empêche", () => {
    expect(netMode(attack({ flankedWith: "Bramo", attacker: ["prone"] }))).toBe(0);
    expect(attack({ flankedWith: "Bramo", elusive: true }).advantage).toEqual([]);
  });
  it("ne se cumule pas avec un autre Avantage (un seul d20 de plus)", () => {
    expect(netMode(attack({ flankedWith: "Bramo", helped: true }))).toBe(1);
  });
});
