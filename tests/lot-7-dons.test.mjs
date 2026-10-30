import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const valid = entry => validateEntry(entry, { at: "x." });

describe("§289 : dons — fins des dons sombres, Seconde peau", () => {
  it("les effets du 1 naturel durent jusqu'à la fin (ou au début) du prochain tour du porteur", () => {
    expect(CONTENT["aberrant-anatomy"].effectEnds).toEqual({ ON3Q0GCwGVqeS0WV: "bearerTurnEnd" });
    expect(CONTENT["echoing-soul"].effectEnds).toEqual({ "13N8KOB67iya0ROs": "bearerTurnEnd" });
    expect(CONTENT["gathered-whispers"].effectEnds).toEqual({ T67RGbFPYgYo6Ics: "bearerTurnEnd" });
    expect(CONTENT["living-shadow"].effectEnds).toEqual({ MmYLSlBTwu1FC8UR: "bearerTurnStart" });
  });

  it("Voix d'outre-tombe : Désavantage aux attaques par l'effet", () => {
    const t = CONTENT["gathered-whispers"].triggers.find(x => x.on === "preAttackRoll");
    expect(t).toMatchObject({ via: "effect", fromEffect: "T67RGbFPYgYo6Ics", do: [{ type: "disadvantage" }] });
  });

  it("Ombre vivante : la table tirée quand l'effet tombe", () => {
    expect(CONTENT["living-shadow"].drawsOnEnd.MmYLSlBTwu1FC8UR).toMatch(/RollTable\.rhwShadowsWillqh$/);
    expect(valid({ drawsOnEnd: { MmYLSlBTwu1FC8UR: "pas une table" } }).length).toBe(1);
  });

  it("Seconde peau : catalyseur, sauvegarde, lancement ou Étourdi", () => {
    expect(CONTENT["second-skin"].catalyst).toEqual({ save: "tJwaLWFWyZvq9y0r", cast: "ZrjtFFSbJZTj8Cfm", effect: "9HmJl0qrUIVbJQUA" });
    expect(CONTENT["second-skin"].effectEnds).toEqual({ "9HmJl0qrUIVbJQUA": "bearerTurnStart" });
    expect(valid({ catalyst: { save: "tJwaLWFWyZvq9y0r", cast: "ZrjtFFSbJZTj8Cfm" } }).length).toBe(1);
  });
});
