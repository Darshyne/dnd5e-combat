import { describe, expect, it } from "vitest";
import { SHIPPED, SRD_ALIASES } from "../module/scripts/content/index.mjs";

describe("alias SRD (relevé des trous, 2026-10-22)", () => {
  it("chaque sort renommé par le SRD a l'entrée du Manuel", () => {
    for ( const [srd, phb] of Object.entries(SRD_ALIASES) ) {
      expect(SHIPPED[phb], phb).toBeTruthy();
      expect(SHIPPED[srd], srd).toBe(SHIPPED[phb]);
    }
  });

  it("Tentacules noirs : rien sur une sauvegarde réussie, au Manuel comme au SRD", () => {
    expect(SHIPPED["evards-black-tentacles"].saveDamage).toEqual({ dnd5eactivity000: "none" });
    expect(SHIPPED["black-tentacles"].saveDamage).toEqual({ dnd5eactivity000: "none" });
  });
});
