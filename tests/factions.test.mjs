import { describe, it, expect, afterEach } from "vitest";
import {
  PARTY, pairKey, normalizeFactions, suggestedRelations, factionByRules, useFactionTable, factionRelation,
  hostileSides, alliedSides, targetRelation, dispositionFor, GENERIC_FACTIONS
} from "../module/scripts/core/factions.mjs";
import { areHostile } from "../module/scripts/core/reaction.mjs";
import { relationOf } from "../module/scripts/core/targeting.mjs";

const DISPOSITIONS = [1, 0, -1, -2, null, undefined];
const table = {
  factions: [{ id: PARTY }, { id: "bandits" }, { id: "wildlife" }, { id: "undead" }],
  relations: { [pairKey("bandits", "wildlife")]: "hostile", [pairKey("bandits", "undead")]: "neutral", [pairKey("bandits", PARTY)]: "hostile" },
  grudges: []
};

afterEach(() => useFactionTable(null));

describe("§181 sans faction : exactement la règle des dispositions", () => {
  it("toutes les combinaisons, table vide et table pleine", () => {
    for ( const t of [null, table] ) {
      useFactionTable(t);
      for ( const a of DISPOSITIONS ) for ( const b of DISPOSITIONS ) {
        const sa = { disposition: a }, sb = { disposition: b };
        expect(hostileSides(sa, sb)).toBe(areHostile(a, b));
        expect(alliedSides(sa, sb)).toBe(a === b);
        expect(targetRelation(sa, sb)).toBe(relationOf(a, b));
        // Un seul des deux a une faction : rien ne change non plus.
        expect(hostileSides({ ...sa, faction: "bandits" }, sb)).toBe(areHostile(a, b));
        expect(alliedSides(sa, { ...sb, faction: "wildlife" })).toBe(a === b);
      }
    }
  });

  it("deux PJ (faction implicite) gardent leurs dispositions entre eux", () => {
    useFactionTable(table);
    expect(alliedSides({ disposition: 1, faction: PARTY }, { disposition: 0, faction: PARTY })).toBe(false);
    expect(hostileSides({ disposition: 1, faction: PARTY }, { disposition: -1, faction: PARTY })).toBe(true);
  });

  it("un couple que la matrice ne règle pas suit la disposition", () => {
    useFactionTable(table);
    const loup = { disposition: -1, faction: "wildlife" }, goule = { disposition: -1, faction: "undead" };
    expect(alliedSides(loup, goule)).toBe(true);
    expect(hostileSides({ disposition: 1, faction: PARTY }, loup)).toBe(true);
  });
});

describe("§181 avec factions", () => {
  const bandit = { disposition: -1, faction: "bandits", uuid: "T.bandit" };
  const loup = { disposition: -1, faction: "wildlife", uuid: "T.loup" };
  const goule = { disposition: -1, faction: "undead", uuid: "T.goule" };

  it("bandit et loup, tous deux Hostiles, sont ennemis ; bandit et goule neutres", () => {
    useFactionTable(table);
    expect(hostileSides(bandit, loup)).toBe(true);
    expect(alliedSides(bandit, loup)).toBe(false);
    expect(targetRelation(bandit, loup)).toBe("opposed");
    expect(hostileSides(bandit, goule)).toBe(false);
    expect(alliedSides(bandit, goule)).toBe(false);
    expect(targetRelation(bandit, goule)).toBe("neutral");
  });

  it("même faction : alliés, quelle que soit la disposition", () => {
    useFactionTable(table);
    expect(alliedSides(bandit, { disposition: 0, faction: "bandits" })).toBe(true);
  });

  it("rancune : par faction ou par token", () => {
    useFactionTable({ ...table, grudges: [["undead", "bandits"]] });
    expect(hostileSides(bandit, goule)).toBe(true);
    useFactionTable({ ...table, grudges: [["T.goule", "T.bandit"]] });
    expect(factionRelation(goule, bandit)).toBe("hostile");
    // La rancune vaut même sans faction.
    expect(hostileSides({ disposition: 1, uuid: "T.a" }, { disposition: 1, uuid: "T.b" })).toBe(false);
    useFactionTable({ grudges: [["T.a", "T.b"]] });
    expect(hostileSides({ disposition: 1, uuid: "T.a" }, { disposition: 1, uuid: "T.b" })).toBe(true);
  });

  it("une créature rendue n'est l'ennemie de personne hors de sa faction", () => {
    useFactionTable(table);
    expect(hostileSides({ ...bandit, stance: "neutral" }, loup)).toBe(false);
    expect(hostileSides({ ...bandit, stance: "neutral" }, { disposition: 1, faction: PARTY })).toBe(false);
    expect(alliedSides({ ...bandit, stance: "neutral" }, { disposition: -1, faction: "bandits" })).toBe(true);
  });

  it("disposition imposée par la relation avec les PJ", () => {
    useFactionTable(table);
    expect(dispositionFor("bandits")).toBe(-1);
    expect(dispositionFor("wildlife")).toBe(null);
    expect(dispositionFor(PARTY)).toBe(null);
  });
});

describe("§181 réglage et règles", () => {
  it("normalise : party en tête, ids invalides et doublons écartés, relations inconnues retirées", () => {
    const n = normalizeFactions({
      factions: [{ id: "bandits", name: "Bandits", rules: { types: [" Humanoid "] } }, { id: "bandits" }, { id: "x y" }, { id: "loups", color: "red" }],
      relations: { "bandits|loups": "hostile", "loups|bandits": "allied", "bandits|nobody": "hostile", "bandits|bandits": "allied", "loups|party": "bof" }
    });
    expect(n.factions.map(f => f.id)).toEqual([PARTY, "bandits", "loups"]);
    expect(n.factions[1].rules.types).toEqual(["humanoid"]);
    expect(n.factions[2].color).toBe("#888888");
    expect(Object.keys(n.relations)).toEqual([pairKey("bandits", "loups")]);
  });

  it("règles : identifiant > sous-type > type", () => {
    const factions = [{ id: PARTY, rules: { types: ["humanoid"] } }, ...GENERIC_FACTIONS,
      { id: "gobelins", rules: { subtypes: ["goblinoid"] } }, { id: "meute", rules: { identifiers: ["wolf"] } }];
    expect(factionByRules(factions, { type: "beast" })).toBe("wildlife");
    expect(factionByRules(factions, { type: "beast", identifier: "wolf" })).toBe("meute");
    expect(factionByRules(factions, { type: "humanoid", subtype: "Goblinoid" })).toBe("gobelins");
    expect(factionByRules(factions, { type: "humanoid" })).toBe(null);   // party ne se gagne pas par règle
  });

  it("relations suggérées : les haineux contre tous, le reste neutre", () => {
    const s = suggestedRelations([{ id: PARTY }, ...GENERIC_FACTIONS]);
    expect(s[pairKey("undead", "wildlife")]).toBe("hostile");
    expect(s[pairKey("plants", "wildlife")]).toBe("neutral");
    expect(Object.keys(s).some(k => k.includes(PARTY))).toBe(false);
  });
});
