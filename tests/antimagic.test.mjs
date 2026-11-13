import { describe, it, expect } from "vitest";
import { isMagicalSource, isMagicalUse, shouldMarkMagical, ANTIMAGIC_STATUS, ANTIMAGIC_BEHAVIOR } from "../module/scripts/core/antimagic.mjs";

/** §436 : l'antimagie de dnd5e 6.1 — ce qui est magique, ce que le champ interdit, ce que le moteur marque. */
describe("§436 : antimagie", () => {
  it("les noms du système", () => {
    expect(ANTIMAGIC_STATUS).toBe("antimagic");
    expect(ANTIMAGIC_BEHAVIOR).toBe("dnd5e.antimagic");
  });

  it("une source magique : sort, parchemin, item mgc (règle de la migration de dnd5e)", () => {
    expect(isMagicalSource({ type: "spell" })).toBe(true);
    expect(isMagicalSource({ type: "consumable", subtype: "scroll" })).toBe(true);
    expect(isMagicalSource({ type: "consumable", subtype: "potion", properties: ["mgc"] })).toBe(true);
    expect(isMagicalSource({ type: "weapon", properties: ["fin", "mgc"] })).toBe(true);
    expect(isMagicalSource({ type: "weapon", properties: ["fin"] })).toBe(false);
    expect(isMagicalSource({ type: "feat" })).toBe(false);
    expect(isMagicalSource(null)).toBe(false);
  });

  it("une utilisation magique : un sort lancé, une activité d'objet magique, pas l'attaque d'une arme magique", () => {
    expect(isMagicalUse({ spellCast: true, item: { type: "spell" }, activityType: "attack" })).toBe(true);
    expect(isMagicalUse({ item: { type: "consumable", subtype: "potion", properties: ["mgc"] }, activityType: "heal" })).toBe(true);
    expect(isMagicalUse({ item: { type: "weapon", properties: ["mgc"] }, activityType: "attack" })).toBe(false);
    expect(isMagicalUse({ item: { type: "weapon", properties: ["mgc"] }, activityType: "utility" })).toBe(true);
    expect(isMagicalUse({ item: { type: "weapon", properties: [] }, activityType: "attack" })).toBe(false);
    expect(isMagicalUse({ item: { type: "feat" }, activityType: "damage" })).toBe(false);
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
