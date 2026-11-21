/**
 * Défense supérieure du chasseur (Rôdeur, Chasseur 15 — SRD 5.2) : une Réaction quand le Rôdeur subit des dégâts lui donne la
 * Résistance à ces dégâts et à tout autre dégât du même type jusqu'à la fin du tour en cours. Étape `resist` d'une réaction.
 */
import { describe, it, expect } from "vitest";
import { turnResistanceChanges } from "../module/scripts/core/turn-resistance.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("turnResistanceChanges", () => {
  it("un changement par type du coup, dans la forme de dnd5e", () => {
    expect(turnResistanceChanges(["slashing", "fire"])).toEqual([
      { key: "system.traits.dr.value", type: "add", value: "slashing", phase: "initial" },
      { key: "system.traits.dr.value", type: "add", value: "fire", phase: "initial" }]);
  });
  it("rien pour un type déjà résisté ou auquel le porteur est immunisé, ni en double", () => {
    expect(turnResistanceChanges(["fire", "fire", "cold"], { resisted: new Set(["fire"]), immune: ["cold"] })).toEqual([]);
    expect(turnResistanceChanges(["fire", "cold"], { resisted: ["fire"] }).map(c => c.value)).toEqual(["cold"]);
    expect(turnResistanceChanges([])).toEqual([]);
    expect(turnResistanceChanges(undefined)).toEqual([]);
  });
});

describe("l'étape `resist` et l'entrée", () => {
  it("demande une réaction à un coup, comme `halve`", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "resist" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "resist" }] }] }))
      .toEqual(["triggers[0].do: \"resist\" requires the isHit or allyIsHit moment and a \"use\" reaction"]);
  });
  it("Défense supérieure du chasseur", () => {
    expect(CONTENT["superior-hunters-defense"]).toEqual({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "resist" }] }] });
    expect(validateEntry(CONTENT["superior-hunters-defense"])).toEqual([]);
  });
});

describe("placesOwnResistance — les effets de l'activité ne sont pas posés quand l'étape pose la Résistance", () => {
  it("l'activité de réaction de l'entrée, ou celle que l'étape `use` nomme", async () => {
    const { placesOwnResistance } = await import("../module/scripts/core/turn-resistance.mjs");
    expect(placesOwnResistance(CONTENT["superior-hunters-defense"], "KAgnJeRtqjDeYJ2S")).toBe(true);
    const named = { triggers: [{ on: "isHit", do: [{ type: "use", activity: "aaaaaaaaaaaaaaaa" }, { type: "resist" }] }] };
    expect(placesOwnResistance(named, "aaaaaaaaaaaaaaaa")).toBe(true);
    expect(placesOwnResistance(named, "bbbbbbbbbbbbbbbb")).toBe(false);
  });
  it("une réaction sans `resist` (Esquive instinctive), ou pas d'entrée : non", async () => {
    const { placesOwnResistance } = await import("../module/scripts/core/turn-resistance.mjs");
    expect(placesOwnResistance({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "halve" }] }] }, "aaaaaaaaaaaaaaaa")).toBe(false);
    expect(placesOwnResistance(null, "aaaaaaaaaaaaaaaa")).toBe(false);
  });
});
