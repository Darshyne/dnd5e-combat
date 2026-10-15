import { describe, it, expect } from "vitest";
import { MERGE, mergeEntries } from "../module/scripts/core/content/merge.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";

/**
 * La fusion des couches (core/content/merge.mjs) suit une table : une clé du schéma sans stratégie disparaîtrait sans bruit à la
 * fusion (une entrée du monde ou d'un item ne changerait rien).
 */
describe("fusion des couches", () => {
  it("chaque clé du schéma a sa stratégie, et la table n'en a pas d'autre", () => {
    expect(Object.keys(MERGE).filter(k => !ENTRY_KEYS.includes(k))).toEqual([]);
    expect(ENTRY_KEYS.filter(k => !(k in MERGE))).toEqual([]);
  });
  it("les stratégies : remplacer, fusionner champ par champ, copier", () => {
    const out = mergeEntries([
      { aura: { radius: 10, units: "ft" }, triggers: [{ on: "hit" }], recast: true, reactions: { perRound: 2 } },
      { aura: { radius: 30 }, triggers: { on: "isHit" }, recast: false },
      null
    ]);
    expect(out).toEqual({ triggers: [{ on: "isHit" }], aura: { radius: 30, units: "ft" }, recast: false, reactions: { perRound: 2 } });
  });
});
