/** §62 : l'ouïe — on sait où est une créature qu'on ne voit pas, sauf si elle est cachée. */
import { describe, it, expect } from "vitest";
import { hears, locationUnknown } from "../module/scripts/core/hearing.mjs";

describe("hears", () => {
  it("par défaut, on entend", () => {
    expect(hears({})).toBe(true);
  });
  it("assourdi, cible cachée, cible morte ou mur qui arrête le son : on n'entend pas", () => {
    expect(hears({ deafened: true })).toBe(false);
    expect(hears({ hidden: true })).toBe(false);
    expect(hears({ silent: true })).toBe(false);
    expect(hears({ soundBlocked: true })).toBe(false);
  });
});

describe("locationUnknown", () => {
  it("cachée et non vue : position inconnue", () => {
    expect(locationUnknown({ hidden: true, sees: false })).toBe(true);
  });
  it("cachée mais perçue (vision aveugle…) : on sait où elle est", () => {
    expect(locationUnknown({ hidden: true, sees: true })).toBe(false);
  });
  it("invisible sans être cachée : on l'entend, on sait où elle est", () => {
    expect(locationUnknown({ hidden: false, sees: false })).toBe(false);
  });
  it("la vision ne peut pas trancher : on laisse faire", () => {
    expect(locationUnknown({ hidden: true, sees: null })).toBe(false);
  });
});
