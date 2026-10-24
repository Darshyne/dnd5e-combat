import { describe, it, expect } from "vitest";
import { normalizeRequest, outcomeOf, tally, visibleTo } from "../module/scripts/core/group-roll.mjs";

const req = input => normalizeRequest({ type: "skill", key: "ath", ...input }).request;
const totals = (...list) => list.map(total => ({ total }));

describe("§242 : jets demandés par le MJ — la demande", () => {
  it("refuse un type inconnu ou une clé vide", () => {
    expect(normalizeRequest({ type: "attack", key: "str" }).error).toBeTruthy();
    expect(normalizeRequest({ type: "save", key: "" }).error).toBeTruthy();
  });
  it("DD vide : pas de DD, donc rien à cacher", () => {
    expect(req({ dc: "" }).dc).toBeNull();
    expect(req({ dc: "", hideDc: true }).hideDc).toBe(false);
    expect(req({ dc: "15", hideDc: true })).toMatchObject({ dc: 15, hideDc: true });
  });
  it("Avantage et Désavantage ensemble s'annulent", () => {
    expect(req({ advantage: true, disadvantage: true })).toMatchObject({ advantage: false, disadvantage: false });
    expect(req({ advantage: true })).toMatchObject({ advantage: true, disadvantage: false });
  });
  it("modificateur entier, libellé coupé, caractéristique seulement pour compétence et outil", () => {
    expect(req({ bonus: "-2" }).bonus).toBe(-2);
    expect(req({ bonus: "abc" }).bonus).toBe(0);
    expect(req({ label: "x".repeat(200) }).label).toHaveLength(120);
    expect(req({ ability: "int" }).ability).toBe("int");
    expect(normalizeRequest({ type: "save", key: "dex", ability: "int" }).request.ability).toBeNull();
  });
});

describe("§242 : résultats", () => {
  it("réussite : total ≥ DD ; sans DD, rien", () => {
    expect(outcomeOf(15, 15)).toBe(true);
    expect(outcomeOf(14, 15)).toBe(false);
    expect(outcomeOf(20, null)).toBeNull();
  });
  it("compte les jets en attente", () => {
    const t = tally(req({ dc: 12 }), totals(14, null, 9));
    expect(t).toMatchObject({ rolled: 2, waiting: 1, successes: 1, failures: 1, done: false });
    expect(t.entries.map(e => e.status)).toEqual(["rolled", "waiting", "rolled"]);
  });
  it("sans test de groupe : un échec suffit à rater, tout le monde doit réussir", () => {
    expect(tally(req({ dc: 12 }), totals(9, null)).success).toBe(false);
    expect(tally(req({ dc: 12 }), totals(14, null)).success).toBeNull();
    expect(tally(req({ dc: 12 }), totals(14, 13)).success).toBe(true);
  });
  it("test de groupe 2024 : la moitié qui réussit suffit", () => {
    const group = req({ dc: 12, group: true });
    expect(tally(group, totals(14, 3, 13, 2)).success).toBe(true);    // 2 sur 4
    expect(tally(group, totals(14, 3, 2)).success).toBe(false);       // 1 sur 3 : il en fallait 2
    expect(tally(group, totals(14, null, 13, null)).success).toBe(true);   // acquis avant la fin
    expect(tally(group, totals(3, 2, null, null)).success).toBeNull();    // encore possible
    expect(tally(group, totals(3, 2, 1, null)).success).toBe(false);   // perdu avant la fin
  });
  it("sans DD, pas de verdict", () => {
    expect(tally(req({ group: true }), totals(14, 3)).success).toBeNull();
  });
});

describe("§242 : ce que voit un joueur", () => {
  const view = r => ({ request: r, ...tally(r, totals(14, 3)) });
  it("DD caché : ni DD, ni réussites, ni verdict pour un joueur ; tout pour le MJ", () => {
    const hidden = view(req({ dc: 12, hideDc: true, group: true }));
    const player = visibleTo(hidden, { gm: false });
    expect(player.request.dc).toBeNull();
    expect(player.entries.every(e => e.success === null)).toBe(true);
    expect(player.success).toBeNull();
    expect(player.entries.map(e => e.total)).toEqual([14, 3]);
    expect(visibleTo(hidden, { gm: true }).request.dc).toBe(12);
  });
  it("DD visible : le joueur voit tout", () => {
    const shown = view(req({ dc: 12 }));
    expect(visibleTo(shown, { gm: false })).toBe(shown);
  });
});
