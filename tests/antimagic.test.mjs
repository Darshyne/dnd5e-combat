import { describe, it, expect } from "vitest";
import { isMagicalSource, isMagicalUse, shouldMarkMagical, ANTIMAGIC_STATUS, ANTIMAGIC_BEHAVIOR } from "../module/scripts/core/antimagic.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

/** §436 : l'antimagie de dnd5e 6.1 — ce qui est magique, ce que le champ interdit, ce que le moteur marque. */
describe("§436 : antimagie", () => {
  it("les noms du système", () => {
    expect(ANTIMAGIC_STATUS).toBe("antimagic");
    expect(ANTIMAGIC_BEHAVIOR).toBe("dnd5e.antimagic");
  });

  it("une source magique : sort, parchemin, item mgc (règle de la migration de dnd5e), capacité dite magique", () => {
    expect(isMagicalSource({ type: "spell" })).toBe(true);
    expect(isMagicalSource({ type: "consumable", subtype: "scroll" })).toBe(true);
    expect(isMagicalSource({ type: "consumable", subtype: "potion", properties: ["mgc"] })).toBe(true);
    expect(isMagicalSource({ type: "weapon", properties: ["fin", "mgc"] })).toBe(true);
    expect(isMagicalSource({ type: "weapon", properties: ["fin"] })).toBe(false);
    expect(isMagicalSource({ type: "feat" })).toBe(false);
    expect(isMagicalSource({ type: "feat", magical: true })).toBe(true);
    expect(isMagicalSource(null)).toBe(false);
  });

  it("une utilisation magique : un sort lancé, une activité d'objet magique, pas l'attaque d'une arme magique", () => {
    expect(isMagicalUse({ spellCast: true, item: { type: "spell" }, activityType: "attack" })).toBe(true);
    expect(isMagicalUse({ item: { type: "consumable", subtype: "potion", properties: ["mgc"] }, activityType: "heal" })).toBe(true);
    expect(isMagicalUse({ item: { type: "weapon", properties: ["mgc"] }, activityType: "attack" })).toBe(false);
    expect(isMagicalUse({ item: { type: "weapon", properties: ["mgc"] }, activityType: "utility" })).toBe(true);
    expect(isMagicalUse({ item: { type: "weapon", properties: [] }, activityType: "attack" })).toBe(false);
    expect(isMagicalUse({ item: { type: "feat" }, activityType: "damage" })).toBe(false);
    expect(isMagicalUse({ item: { type: "feat" }, activityType: "cast" })).toBe(true);
    expect(isMagicalUse({ item: { type: "feat", magical: true }, activityType: "save" })).toBe(true);
  });

  it("la marque magique : effet ordinaire d'une source magique, ni état, ni concentration, ni déjà marqué", () => {
    const spell = { type: "spell" };
    expect(shouldMarkMagical({ type: "base" }, spell)).toBe(true);
    expect(shouldMarkMagical({}, spell)).toBe(true);
    expect(shouldMarkMagical({ type: "base", statuses: ["paralyzed"] }, spell)).toBe(true);
    expect(shouldMarkMagical({ type: "base", magical: true }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "enchantment" }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "base", statuses: ["concentrating"] }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "base", statuses: ["antimagic"] }, spell)).toBe(false);
    expect(shouldMarkMagical({ type: "base" }, { type: "feat" })).toBe(false);
    expect(shouldMarkMagical({ type: "base" }, null)).toBe(false);
  });
});

describe("§436 : le contenu de l'antimagie", () => {
  it("capacités de monstres magiques, zones antimagie, durée du Cône", () => {
    for ( const id of ["eye-rays", "teleport", "etherealness", "possession", "telekinetic-thrust"] ) expect(SHIPPED[id].magical).toBe(true);
    expect(SHIPPED["shape-shift"]?.magical).toBeUndefined();
    expect(SHIPPED["antimagic-field"].antimagicZone).toBe(true);
    expect(SHIPPED["antimagic-cone"]).toMatchObject({ antimagicZone: true, zoneLasts: { seconds: 6 } });
    expect(SHIPPED["antimagic-field"].globe.everywhere).toBe(true);
  });

  it("le schéma accepte les deux clés, et seulement à true", () => {
    expect(validateEntry({ magical: true, antimagicZone: true })).toEqual([]);
    expect(validateEntry({ magical: "yes" }).length).toBeGreaterThan(0);
  });
});
