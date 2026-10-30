import { describe, it, expect } from "vitest";
import { heroicWanted, keptOf, rerolledD20, damageDiceLow, rerolledDamage } from "../module/scripts/core/heroic.mjs";

describe("§282 Inspiration héroïque", () => {
  it("suit le réglage du client : à chaque jet, sur un échec (ou une issue inconnue), jamais", () => {
    expect(heroicWanted("on", false)).toBe(true);
    expect(heroicWanted("failure", false)).toBe(false);
    expect(heroicWanted("failure", true)).toBe(true);
    expect(heroicWanted("failure", null)).toBe(true);
    expect(heroicWanted("off", true)).toBe(false);
  });

  it("garde le bon d20 selon Avantage / Désavantage", () => {
    expect(keptOf([7], null)).toBe(7);
    expect(keptOf([3, 18], "advantage")).toBe(18);
    expect(keptOf([3, 18], "disadvantage")).toBe(3);
  });

  it("relance un seul d20 et déplace le total de la différence", () => {
    const r = rerolledD20({ values: [4], mode: null, total: 9 }, 0, 15);
    expect(r).toMatchObject({ old: 4, kept: 15, total: 20, delta: 11, critical: false, fumble: false });
  });

  it("avec Désavantage, relancer le dé bas ne garde que le plus bas des deux", () => {
    const r = rerolledD20({ values: [3, 12], mode: "disadvantage", total: 8 }, 0, 19);
    expect(r).toMatchObject({ kept: 12, total: 17, delta: 9 });
  });

  it("le nouveau jet doit être utilisé, même plus mauvais ; il refait critique et échec automatique", () => {
    expect(rerolledD20({ values: [14], total: 19 }, 0, 1)).toMatchObject({ total: 6, delta: -13, fumble: true });
    expect(rerolledD20({ values: [1], total: 6, criticalSuccess: 19 }, 0, 19)).toMatchObject({ critical: true, fumble: false });
  });

  it("dégâts : « échec » = un dé à la moitié de son maximum ou moins", () => {
    expect(damageDiceLow([{ faces: 6, value: 3 }])).toBe(true);
    expect(damageDiceLow([{ faces: 6, value: 4 }, { faces: 8, value: 5 }])).toBe(false);
  });

  it("dégâts : la part du type bouge de la différence, jamais sous zéro", () => {
    expect(rerolledDamage(9, 2, 6)).toBe(13);
    expect(rerolledDamage(1, 3, 1)).toBe(0);
  });
});
