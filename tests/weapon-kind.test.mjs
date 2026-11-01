import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { holds, unknownFacts } from "../module/scripts/core/triggers.mjs";

// Le fait `activity.weaponKind` (adapter/facts.mjs, relu dans la source : il touche à Foundry, on ne l'importe pas ici).
const factsSource = readFileSync(new URL("../module/scripts/adapter/facts.mjs", import.meta.url), "utf8");
const ADAPTER_FACTS = Array.from(factsSource.matchAll(/^\s+"([a-z]+\.[A-Za-z]+)":/gm), m => m[1]);

describe("fait activity.weaponKind", () => {
  const condition = { "activity.weaponKind": ["unarmed", "simpleM", "improv"], "activity.isMelee": true };

  it("l'adaptateur le fournit", () => {
    expect(ADAPTER_FACTS).toContain("activity.weaponKind");
    expect(unknownFacts(condition, Object.fromEntries(ADAPTER_FACTS.map(k => [k, true])))).toEqual([]);
  });

  it("une liste de genres : frappe à mains nues, arme courante ou improvisée oui, arme de guerre non", () => {
    for ( const kind of ["unarmed", "simpleM", "improv"] ) expect(holds(condition, { "activity.weaponKind": kind, "activity.isMelee": true }), kind).toBe(true);
    expect(holds(condition, { "activity.weaponKind": "martialM", "activity.isMelee": true })).toBe(false);
    expect(holds(condition, { "activity.weaponKind": null, "activity.isMelee": true })).toBe(false);
  });
});
