import { describe, it, expect } from "vitest";
import {
  normalizeLock, isKey, judgeAttempt, normalizeTries, alreadyTried, recordTry, lockChoices, stateAfter, triesKey
} from "../module/scripts/core/locks.mjs";

describe("serrure d'une porte (§244)", () => {
  it("lit le drapeau sans lui faire confiance : DD vide ou invalide = le MJ décide", () => {
    expect(normalizeLock(undefined)).toEqual({ pickDc: null, forceDc: null, unforceable: false, key: "" });
    expect(normalizeLock({ pickDc: "", forceDc: null })).toMatchObject({ pickDc: null, forceDc: null });
    expect(normalizeLock({ pickDc: "15", forceDc: 0, unforceable: "yes", key: "  Clé de la crypte " }))
      .toEqual({ pickDc: 15, forceDc: null, unforceable: false, key: "Clé de la crypte" });
    expect(normalizeLock({ pickDc: 12.6, forceDc: 20, unforceable: true })).toMatchObject({ pickDc: 13, forceDc: 20, unforceable: true });
  });

  it("reconnaît la clé par son nom (casse et espaces ignorés) ou par son identifiant", () => {
    expect(isKey({ name: "Clé de la crypte" }, "clé de la crypte ")).toBe(true);
    expect(isKey({ name: "Crypt Key", identifier: "crypt-key" }, "crypt-key")).toBe(true);
    expect(isKey({ name: "Clé rouillée" }, "Clé de la crypte")).toBe(false);
    expect(isKey({ name: "" }, "")).toBe(false);
  });

  it("juge un essai contre le DD ; sans DD, le MJ tranche ; une porte non forçable résiste", () => {
    const lock = normalizeLock({ pickDc: 15, forceDc: 20 });
    expect(judgeAttempt(lock, "pick", 15)).toBe("success");
    expect(judgeAttempt(lock, "pick", 14)).toBe("failure");
    expect(judgeAttempt(lock, "force", 25)).toBe("success");
    expect(judgeAttempt(normalizeLock({}), "pick", 30)).toBe("gm");
    expect(judgeAttempt(normalizeLock({ forceDc: 5, unforceable: true }), "force", 30)).toBe("failure");
    expect(judgeAttempt(lock, "pick", NaN)).toBe("failure");
  });

  it("note un essai raté par personnage seulement avec le réglage « un essai »", () => {
    expect(recordTry({}, "Actor.a", "pick", "free")).toEqual({});
    const tries = recordTry({}, "Actor.a", "pick", "once");
    expect(tries).toEqual({ "Actor.a": ["pick"] });
    expect(recordTry(tries, "Actor.a", "pick", "once")).toEqual({ "Actor.a": ["pick"] });
    expect(alreadyTried(tries, "Actor.a", "pick", "once")).toBe(true);
    expect(alreadyTried(tries, "Actor.a", "force", "once")).toBe(false);
    expect(alreadyTried(tries, "Actor.b", "pick", "once")).toBe(false);
    expect(alreadyTried(tries, "Actor.a", "pick", "free")).toBe(false);
    expect(normalizeTries({ "Actor.a": ["pick", "bogus", "pick"], "Actor.b": "force", "Actor.c": [] }))
      .toEqual({ "Actor.a": ["pick"], "Actor.b": ["force"] });
  });

  it("note les essais sous une clé sans points (Foundry déplierait « Actor.abc »)", () => {
    expect(triesKey("Scene.s1.Token.t1.Actor.a1")).toBe("Scene_s1_Token_t1_Actor_a1");
    expect(triesKey(undefined)).toBe("");
  });

  it("propose la clé à qui la porte, crocheter, et forcer sauf porte non forçable", () => {
    const lock = normalizeLock({ key: "Clé", unforceable: false });
    expect(lockChoices(lock, { hasKey: true })).toEqual([
      { method: "key", spent: false }, { method: "pick", spent: false }, { method: "force", spent: false }
    ]);
    expect(lockChoices(lock, { hasKey: false }).map(c => c.method)).toEqual(["pick", "force"]);
    expect(lockChoices(normalizeLock({ unforceable: true }), {}).map(c => c.method)).toEqual(["pick"]);
    expect(lockChoices(normalizeLock({}), { tries: { "Actor.a": ["pick"] }, who: "Actor.a", mode: "once" }))
      .toEqual([{ method: "pick", spent: true }, { method: "force", spent: false }]);
  });

  it("crochetée ou ouverte à la clé, la porte reste fermée ; forcée, elle s'ouvre", () => {
    expect(stateAfter("pick")).toBe("closed");
    expect(stateAfter("key")).toBe("closed");
    expect(stateAfter("force")).toBe("open");
  });
});
