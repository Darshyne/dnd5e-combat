import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§284 : effets vides dans la donnée", () => {
  it("Danse irrésistible d'Otto : Vitesses à 0 sur les deux effets, Dex en Désavantage sous Charmé seulement", () => {
    const changes = CONTENT["ottos-irresistible-dance"].effectChanges;
    for ( const id of ["MpToumiJ2o3S16K7", "UhFtBDEZEDpVgz9G"] ) {
      expect(changes[id].filter(c => c.key.startsWith("system.attributes.movement.")).map(c => c.value)).toEqual([0, 0, 0, 0, 0]);
    }
    expect(changes.MpToumiJ2o3S16K7.some(c => c.key === "system.abilities.dex.save.roll.mode")).toBe(true);
    expect(changes.UhFtBDEZEDpVgz9G.some(c => c.key === "system.abilities.dex.save.roll.mode")).toBe(false);
    const steps = CONTENT["ottos-irresistible-dance"].triggers.filter(t => t.on === "preAttackRoll").map(t => t.do[0].type).sort();
    expect(steps).toEqual(["advantage", "disadvantage"]);
  });

  it("Prémonition : Avantage pour le porteur, Désavantage contre lui", () => {
    const t = CONTENT.foresight.triggers.filter(d => d.on === "preAttackRoll");
    expect(t.find(d => d.if["source.hasEffect"])?.do[0].type).toBe("advantage");
    expect(t.find(d => d.if["target.hasEffect"])?.do[0].type).toBe("disadvantage");
  });

  it("Aliénation et Épine mentale déclarent leur marqueur", () => {
    expect(CONTENT.befuddlement.noSpells).toBe(true);
    expect(CONTENT["mind-spike"].knownToOrigin).toBe(true);
    expect(validateEntry({ noSpells: "yes" }, { at: "x." }).length).toBeGreaterThan(0);
    expect(validateEntry({ knownToOrigin: 1 }, { at: "x." }).length).toBeGreaterThan(0);
  });
});
