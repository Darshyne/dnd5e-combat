import { describe, it, expect } from "vitest";
import { FLOAT_CATEGORIES, FLOAT_CATEGORY_DEFAULTS, floatLine, floatLabel, floatFrame, floatDelays } from "../module/scripts/core/float-text.mjs";

describe("textes flottants (§228)", () => {
  it("chaque sorte a une catégorie qui a une valeur par défaut", () => {
    for ( const category of Object.values(FLOAT_CATEGORIES) ) expect(category in FLOAT_CATEGORY_DEFAULTS).toBe(true);
  });
  it("une catégorie coupée ne montre rien ; le jet s'ajoute au verdict", () => {
    expect(floatLine({ kind: "miss", roll: 9 }, "Raté")).toEqual({ text: "Raté", roll: 9, dieIcon: true, icon: null, mode: null });
    expect(floatLine({ kind: "miss", roll: 9 }, "Raté", { dice: false })).toEqual({ text: "Raté", roll: null, dieIcon: false, icon: null, mode: null });
    expect(floatLine({ kind: "miss" }, "Raté", { show: { floatAttacks: false } })).toBeNull();
    expect(floatLine({ kind: "cover" }, "Abri partiel")?.icon).toBe("icons/svg/shield.svg");
    expect(floatLine({ kind: "cover" }, "Abri partiel", { icons: false })?.icon).toBeNull();
  });
  it("un coup qui touche : rien par défaut sans jet, son jet seul, ou « Touché » si demandé", () => {
    expect(floatLine({ kind: "hit" }, null)).toBeNull();
    expect(floatLine({ kind: "hit", roll: 17 }, null)).toEqual({ text: "", roll: 17, dieIcon: true, icon: null, mode: null });
    expect(floatLine({ kind: "hit", roll: 17 }, null, { dice: false })).toBeNull();
    expect(floatLine({ kind: "hit" }, null, { show: { floatHits: true }, hitText: "Touché" })?.text).toBe("Touché");
  });
  it("l'animation reste opaque au milieu et s'efface à la fin", () => {
    expect(floatFrame(0).alpha).toBe(0);
    expect(floatFrame(0.5).alpha).toBe(1);
    expect(floatFrame(1).alpha).toBeCloseTo(0);
    expect(floatFrame(1).offset).toBeCloseTo(1);
    expect(floatFrame(0.5).offset).toBeCloseTo(0.5);
  });
  it("les textes d'un même token s'espacent, d'une salve à l'autre aussi", () => {
    const busy = new Map();
    expect(floatDelays(["a", "a", "b"], 1, 1000, busy)).toEqual([0, 1000, 0]);
    expect(floatDelays(["a"], 1, 1500, busy)).toEqual([1500]);   // « a » est libre à 3000
  });
  it("§231 : Avantage / Désavantage après le total, ou seul devant le verdict", () => {
    const modeText = { advantage: "Avantage", disadvantage: "Désavantage" };
    const miss = floatLine({ kind: "miss", roll: 9, mode: "disadvantage" }, "Raté", { modeText });
    expect(miss.mode).toBe("disadvantage");
    expect(floatLabel(miss, modeText, "avec")).toBe("9 avec Désavantage · Raté");
    const noDice = floatLine({ kind: "miss", roll: 9, mode: "advantage" }, "Raté", { modeText, dice: false });
    expect(floatLabel(noDice, modeText, "avec")).toBe("Avantage · Raté");
    expect(floatLine({ kind: "miss", roll: 9, mode: "advantage" }, "Raté", { modeText, show: { floatAdvantage: false } }).mode).toBeNull();
    const hit = floatLine({ kind: "hit", mode: "advantage" }, null, { modeText, dice: false });
    expect(floatLabel(hit, modeText, "avec")).toBe("Avantage");
    expect(floatLine({ kind: "cover", mode: "advantage" }, "Abri", { modeText }).mode).toBeNull();
  });
});

describe("§292 : tests de caractéristique et de compétence", async () => {
  const { checkKind, floatLine, floatLabel } = await import("../module/scripts/core/float-text.mjs");
  const modeText = { advantage: "Avantage", disadvantage: "Désavantage" };

  it("sans DD, le seul total ; avec un DD, réussite ou échec", () => {
    expect(checkKind({ total: 15 })).toBe("check");
    expect(checkKind({ total: 15, target: null })).toBe("check");
    expect(checkKind({ total: 15, target: 12, isSuccess: true })).toBe("checkSuccess");
    expect(checkKind({ total: 9, target: 12, isFailure: true })).toBe("checkFail");
    expect(checkKind({ total: 12, target: 12 })).toBe("checkSuccess");
    expect(checkKind({ total: 11, target: "12" })).toBe("checkFail");
  });

  it("la ligne : total, mode, compétence et verdict ; coupée par sa catégorie", () => {
    const line = floatLine({ kind: "checkSuccess", roll: 15, mode: "advantage" }, "Athlétisme · Réussite", { modeText });
    expect(floatLabel(line, modeText, "avec")).toBe("15 avec Avantage · Athlétisme · Réussite");
    expect(line.dieIcon).toBe(true);
    expect(floatLabel(floatLine({ kind: "check", roll: 8 }, "Force", { modeText }), modeText)).toBe("8 · Force");
    expect(floatLine({ kind: "check", roll: 8 }, "Force", { show: { floatChecks: false } })).toBeNull();
    expect(floatLabel(floatLine({ kind: "checkFail", roll: 4 }, "Discrétion · Échec", { dice: false }))).toBe("Discrétion · Échec");
  });
});
