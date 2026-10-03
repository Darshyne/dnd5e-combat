import { describe, it, expect } from "vitest";
import { searchRollMode, normalTotal, searchVerdicts, passiveNotice } from "../module/scripts/core/search.mjs";

describe("mode du test de Chercher", () => {
  it("Désavantage dès qu'une cachette à juger au jet est en lumière faible perçue", () => {
    expect(searchRollMode([{ seeable: true }])).toBe("normal");
    expect(searchRollMode([{ seeable: true }, { seeable: true, disadvantage: true }])).toBe("disadvantage");
  });
  it("une cachette perçue par les sens ou hors de vue ne compte pas", () => {
    expect(searchRollMode([{ sensed: true, seeable: true, disadvantage: true }, { seeable: false, disadvantage: true }])).toBe("normal");
  });
  it("aucune cachette : test normal", () => {
    expect(searchRollMode([])).toBe("normal");
  });
});

describe("total sans Désavantage", () => {
  it("garde le premier d20 d'un test au Désavantage", () => {
    // 2d20kl : 17 et 4, 4 gardé, +5 → 9 ; sans Désavantage : 17 + 5 = 22.
    expect(normalTotal({ total: 9, d20: [17, 4], kept: 4 })).toBe(22);
    // Premier d20 gardé : identique.
    expect(normalTotal({ total: 8, d20: [3, 12], kept: 3 })).toBe(8);
  });
  it("un test à un seul d20 est déjà sans Désavantage", () => {
    expect(normalTotal({ total: 14, d20: [], kept: null })).toBe(14);
  });
});

describe("verdicts", () => {
  const roll = { total: 9, d20: [17, 4], kept: 4 };   // 9 au Désavantage, 22 sans
  it("en pleine lumière, le total sans Désavantage ; en lumière faible, le total au Désavantage", () => {
    const v = searchVerdicts([
      { id: "a", dc: 15, seeable: true },
      { id: "b", dc: 15, seeable: true, disadvantage: true }
    ], roll);
    expect(v).toEqual([
      { id: "a", found: true, reason: "roll", total: 22, dc: 15 },
      { id: "b", found: false, reason: "roll", total: 9, dc: 15 }
    ]);
  });
  it("atteindre le DD suffit", () => {
    expect(searchVerdicts([{ id: "a", dc: 14, seeable: true }], { total: 14 })[0].found).toBe(true);
  });
  it("hors de vue : jamais trouvée ; perçue par les sens : trouvée sans jet", () => {
    const v = searchVerdicts([{ id: "a", dc: 5, seeable: false }, { id: "b", dc: 30, sensed: true }], { total: 20 });
    expect(v).toEqual([
      { id: "a", found: false, reason: "unseen", dc: 5 },
      { id: "b", found: true, reason: "senses", dc: 30 }
    ]);
  });
});

describe("Perception passive", () => {
  it("atteindre le DD suffit ; −5 en lumière faible perçue", () => {
    expect(passiveNotice({ passive: 15, seeable: true }, 15)).toEqual({ notices: true, score: 15 });
    expect(passiveNotice({ passive: 15, seeable: true, disadvantage: true }, 15)).toEqual({ notices: false, score: 10 });
    expect(passiveNotice({ passive: 20, seeable: true, disadvantage: true }, 15)).toEqual({ notices: true, score: 15 });
  });
  it("hors de vue : jamais ; perçue par les sens : toujours", () => {
    expect(passiveNotice({ passive: 30, seeable: false }, 5)).toEqual({ notices: false, score: null });
    expect(passiveNotice({ passive: 1, sensed: true }, 30)).toEqual({ notices: true, score: null });
  });
  it("sans valeur passive, rien", () => {
    expect(passiveNotice({ passive: undefined, seeable: true }, 5).notices).toBe(false);
  });
});
