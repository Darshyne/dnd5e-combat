import { describe, it, expect } from "vitest";
import { relevantAnimations } from "../module/scripts/core/animations.mjs";

describe("§112 : les animations à attendre avant d'appliquer", () => {
  const now = 10000;
  const fx = (id, more) => ({ id, source: null, target: null, persist: false, started: now - 500, ended: false, ...more });
  it("celles qui partent de l'auteur ou arrivent sur une cible", () => {
    const effects = [fx("a", { source: "T.mage" }), fx("b", { target: "T.zombi" }), fx("c", { source: "T.autre", target: "T.autre2" })];
    expect(relevantAnimations(effects, ["T.mage", "T.zombi"], now)).toEqual(["a", "b"]);
  });
  it("ni persistantes, ni finies, ni anciennes", () => {
    const effects = [fx("p", { source: "T.mage", persist: true }), fx("f", { source: "T.mage", ended: true }),
      fx("v", { source: "T.mage", started: now - 5000 })];
    expect(relevantAnimations(effects, ["T.mage"], now)).toEqual([]);
  });
  it("sans token connu : rien", () => expect(relevantAnimations([fx("a", { source: "T.mage" })], [null, undefined], now)).toEqual([]));
});
