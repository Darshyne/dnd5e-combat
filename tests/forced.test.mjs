import { describe, it, expect } from "vitest";
import { forcedReasons } from "../module/scripts/core/forced.mjs";
import { FLOAT_CATEGORIES, FLOAT_KINDS, floatStyleDefault } from "../module/scripts/core/float-text.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

// §408 (issue #44, lot 1) : une règle passée outre — ce qui est signalé au MJ et marqué sur la carte.
describe("forcedReasons", () => {
  const lines = ["Ce n'est pas votre tour.", "Hors de portée : Zombi.", "Hors de portée : Zombi."];
  const budgetLines = ["Ce n'est pas votre tour."];

  it("« Utiliser quand même » : toutes les raisons, sans doublon", () => {
    expect(forcedReasons({ lines, budgetLines, action: "go" })).toEqual(["Ce n'est pas votre tour.", "Hors de portée : Zombi."]);
  });

  it("« Utiliser ma Réaction » règle le budget : seules les autres raisons restent", () => {
    expect(forcedReasons({ lines, budgetLines, action: "reaction" })).toEqual(["Hors de portée : Zombi."]);
    expect(forcedReasons({ lines: budgetLines, budgetLines, action: "reaction" })).toEqual([]);
  });

  it("« Renoncer » ou fenêtre fermée : rien n'est passé outre", () => {
    expect(forcedReasons({ lines, budgetLines, action: "cancel" })).toEqual([]);
    expect(forcedReasons({ lines, budgetLines, action: null })).toEqual([]);
  });

  it("raisons vides ignorées", () => {
    expect(forcedReasons({ lines: ["", null, "Silence."], action: "go" })).toEqual(["Silence."]);
  });
});

describe("retour « Forcé »", () => {
  it("une sorte de texte flottant à part, réglée avec les avis", () => {
    expect(FLOAT_KINDS).toContain("forced");
    expect(FLOAT_CATEGORIES.forced).toBe("floatPrompts");
    expect(floatStyleDefault("forced").color).toBe("#ff9a3c");
  });

  it("un son entendu de la table", () => {
    expect(actionSound("overridden", "success")).toBeTruthy();
    expect(actionSound("overridden", "failure")).toBeNull();
  });
});

// §417 : le réglage « Action impossible » — ce que devient un refus.
describe("refusalOutcome", async () => {
  const { refusalOutcome, REFUSAL_MODES } = await import("../module/scripts/core/forced.mjs");
  it("par défaut et « selon le niveau » : la fenêtre, celui qui agit décide, le MJ est prévenu", () => {
    for ( const mode of ["level", "window", undefined, "inconnu"] ) {
      expect(refusalOutcome(mode)).toMatchObject({ window: true, proceed: null, report: true });
    }
  });
  it("simple avertissement : pas de fenêtre, l'action part, avis et signalement", () => {
    expect(refusalOutcome("notice")).toMatchObject({ window: false, proceed: true, warn: true, report: true });
  });
  it("refus strict : un joueur ne peut que renoncer, le MJ garde la fenêtre entière", () => {
    expect(refusalOutcome("strict", { isGM: false })).toMatchObject({ window: true, proceed: false, report: false });
    expect(refusalOutcome("strict", { isGM: true })).toMatchObject({ window: true, proceed: null, report: true });
  });
  it("aucun contrôle : ni fenêtre, ni avis, ni signalement", () => {
    expect(refusalOutcome("off")).toMatchObject({ window: false, proceed: true, warn: false, report: false });
  });
  it("cinq modes, « level » en tête (le défaut)", () => {
    expect(REFUSAL_MODES).toEqual(["level", "window", "notice", "strict", "off"]);
  });
});
