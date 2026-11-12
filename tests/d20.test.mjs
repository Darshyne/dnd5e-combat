/**
 * Issue #47 : la carte dit quels d20 ont roulé — le dé gardé et le dé écarté d'un Avantage ou d'un Désavantage.
 */
import { describe, it, expect } from "vitest";
import { keptAndDropped } from "../module/scripts/core/d20.mjs";

describe("dés gardés et écartés d'un d20", () => {
  it("jet normal : rien à dire", () => {
    expect(keptAndDropped([{ result: 11, active: true }], 0)).toBeNull();
    expect(keptAndDropped([], 0)).toBeNull();
    expect(keptAndDropped(undefined, 1)).toBeNull();
  });

  it("Désavantage : le plus bas gardé, le plus haut écarté", () => {
    const results = [{ result: 16, active: true }, { result: 19, active: false, discarded: true }];
    expect(keptAndDropped(results, -1)).toEqual({ mode: -1, kept: [16], dropped: [19] });
  });

  it("Avantage : le plus haut gardé, le plus bas écarté", () => {
    const results = [{ result: 4, active: false, discarded: true }, { result: 14, active: true }];
    expect(keptAndDropped(results, 1)).toEqual({ mode: 1, kept: [14], dropped: [4] });
  });

  it("trois dés (Avantage à trois d20) : deux écartés", () => {
    const results = [{ result: 4, active: false, discarded: true }, { result: 14, active: true }, { result: 9, active: false, discarded: true }];
    expect(keptAndDropped(results, 1)).toEqual({ mode: 1, kept: [14], dropped: [4, 9] });
  });

  it("un dé relancé n'est ni gardé ni écarté", () => {
    const results = [{ result: 1, active: false, rerolled: true }, { result: 12, active: true }];
    expect(keptAndDropped(results, 0)).toBeNull();
    const withAdvantage = [{ result: 1, active: false, rerolled: true }, { result: 12, active: true }, { result: 7, active: false, discarded: true }];
    expect(keptAndDropped(withAdvantage, 1)).toEqual({ mode: 1, kept: [12], dropped: [7] });
  });

  it("sans mode connu, les dés disent lequel", () => {
    expect(keptAndDropped([{ result: 16, active: true }, { result: 19, active: false, discarded: true }], undefined)?.mode).toBe(-1);
    expect(keptAndDropped([{ result: 16, active: true }, { result: 3, active: false, discarded: true }], 0)?.mode).toBe(1);
  });
});
