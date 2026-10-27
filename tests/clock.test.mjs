import { describe, it, expect } from "vitest";
import { clockHalt, clockTick, rivalClock, CLOCK_STEP_SECONDS } from "../module/scripts/core/clock.mjs";

describe("§251 : horloge en temps réel hors combat", () => {
  const on = { enabled: true, executor: true, rival: null, paused: false, inCombat: false };
  it("tourne quand rien ne l'arrête", () => expect(clockHalt(on)).toBe(null));
  it("coupée par le réglage", () => expect(clockHalt({ ...on, enabled: false })).toBe("off"));
  it("seul le MJ actif l'avance", () => expect(clockHalt({ ...on, executor: false })).toBe("notExecutor"));
  it("s'efface devant un module d'horloge", () => expect(clockHalt({ ...on, rival: "simple-timekeeping" })).toBe("rival"));
  it("arrêtée pendant la pause", () => expect(clockHalt({ ...on, paused: true })).toBe("paused"));
  it("arrêtée en combat", () => expect(clockHalt({ ...on, inCombat: true })).toBe("combat"));

  it("repart de maintenant", () => expect(clockTick(null, 5000)).toEqual({ advance: 0, counted: 5000 }));
  it("moins d'un pas : rien, le temps compté ne bouge pas", () => expect(clockTick(0, 4999)).toEqual({ advance: 0, counted: 0 }));
  it("un pas écoulé : avance des secondes entières, le reste attend", () =>
    expect(clockTick(0, 6500)).toEqual({ advance: 6, counted: 6000 }));
  it("un écart trop grand (veille) : un seul pas", () =>
    expect(clockTick(0, 3600000)).toEqual({ advance: CLOCK_STEP_SECONDS, counted: 3600000 }));
  it("horloge réelle revenue en arrière : repart", () => expect(clockTick(10000, 5000)).toEqual({ advance: 0, counted: 5000 }));

  it("reconnaît un module d'horloge actif", () => {
    expect(rivalClock(id => id === "calendaria")).toBe("calendaria");
    expect(rivalClock(() => false)).toBe(null);
  });
});
