import { describe, it, expect } from "vitest";
import { castLevelOf, counterPlan, counterSucceeds } from "../module/scripts/core/counter.mjs";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
const facts = { "target.seesSource": true };

describe("§66 : contresort à la manière de 2014", () => {
  it("le niveau de lancement : niveau du sort, mis à l'échelle, emplacement ou sort lié — le plus haut", () => {
    expect(castLevelOf({ level: 3 })).toBe(3);
    expect(castLevelOf({ level: 3, scaling: 2 })).toBe(5);
    expect(castLevelOf({ level: 3, slotLevel: 6 })).toBe(6);
    expect(castLevelOf({ level: 3, linkedLevel: 4 })).toBe(4);   // Boule de feu lancée au niveau 4 par une capacité
    expect(castLevelOf({ level: 0, slotLevel: null, scaling: undefined })).toBe(0);
    expect(castLevelOf({ level: 2, slotLevel: Number.NaN })).toBe(2);
    expect(castLevelOf()).toBe(0);
  });

  it("jusqu'au niveau du contresort, le sort échoue sans jet ; au-delà, test contre DD 10 + niveau", () => {
    expect(counterPlan(5, 5)).toEqual({ castLevel: 5, level: 5, auto: true, dc: null });
    expect(counterPlan(1, 3)).toEqual({ castLevel: 1, level: 3, auto: true, dc: null });
    expect(counterPlan(0, 3).auto).toBe(true);
    expect(counterPlan(6, 5)).toEqual({ castLevel: 6, level: 5, auto: false, dc: 16 });
    expect(counterPlan(9, 3)).toEqual({ castLevel: 9, level: 3, auto: false, dc: 19 });
  });

  it("le test réussi (total ≥ DD) dissipe le sort ; raté ou absent, le sort passe", () => {
    const plan = counterPlan(6, 5);
    expect(counterSucceeds(plan, 16)).toBe(true);
    expect(counterSucceeds(plan, 15)).toBe(false);
    expect(counterSucceeds(plan, null)).toBe(false);
    expect(counterSucceeds(counterPlan(2, 5), null)).toBe(true);
  });

  it("le contenu : `counter: { level? }`, niveau entier de 0 à 9", () => {
    const triggers = [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", target: "source" }] }];
    expect(validateEntry({ counter: { level: 5 }, triggers }, { facts })).toEqual([]);
    expect(validateEntry({ counter: {} }, { facts })).toEqual([]);
    expect(validateEntry({ counter: { level: 10 } }, { facts })[0]).toMatch(/counter/);
    expect(validateEntry({ counter: { level: "5" } }, { facts })[0]).toMatch(/counter/);
    expect(validateEntry({ counter: { level: 5, dc: 12 } }, { facts })[0]).toMatch(/counter/);
    expect(validateEntry({ counter: true }, { facts })[0]).toMatch(/counter/);
    expect(mergeEntries([{ counter: { level: 3 } }, { counter: { level: 5 } }]).counter).toEqual({ level: 5 });
  });
});
