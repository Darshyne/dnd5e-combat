import { describe, it, expect } from "vitest";
import { planPurge } from "../module/scripts/core/purge.mjs";

const msgs = (n, extra={}) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, origin: null, open: false, ...(extra[i] ?? {}) }));

describe("planPurge (§58)", () => {
  it("rien sous le seuil, ni seuil nul", () => {
    expect(planPurge(msgs(10), { max: 10, keep: 5 })).toEqual([]);
    expect(planPurge(msgs(50), { max: 0, keep: 5 })).toEqual([]);
  });

  it("au-delà du seuil, les plus anciens jusqu'à n'en garder que `keep`", () => {
    expect(planPurge(msgs(12), { max: 10, keep: 8 })).toEqual(["m0", "m1", "m2", "m3"]);
  });

  it("une action ouverte et ses jets restent", () => {
    const list = msgs(12, { 1: { open: true }, 2: { origin: "m1" } });
    expect(planPurge(list, { max: 10, keep: 8 })).toEqual(["m0", "m3"]);
  });

  it("une carte supprimée emporte ses jets, même récents", () => {
    const list = msgs(12, { 9: { origin: "m3" } });
    expect(planPurge(list, { max: 10, keep: 8 })).toEqual(["m0", "m1", "m2", "m3", "m9"]);
  });

  it("`keep` borné par `max`", () => {
    expect(planPurge(msgs(12), { max: 10, keep: 50 })).toEqual(["m0", "m1"]);
  });
});
