/**
 * Ce qui, dans une zone, ne vaut qu'à partir d'un tour de son lanceur (`fromPulse`). Tempête vengeresse (SRD 5.2) : le terrain
 * difficile et la visibilité nulle sont des « tours 5 à 10 », comme l'interdit des attaques à distance — ils valaient dès la pose.
 */
import { describe, it, expect } from "vitest";
import { fromPulseReached } from "../module/scripts/core/area.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("fromPulseReached", () => {
  it("sans règle : non ; sans `fromPulse` : dès la pose", () => {
    expect(fromPulseReached(undefined, 3)).toBe(false);
    expect(fromPulseReached(null, 3)).toBe(false);
    expect(fromPulseReached(true, 0)).toBe(true);
    expect(fromPulseReached({}, undefined)).toBe(true);
    expect(fromPulseReached({ types: ["plants"] }, 0)).toBe(true);
  });
  it("`fromPulse: 4` : pas aux trois premiers rejeux, puis oui", () => {
    for ( const pulses of [undefined, 0, 1, 2, 3] ) expect(fromPulseReached({ fromPulse: 4 }, pulses), String(pulses)).toBe(false);
    for ( const pulses of [4, 5, 9] ) expect(fromPulseReached({ fromPulse: 4 }, pulses), String(pulses)).toBe(true);
  });
});

describe("le schéma", () => {
  it("`obscures` : true ou { fromPulse }", () => {
    expect(validateEntry({ obscures: true })).toEqual([]);
    expect(validateEntry({ obscures: { fromPulse: 4 } })).toEqual([]);
    for ( const bad of [false, {}, { fromPulse: 0 }, { fromPulse: 1.5 }, { fromPulse: 4, extra: 1 }] ) {
      expect(validateEntry({ obscures: bad }), JSON.stringify(bad)).toEqual(["obscures: true or { fromPulse }"]);
    }
  });
  it("`difficultTerrain.fromPulse` : un entier positif", () => {
    expect(validateEntry({ difficultTerrain: { fromPulse: 4 } })).toEqual([]);
    expect(validateEntry({ difficultTerrain: { fromPulse: 0 } })).toEqual(["difficultTerrain.fromPulse: a positive integer"]);
  });
});
