/** §276 : provenance d'un objet pour les réparations du diagnostic — un autre module officiel n'est jamais remplacé par un homonyme. */
import { describe, it, expect } from "vitest";
import { sourceKind } from "../module/scripts/core/item-sources.mjs";

describe("provenance d'un objet (diagnostic)", () => {
  it("Manuel des joueurs, Manuel des monstres, dnd5e : référence", () => {
    expect(sourceKind("Compendium.dnd-players-handbook.classes.Item.phbftrSurvivor00")).toBe("reference");
    expect(sourceKind("Compendium.dnd-monster-manual.actors.Actor.mmGoblinBoss0000.Item.x")).toBe("reference");
    expect(sourceKind("Compendium.dnd5e.spells24.Item.abc")).toBe("reference");
  });

  it("un autre module officiel (Ravenloft, Guide du maître) : premium, à garder", () => {
    expect(sourceKind("Compendium.dnd-ravenloft-horrors-within.options.Item.rhwSurvivor2zrM3")).toBe("premium");
    expect(sourceKind("Compendium.dnd-dungeon-masters-guide.equipment.Item.x")).toBe("premium");
  });

  it("module tiers, import ou monde : à reprendre ; sans source : rien", () => {
    expect(sourceKind("Compendium.chris-premades.CPRSpells.Item.x")).toBe("other");
    expect(sourceKind("Compendium.world.ddb-dandd-ddb-monsters.Actor.a.Item.b")).toBe("other");
    expect(sourceKind("Compendium.dnd5e-combat.basics.Item.x")).toBe("other");
    expect(sourceKind("")).toBe("none");
    expect(sourceKind(undefined)).toBe("none");
  });
});
