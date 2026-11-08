import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { grantInMemoryModes, DEVILS_SIGHT_MODE, HEARING_MODE } from "../module/scripts/core/light.mjs";

/**
 * Issue #42, suite (Archibald, 0.281.0) : depuis l'EXTÉRIEUR des Ténèbres, l'occultiste à Vision du diable ne voyait que le contour de l'ouïe
 * et sa visée était refusée.
 */
describe("issue #42 : modes donnés en mémoire après une préparation du token", () => {
  it("les remet quand la préparation les a effacés, et le signale", () => {
    const modes = { basicSight: { enabled: true, range: 60 }, lightPerception: { enabled: true, range: null } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(true);
    expect(modes[DEVILS_SIGHT_MODE]).toEqual({ enabled: true, range: 36 });
    expect(modes[HEARING_MODE]).toEqual({ enabled: true, range: Infinity });
  });

  it("répare le mode laissé sans « enabled » par un effet token.detectionModes.devilsSight.range", () => {
    const modes = { basicSight: { enabled: true, range: 18 }, devilsSight: { range: 36 } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(true);
    expect(modes.devilsSight.enabled).toBe(true);
  });

  it("ne signale rien quand tout est déjà là (pas de vue refaite pour rien)", () => {
    const modes = { basicSight: { enabled: true }, [DEVILS_SIGHT_MODE]: { enabled: true, range: 36 }, [HEARING_MODE]: { enabled: true, range: Infinity } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(false);
  });

  it("l'ouïe reste le dernier mode, après la Vision du diable", () => {
    const modes = { [HEARING_MODE]: { enabled: true, range: Infinity }, basicSight: { enabled: true } };
    expect(grantInMemoryModes(modes, { devilsSight: 36, hearing: true })).toBe(true);
    expect(Object.keys(modes).at(-1)).toBe(HEARING_MODE);
  });

  it("retire la Vision du diable quand l'invocation n'y est plus", () => {
    const modes = { [DEVILS_SIGHT_MODE]: { enabled: true, range: 36 } };
    expect(grantInMemoryModes(modes, { devilsSight: 0 })).toBe(true);
    expect(modes[DEVILS_SIGHT_MODE]).toBeUndefined();
  });
});

describe("issue #42 : la ligne de vue de la visée ignore les bords des Ténèbres", () => {
  // Voir la cible est l'affaire de `canSee` ; ces tests de « ligne de vue » ne doivent compter que les murs et les planchers.
  const files = ["module/scripts/runtime/actions.mjs", "module/scripts/adapter/movement.mjs"];
  for ( const file of files ) {
    it(`${file} : chaque hasLineOfSight passe throughDarkness`, () => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const calls = source.split("\n").filter(line => line.includes("hasLineOfSight(") && !line.trim().startsWith("import"));
      expect(calls.length).toBeGreaterThan(0);
      for ( const line of calls ) expect(line).toContain("throughDarkness: true");
    });
  }
});
