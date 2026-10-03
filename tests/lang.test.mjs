import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Foundry range les traductions en arbre d'après les points des clés : « A.B » (une phrase) et « A.B.C » ne peuvent pas
 * coexister, l'une écrase l'autre et `game.i18n` rend la clé brute (vu le 2026-09-26 : « PerceptionPassive.Repere » et
 * « PerceptionPassive.Repere.Court », §16.51).
 */
describe("fichiers de langue", () => {
  for ( const lang of ["fr", "en"] ) {
    it(`${lang} : aucune clé n'est le préfixe d'une autre`, () => {
      const keys = Object.keys(JSON.parse(readFileSync(new URL(`../module/lang/${lang}.json`, import.meta.url), "utf8")));
      const set = new Set(keys);
      const clashes = keys.filter(k => k.split(".").some((_, i, parts) => (i > 0) && set.has(parts.slice(0, i).join("."))));
      expect(clashes).toEqual([]);
    });
  }
});
