import { describe, it, expect } from "vitest";
import { feedbackBetween } from "../module/scripts/core/feedback.mjs";

const target = (over={}) => ({ token: "Scene.s.Token.z", hit: null, critical: false, cover: null, reaction: null, save: null, ...over });
const state = (targets, step="awaitingRolls") => ({ step, targets });

describe("retour visuel : faits nouveaux d'une résolution", () => {
  it("rien de neuf : rien", () => {
    const s = state([target({ hit: true })]);
    expect(feedbackBetween(s, s)).toEqual([]);
  });

  it("verdict raté, avec l'abri qui l'a causé", () => {
    const out = feedbackBetween(state([target()]), state([target({ hit: false, cover: { degree: "half", bonus: 2 } })], "missed"));
    expect(out.map(f => f.kind)).toEqual(["cover", "miss"]);
    expect(out[0].degree).toBe("half");
  });

  it("critique ; un coup normal n'écrit rien (les PV s'en chargent)", () => {
    expect(feedbackBetween(null, state([target({ hit: true, critical: true })])).map(f => f.kind)).toEqual(["critical"]);
    expect(feedbackBetween(null, state([target({ hit: true })]))).toEqual([]);
  });

  it("réaction qui change le verdict : son nom, puis le raté", () => {
    const before = state([target({ hit: true })], "awaitingReaction");
    const after = state([target({ hit: false, reaction: "Bouclier" })]);
    expect(feedbackBetween(before, after)).toEqual([
      { token: "Scene.s.Token.z", kind: "reaction", name: "Bouclier" },
      { token: "Scene.s.Token.z", kind: "miss" }
    ]);
  });

  it("sauvegardes : réussie, ratée, ratée d'office — une seule fois", () => {
    const before = state([target({ token: "a" }), target({ token: "b" }), target({ token: "c" })]);
    const after = state([
      target({ token: "a", save: { success: true, total: 15 } }),
      target({ token: "b", save: { success: false, total: 4 } }),
      target({ token: "c", save: { success: false, total: null, auto: "paralyzed" } })
    ]);
    expect(feedbackBetween(before, after)).toEqual([
      { token: "a", kind: "saveSuccess", auto: false },
      { token: "b", kind: "saveFail", auto: false },
      { token: "c", kind: "saveFail", auto: true }
    ]);
    expect(feedbackBetween(after, after)).toEqual([]);
  });

  it("annulation par le MJ : rien", () => {
    expect(feedbackBetween(null, state([target({ hit: false })], "undone"))).toEqual([]);
  });
});

describe("réplique, non affecté (§16.25, §16.8)", () => {
  it("une réplique qui prend le coup s'écrit au lieu de « raté » ; une cible non affectée le dit", () => {
    const before = { step: "awaitingReaction", targets: [{ token: "T1", hit: true, critical: false }, { token: "T2", hit: null }] };
    const after = { step: "done", targets: [
      { token: "T1", hit: false, critical: false, reason: "duplicate", duplicate: { taken: true, dice: [4] } },
      { token: "T2", hit: null, unaffected: { reason: "type" } }
    ] };
    expect(feedbackBetween(before, after)).toEqual([{ token: "T1", kind: "duplicate" }, { token: "T2", kind: "unaffected" }]);
  });
});
