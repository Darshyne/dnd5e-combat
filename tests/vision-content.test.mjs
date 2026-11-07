import { describe, it, expect } from "vitest";
import { SHIPPED } from "../module/scripts/content/index.mjs";

/**
 * Issue #42 : les déclarations de contenu dont dépendent la vue et l'ouïe (adapter/vision.mjs `blockingRegions`, adapter/hearing.mjs) —
 * une zone qui obscurcit, des ténèbres magiques, un silence. Changer l'une d'elles change ce que voit et entend chaque créature.
 */
describe("issue #42 : zones qui coupent la vue ou le son", () => {
  it("Nappe de brouillard obscurcit (brume), Ténèbres sont des ténèbres magiques", () => {
    expect(SHIPPED["fog-cloud"]?.obscures).toBe(true);
    expect(SHIPPED["darkness"]?.light?.darkness).toBe(true);
  });
  it("Silence fait le silence et porte ses effets dans la zone (Assourdi)", () => {
    expect(SHIPPED["silence"]?.silences).toBe(true);
    expect(SHIPPED["silence"]?.zoneEffects).toBe(true);
  });
  it("une zone qui obscurcit ne fait pas le silence, des ténèbres non plus", () => {
    expect(SHIPPED["fog-cloud"]?.silences).toBeUndefined();
    expect(SHIPPED["darkness"]?.silences).toBeUndefined();
  });
});
