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
