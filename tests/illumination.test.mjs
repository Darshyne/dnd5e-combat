import { describe, it, expect } from "vitest";
import { LIGHT, lightLevel, perceivedLight, obscurement, lightIndicator, globalLightLevel } from "../module/scripts/core/illumination.mjs";

describe("niveau de lumière en un point", () => {
  it("sans rien : ténèbres", () => {
    expect(lightLevel()).toEqual({ level: LIGHT.DARK, darkened: false });
  });
  it("la lumière globale donne son niveau, vive ou faible", () => {
    expect(lightLevel({ global: LIGHT.BRIGHT }).level).toBe(LIGHT.BRIGHT);
    expect(lightLevel({ global: LIGHT.DIM }).level).toBe(LIGHT.DIM);
  });
  it("une torche : vive dans son rayon vif, faible au-delà ; la plus forte l'emporte", () => {
    expect(lightLevel({ lights: [{ priority: 0, bright: false }] }).level).toBe(LIGHT.DIM);
    expect(lightLevel({ lights: [{ priority: 0, bright: false }, { priority: 0, bright: true }] }).level).toBe(LIGHT.BRIGHT);
    expect(lightLevel({ global: LIGHT.DIM, lights: [{ priority: 0, bright: true }] }).level).toBe(LIGHT.BRIGHT);
  });
  it("des ténèbres éteignent la lumière globale et les lumières de priorité inférieure ou égale", () => {
    expect(lightLevel({ global: LIGHT.BRIGHT, darkness: [{ priority: 0 }] })).toEqual({ level: LIGHT.DARK, darkened: true });
    expect(lightLevel({ lights: [{ priority: 0, bright: true }], darkness: [{ priority: 0 }] }).level).toBe(LIGHT.DARK);
    expect(lightLevel({ lights: [{ priority: 1, bright: true }], darkness: [{ priority: 2 }] }).level).toBe(LIGHT.DARK);
  });
  it("une lumière magique plus forte que les ténèbres rétablit l'éclairage", () => {
    expect(lightLevel({ lights: [{ priority: 3, bright: true }], darkness: [{ priority: 2 }] }))
      .toEqual({ level: LIGHT.BRIGHT, darkened: false });
  });
  it("des ténèbres sans lumière à éteindre restent des ténèbres magiques", () => {
    expect(lightLevel({ darkness: [{ priority: 0 }] })).toEqual({ level: LIGHT.DARK, darkened: true });
  });
});

describe("niveau perçu selon les sens", () => {
  const dark = { level: LIGHT.DARK, darkened: false };
  const magical = { level: LIGHT.DARK, darkened: true };
  const dim = { level: LIGHT.DIM };
  const bright = { level: LIGHT.BRIGHT };

  it("sans sens particulier, le niveau réel", () => {
    expect(perceivedLight(dark)).toBe(LIGHT.DARK);
    expect(perceivedLight(dim)).toBe(LIGHT.DIM);
    expect(perceivedLight(bright)).toBe(LIGHT.BRIGHT);
  });
  it("vision dans le noir : faible → vive, ténèbres → faible (d'où le Désavantage en Perception dans le noir)", () => {
    expect(perceivedLight(dim, { darkvision: true })).toBe(LIGHT.BRIGHT);
    expect(perceivedLight(dark, { darkvision: true })).toBe(LIGHT.DIM);
    expect(obscurement(perceivedLight(dark, { darkvision: true })).perceptionDisadvantage).toBe(true);
  });
  it("la vision dans le noir ne perce pas les ténèbres magiques", () => {
    expect(perceivedLight(magical, { darkvision: true })).toBe(LIGHT.DARK);
  });
  it("Vision du diable : voit normalement en lumière faible et dans les ténèbres, magiques ou non", () => {
    expect(perceivedLight(dim, { devilsSight: true })).toBe(LIGHT.BRIGHT);
    expect(perceivedLight(magical, { devilsSight: true })).toBe(LIGHT.BRIGHT);
  });
  it("vision véritable : perce les ténèbres, pas la lumière faible", () => {
    expect(perceivedLight(magical, { truesight: true })).toBe(LIGHT.BRIGHT);
    expect(perceivedLight(dim, { truesight: true })).toBe(LIGHT.DIM);
  });
  it("hors de portée, un sens ne compte pas (l'adaptateur passe false)", () => {
    expect(perceivedLight(dark, { darkvision: false })).toBe(LIGHT.DARK);
  });
});

describe("obscurcissement", () => {
  it("vive : rien ; faible : légèrement obscurci ; ténèbres : fortement obscurci", () => {
    expect(obscurement(LIGHT.BRIGHT)).toEqual({ obscured: "none", perceptionDisadvantage: false, blinded: false });
    expect(obscurement(LIGHT.DIM)).toEqual({ obscured: "light", perceptionDisadvantage: true, blinded: false });
    expect(obscurement(LIGHT.DARK)).toEqual({ obscured: "heavy", perceptionDisadvantage: false, blinded: true });
  });
});

describe("indicateur de lumière", () => {
  it("le niveau réel, et ténèbres magiques à part", () => {
    expect(lightIndicator({ level: LIGHT.BRIGHT }, LIGHT.BRIGHT)).toEqual({ key: "bright", own: null });
    expect(lightIndicator({ level: LIGHT.DIM }, LIGHT.DIM)).toEqual({ key: "dim", own: null });
    expect(lightIndicator({ level: LIGHT.DARK, darkened: true }, LIGHT.DARK)).toEqual({ key: "magical", own: null });
  });
  it("ce que le token perçoit lui-même, s'il perçoit autrement (vision dans le noir)", () => {
    expect(lightIndicator({ level: LIGHT.DARK }, LIGHT.DIM)).toEqual({ key: "dark", own: "dim" });
    expect(lightIndicator({ level: LIGHT.DIM }, LIGHT.BRIGHT)).toEqual({ key: "dim", own: "bright" });
  });
});

describe("lumière globale et crépuscule", () => {
  const vive = { active: true, bright: 5000, darkness: { min: 0, max: 0.75 } };
  it("comme le cœur : vive dans sa plage, rien hors de sa plage ou éteinte, faible si elle n'est pas vive", () => {
    expect(globalLightLevel(vive, 0.3)).toBe(LIGHT.BRIGHT);
    expect(globalLightLevel(vive, 0.8)).toBeNull();
    expect(globalLightLevel({ ...vive, active: false }, 0.3)).toBeNull();
    expect(globalLightLevel({ ...vive, bright: 0 }, 0.3)).toBe(LIGHT.DIM);
  });
  it("crépuscule : faible dès que l'obscurité atteint le seuil, tant qu'elle reste dans la plage", () => {
    expect(globalLightLevel(vive, 0.59, 0.6)).toBe(LIGHT.BRIGHT);
    expect(globalLightLevel(vive, 0.6, 0.6)).toBe(LIGHT.DIM);
    expect(globalLightLevel(vive, 0.75, 0.6)).toBe(LIGHT.DIM);
    expect(globalLightLevel(vive, 0.76, 0.6)).toBeNull();
  });
  it("seuil à 1 : pas de crépuscule", () => {
    expect(globalLightLevel(vive, 0.75, 1)).toBe(LIGHT.BRIGHT);
  });
});
