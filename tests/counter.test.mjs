import { describe, it, expect } from "vitest";
import { castLevelOf, counterPlan, counterSucceeds, absorbPlan } from "../module/scripts/core/counter.mjs";
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

describe("§344 : absorber un sort qui ne vise que le porteur", () => {
  it("un sort de niveau 1 ou plus, une seule cible, sans zone : l'activité est jouée au niveau du sort", () => {
    expect(absorbPlan({ castLevel: 3, targets: 1, area: false })).toEqual({ scaling: 2 });
    expect(absorbPlan({ castLevel: 1, targets: 1, area: false })).toEqual({ scaling: 0 });
  });
  it("ni tour de magie, ni plusieurs cibles, ni zone", () => {
    expect(absorbPlan({ castLevel: 0, targets: 1, area: false })).toBeNull();
    expect(absorbPlan({ castLevel: 2, targets: 2, area: false })).toBeNull();
    expect(absorbPlan({ castLevel: 2, targets: 1, area: true })).toBeNull();
  });
  it("le Sceptre doit pouvoir stocker l'énergie ; le Bâton gagne des charges sans plafond lu ici", () => {
    expect(absorbPlan({ castLevel: 5, targets: 1, area: false, costs: true, usesLeft: 4 })).toBeNull();
    expect(absorbPlan({ castLevel: 4, targets: 1, area: false, costs: true, usesLeft: 4 })).toEqual({ scaling: 3 });
    expect(absorbPlan({ castLevel: 9, targets: 1, area: false, costs: false, usesLeft: 0 })).toEqual({ scaling: 8 });
  });
  it("l'étape cancel est permise à la fenêtre isTargeted avec une réaction", () => {
    expect(validateEntry({ triggers: [{ on: "isTargeted", do: [{ type: "use", activity: "abcdefghijklmnop" }, { type: "cancel" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use", activity: "abcdefghijklmnop" }, { type: "cancel" }] }] }).length).toBeGreaterThan(0);
  });
});

describe("§345 : sauvegarde au toucher sous enchantement, état après sauvegarde", () => {
  it("onHit.whileEnchanted et spends", () => {
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", whileEnchanted: "ponmlkjihgfedcba", spends: true } })).toEqual([]);
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", spends: true } }).length).toBeGreaterThan(0);
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", whileEnchanted: "court" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", autre: 1 } }).length).toBeGreaterThan(0);
  });
  it("étape status avec save", () => {
    const entry = save => ({ triggers: [{ on: "hit", do: [{ type: "status", status: "prone", save }] }] });
    expect(validateEntry(entry({ ability: "str", dc: 15 }))).toEqual([]);
    expect(validateEntry(entry({ ability: "force", dc: 15 })).length).toBeGreaterThan(0);
    expect(validateEntry(entry({ ability: "str" })).length).toBeGreaterThan(0);
  });
});

describe("§346 : lumière portée — capuchon et enchantement", () => {
  const light = extra => ({ carriedLight: { bright: 30, dim: 60, units: "ft", ...extra } });
  it("hooded : { bright, dim }", () => {
    expect(validateEntry(light({ hooded: { bright: 0, dim: 5 } }))).toEqual([]);
    expect(validateEntry(light({ hooded: { dim: 5 } })).length).toBeGreaterThan(0);
    expect(validateEntry(light({ hooded: { bright: 0, dim: 5, angle: 3 } })).length).toBeGreaterThan(0);
  });
  it("whileEnchanted : un id d'effet", () => {
    expect(validateEntry(light({ whileEnchanted: "MHnAqxEXBhUbnjPq" }))).toEqual([]);
    expect(validateEntry(light({ whileEnchanted: "Ablaze" })).length).toBeGreaterThan(0);
  });
});
