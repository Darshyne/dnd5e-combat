/** Les filtres du lanceur de scénarios (`--grep`, `--section`, `--scene`) : tools/lib/scenario-meta.mjs. */
import { describe, it, expect } from "vitest";
import { matches, scenarioMeta } from "../tools/lib/scenario-meta.mjs";

const TEXT = `/**
 * Zone qui dure (§16.8) : Rayon de lune, fin de tour dedans.
 */
export default {
  scene: "Escalade",
  name: "zone-duree — Rayon de lune, fin de tour du Zombi dedans (§47)",
};`;

describe("scénarios : ce qu'on lit sans les charger", () => {
  const meta = scenarioMeta(TEXT);
  it("titre, résumé, scène, § cités", () => {
    expect(meta.scene).toBe("Escalade");
    expect(meta.summary).toBe("Rayon de lune, fin de tour du Zombi dedans (§47)");
    expect(meta.refs).toEqual(["§16.8", "§47"]);
  });
  it("un mot, sans accents ni casse ; plusieurs mots : l'un ou l'autre", () => {
    expect(matches("zone-duree", meta, { words: ["ZÔNE"] })).toBe(true);
    expect(matches("zone-duree", meta, { words: ["porte", "lune"] })).toBe(true);
    expect(matches("zone-duree", meta, { words: ["porte"] })).toBe(false);
  });
  it("un § vaut pour ses sous-sections, pas pour un numéro qui commence pareil", () => {
    expect(matches("x", meta, { sections: ["16"] })).toBe(true);
    expect(matches("x", meta, { sections: ["4"] })).toBe(false);
    expect(matches("x", meta, { sections: ["47"] })).toBe(true);
  });
  it("la scène ; « arene » : aucune scène déclarée ; les familles de filtres se cumulent", () => {
    expect(matches("x", meta, { scenes: ["escalade"] })).toBe(true);
    expect(matches("x", meta, { scenes: ["arene"] })).toBe(false);
    expect(matches("x", scenarioMeta("export default { name: \"a — b\" };"), { scenes: ["arene"] })).toBe(true);
    expect(matches("zone-duree", meta, { words: ["lune"], sections: ["99"] })).toBe(false);
  });
});
