import { describe, it, expect } from "vitest";
import { actionSound, noticeText, CORE_SOUNDS } from "../module/scripts/core/action-feedback.mjs";

describe("§252 retour d'action pour toute la table", () => {
  it("donne un son du cœur par action et par issue", () => {
    expect(actionSound("pick", "success")).toBe(CORE_SOUNDS.unlock);
    expect(actionSound("force", "failure")).toBe(CORE_SOUNDS.thud);
    expect(actionSound("land", "success")).toBeNull();
    expect(actionSound("inconnue", "success")).toBeNull();
    expect(actionSound("hide", undefined)).toBeNull();
    for ( const src of Object.values(CORE_SOUNDS) ) expect(src).toMatch(/^sounds\/.+\.ogg$/);
  });

  it("traduit un texte `{ key, data }` chez chaque client, garde une chaîne telle quelle", () => {
    const localize = (key, data) => `${key}:${data?.n ?? ""}`;
    expect(noticeText("Déjà traduit", localize)).toBe("Déjà traduit");
    expect(noticeText({ key: "Retour.Action.Cache" }, localize)).toBe("Retour.Action.Cache:");
    expect(noticeText({ key: "X", data: { n: 2 } }, localize)).toBe("X:2");
    expect(noticeText(null, localize)).toBe("");
    expect(noticeText({}, localize)).toBe("");
  });
});
