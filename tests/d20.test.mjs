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

/**
 * §435 : la garde d'un d20 — dnd5e 6 note `adv` / `dis` (D20Die#applyAdvantage), pas `kh` / `kl`. Un Désavantage lu comme un Avantage
 * faisait garder le mauvais d20 après une relance de l'Inspiration héroïque, et l'Hypervigilance relançait « 2d20 » (la somme).
 */
import { d20Keep } from "../module/scripts/core/d20.mjs";
import { rerolledD20 } from "../module/scripts/core/heroic.mjs";
import { initiativeReroll } from "../module/scripts/core/initiative.mjs";

describe("garde d'un d20 (§435)", () => {
  it("lit adv / dis de dnd5e 6, kh / kl écrits à la main", () => {
    expect(d20Keep(["dis"])).toBe("kl");
    expect(d20Keep(["adv"])).toBe("kh");
    expect(d20Keep(["adv2"])).toBe("kh");
    expect(d20Keep(["kl"])).toBe("kl");
    expect(d20Keep(["kh1"])).toBe("kh");
    expect(d20Keep(["min10"])).toBeNull();
    expect(d20Keep([])).toBeNull();
    expect(d20Keep(undefined)).toBeNull();
  });

  it("le mode noté par dnd5e l'emporte", () => {
    expect(d20Keep([], -1)).toBe("kl");
    expect(d20Keep(["adv"], -1)).toBe("kl");
    expect(d20Keep([], 1)).toBe("kh");
    expect(d20Keep(["dis"], 0)).toBe("kl");
  });

  it("Désavantage 17 / 8 (+5 = 13), le 17 relancé en 7 : le plus bas des deux, 7, compte (12)", () => {
    const mode = d20Keep(["dis"]) === "kl" ? "disadvantage" : "advantage";
    expect(rerolledD20({ values: [17, 8], mode, total: 13 }, 0, 7)).toMatchObject({ kept: 7, total: 12 });
  });

  it("Hypervigilance avec Désavantage : 2d20kl, pas 2d20", () => {
    expect(initiativeReroll({ atMost: 9 }, { number: 2, kept: 4, keep: d20Keep(["dis"]) })).toBe("2d20kl");
  });
});
