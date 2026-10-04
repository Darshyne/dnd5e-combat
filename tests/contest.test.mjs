import { describe, it, expect } from "vitest";
import { contestOutcome, bestSkill } from "../module/scripts/core/contest.mjs";

describe("§72 : test en opposition", () => {
  it("strictement plus : l'auteur l'emporte", () => expect(contestOutcome(15, 12)).toBe("win"));
  it("égalité : rien ne change", () => expect(contestOutcome(12, 12)).toBe("tie"));
  it("moins : la cible l'emporte", () => expect(contestOutcome(9, 12)).toBe("lose"));
  it("un jet manquant : pas de victoire", () => expect(contestOutcome(15, NaN)).toBe("lose"));
  it("la cible oppose sa meilleure compétence", () => {
    expect(bestSkill({ dec: 2, ins: 5, ath: 7 }, ["dec", "ins"])).toBe("ins");
    expect(bestSkill({ dec: 2 }, ["dec"])).toBe("dec");
    expect(bestSkill({}, ["dec"])).toBe("dec");
  });
});
