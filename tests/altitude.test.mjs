import { describe, it, expect } from "vitest";
import {
  placementOf, modeRefusal, coherentElevation, modeShift, alignPath, groundStepAllowed
} from "../module/scripts/core/altitude.mjs";

const opts = { clearance: 5, step: 5 };

describe("mode et élévation", () => {
  it("place le corps selon le mode", () => {
    expect(placementOf("walk")).toBe("ground");
    expect(placementOf("crawl")).toBe("ground");
    expect(placementOf("fly")).toBe("air");
    expect(placementOf("burrow")).toBe("under");
    expect(placementOf("climb")).toBeNull();
    expect(placementOf("displace")).toBeNull();
  });

  it("voler ou fouir demande la vitesse correspondante", () => {
    expect(modeRefusal("fly", { walk: 30 })).toBe("noSpeed");
    expect(modeRefusal("fly", { walk: 30, fly: 60 })).toBeNull();
    expect(modeRefusal("burrow", { burrow: 0 })).toBe("noSpeed");
    expect(modeRefusal("walk", {})).toBeNull();
  });

  it("marcher et ramper collent au sol, voler reste à 5 ft au moins, fouir à −5 ft au plus", () => {
    expect(coherentElevation("walk", 30, 0, 5)).toBe(0);
    expect(coherentElevation("crawl", -10, 20, 5)).toBe(20);
    expect(coherentElevation("fly", 0, 0, 5)).toBe(5);
    expect(coherentElevation("fly", 30, 0, 5)).toBe(30);
    expect(coherentElevation("fly", 22, 20, 5)).toBe(25);
    expect(coherentElevation("burrow", 0, 0, 5)).toBe(-5);
    expect(coherentElevation("burrow", -15, 0, 5)).toBe(-15);
    expect(coherentElevation("climb", 12, 0, 5)).toBe(12);
  });
});

describe("plafond", () => {
  it("en vol, les pieds restent sous le plafond (tête comprise)", () => {
    // Rez-de-chaussée de 0 à 15 ft, créature de 5 ft : pieds à 10 ft au plus.
    expect(coherentElevation("fly", 15, 0, 5, 10)).toBe(10);
    expect(coherentElevation("fly", 8, 0, 5, 10)).toBe(8);
    expect(modeShift("walk", "fly", 0, 0, 5, 10)).toEqual({ elevation: 5, action: "fly" });
  });

  it("un plafond trop bas ne l'emporte pas sur les 5 ft du vol", () => {
    expect(coherentElevation("fly", 0, 0, 5, 2)).toBe(5);
  });

  it("le plafond ne touche ni la marche ni le fouissement", () => {
    expect(coherentElevation("walk", 12, 0, 5, 10)).toBe(0);
    expect(coherentElevation("burrow", 0, 0, 5, -20)).toBe(-5);
  });

  it("alignPath borne un chemin en vol au plafond de chaque point", () => {
    const r = alignPath({ elevation: 10 }, [{ action: "fly", ground: 0, ceiling: 10, elevation: 20 }], { clearance: 5, step: 5 });
    expect(r.elevations).toEqual([10]);
  });
});

describe("changement de mode", () => {
  it("décoller, atterrir, s'enfouir, remonter", () => {
    expect(modeShift("walk", "fly", 0, 0, 5)).toEqual({ elevation: 5, action: "fly" });
    expect(modeShift("fly", "walk", 30, 0, 5)).toEqual({ elevation: 0, action: "fly" });
    expect(modeShift("walk", "burrow", 0, 0, 5)).toEqual({ elevation: -5, action: "burrow" });
    expect(modeShift("burrow", "walk", -15, 0, 5)).toEqual({ elevation: 0, action: "burrow" });
  });

  it("rien à faire quand l'élévation convient déjà", () => {
    expect(modeShift("fly", "fly", 30, 0, 5)).toBeNull();
    expect(modeShift("walk", "crawl", 0, 0, 5)).toBeNull();
    expect(modeShift("walk", "fly", 20, 0, 5)).toBeNull();
  });

  it("d'un mode libre vers le sol, en l'air : une chute, laissée à dnd5e", () => {
    expect(modeShift("climb", "walk", 15, 0, 5)).toBeNull();
  });
});

describe("alignPath", () => {
  const walk = (ground, elevation=0) => ({ action: "walk", ground, elevation });

  it("suit le sol à la marche, une marche de 5 ft au plus", () => {
    const r = alignPath({ elevation: 0 }, [walk(0), walk(5, 0), walk(5, 0), walk(0, 5)], opts);
    expect(r).toMatchObject({ elevations: [0, 5, 5, 0], kept: 4, issue: null, changed: true });
  });

  it("ne change rien à un chemin déjà cohérent", () => {
    expect(alignPath({ elevation: 0 }, [walk(0), walk(0)], opts).changed).toBe(false);
  });

  it("refuse de monter plus haut qu'une marche sans grimper", () => {
    const r = alignPath({ elevation: 0 }, [walk(0), walk(10)], opts);
    expect(r.issue).toBe("tooHigh");
    expect(r.kept).toBe(1);
  });

  it("s'arrête au bord du vide, sur le vide : c'est une chute", () => {
    const r = alignPath({ elevation: 20 }, [walk(20, 20), walk(0, 20), walk(0, 20)], opts);
    expect(r).toMatchObject({ elevations: [20, 20], kept: 2, issue: "falls" });
  });

  it("le MJ suit le sol quoi qu'il arrive", () => {
    const r = alignPath({ elevation: 0 }, [walk(20), walk(0, 20)], { ...opts, lenient: true });
    expect(r).toMatchObject({ elevations: [20, 0], issue: null });
  });

  it("en vol, remonte au-dessus du sol sans jamais redescendre de lui-même", () => {
    const r = alignPath({ elevation: 30 }, [
      { action: "fly", ground: 0, elevation: 30 }, { action: "fly", ground: 30, elevation: 30 }, { action: "fly", ground: 0, elevation: 35 }
    ], opts);
    expect(r.elevations).toEqual([30, 35, 35]);
  });

  it("en fouissement, reste sous le sol", () => {
    const r = alignPath({ elevation: -5 }, [{ action: "burrow", ground: 0, elevation: 0 }], opts);
    expect(r.elevations).toEqual([-5]);
  });

  it("laisse les autres modes tels quels", () => {
    const r = alignPath({ elevation: 0 }, [{ action: "climb", ground: 0, elevation: 15 }, { action: "displace", ground: 0, elevation: 40 }], opts);
    expect(r).toMatchObject({ elevations: [15, 40], changed: false });
  });

  it("l'A* ne franchit qu'une marche", () => {
    expect(groundStepAllowed(0, 5, 5)).toBe(true);
    expect(groundStepAllowed(0, 10, 5)).toBe(false);
    expect(groundStepAllowed(10, 0, 5)).toBe(false);
  });
});
