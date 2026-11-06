import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

// §372 : `hitRider` en liste — options exclusives du même item, nommées par une activité ; dés propres, genres d'arme, limite relevée.
const A = "aaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbb", E = "eeeeeeeeeeeeeeee";

describe("contenu hitRider en liste", () => {
  it("une faveur seule reste valable", () => expect(validateEntry({ hitRider: { damage: A, oncePerTurn: true } })).toEqual([]));

  it("une liste d'options nommées, limite par tour relevée", () => {
    const turn = { oncePerTurn: true, perTurn: { count: 2, while: "other-feature" }, weapons: ["unarmed", "simpleM"] };
    expect(validateEntry({ hitRider: [{ name: A, formula: "1d12", weaponDamage: true, ...turn }, { name: B, effect: E, ...turn }] })).toEqual([]);
  });

  it("refuse une liste d'une seule option, une option sans nom, un genre d'arme inconnu, perTurn sans oncePerTurn", () => {
    for ( const bad of [
      [{ name: A }],
      [{ name: A }, { effect: E }],
      [{ name: A, weapons: ["laser"] }, { name: B }],
      [{ name: A, perTurn: { count: 2, while: "x" } }, { name: B }],
      [{ name: A, perTurn: { count: 1, while: "x" }, oncePerTurn: true }, { name: B }],
      [{ name: A, formula: "" }, { name: B }]
    ] ) expect(validateEntry({ hitRider: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
  });

  it("maxNextHit : true ou un id d'effet", () => {
    expect(validateEntry({ maxNextHit: true })).toEqual([]);
    expect(validateEntry({ maxNextHit: E })).toEqual([]);
    expect(validateEntry({ maxNextHit: "court" }).length).toBeGreaterThan(0);
  });
});
