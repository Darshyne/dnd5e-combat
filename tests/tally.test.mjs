import { describe, it, expect } from "vitest";
import { tallyAfter, tallySettled } from "../module/scripts/core/tally.mjs";

const RULE = { successes: 3, failures: 3 };

describe("compteur de sauvegardes répétées (§43.1)", () => {
  it("compte réussites et échecs, sans qu'ils aient à se suivre", () => {
    let s = tallyAfter(null, false, RULE);
    expect(s).toEqual({ successes: 0, failures: 1, settled: false, outcome: null });
    s = tallyAfter(s, true, RULE);
    s = tallyAfter(s, false, RULE);
    expect(s).toEqual({ successes: 1, failures: 2, settled: false, outcome: null });
  });

  it("trois réussites : l'effet tombe", () => {
    const s = tallyAfter({ successes: 2, failures: 2 }, true, RULE);
    expect(s.outcome).toBe("ended");
    expect(s.settled).toBe(false);
  });

  it("trois échecs : l'effet reste, le compteur est clos", () => {
    const s = tallyAfter({ successes: 2, failures: 2 }, false, RULE);
    expect(s).toEqual({ successes: 2, failures: 3, settled: true, outcome: "settled" });
    expect(tallySettled(s)).toBe(true);
    expect(tallySettled({ successes: 1, failures: 1 })).toBe(false);
    expect(tallySettled(undefined)).toBe(false);
  });

  it("des seuils différents", () => {
    expect(tallyAfter(null, true, { successes: 1, failures: 5 }).outcome).toBe("ended");
    expect(tallyAfter({ failures: 1 }, false, { successes: 3, failures: 2 }).outcome).toBe("settled");
  });
});
