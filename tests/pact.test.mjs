import { describe, it, expect } from "vitest";
import { rewritePactChanges } from "../module/scripts/core/pact.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const PHB = [
  { key: "name", type: "add", value: ", Pact Weapon" },
  { key: "system.proficient", type: "override", value: 1 },
  { key: "system.properties", type: "add", value: "foc" },
  ...["necrotic", "psychic", "radiant"].flatMap(t => [
    { key: "system.damage.base.types", type: "add", value: t },
    { key: "system.damage.versatile.types", type: "add", value: t }
  ])
];
const rule = { damageTypes: ["necrotic", "psychic", "radiant"], ability: "spellcasting", suffix: " (arme de pacte)" };

describe("arme de pacte : l'enchantement réécrit", () => {
  it("sans type imposé : les types ajoutés restent (choix à chaque attaque), Charisme, nom", () => {
    const out = rewritePactChanges(PHB, { ...rule, chosen: null });
    expect(out.filter(c => c.key === "system.damage.base.types").map(c => c.value)).toEqual(["necrotic", "psychic", "radiant"]);
    expect(out.find(c => c.key === "name").value).toBe(" (arme de pacte)");
    expect(out.find(c => c.key === "activities[attack].attack.ability")).toMatchObject({ type: "override", value: "spellcasting" });
    expect(out.find(c => c.key === "system.proficient")).toBeTruthy();
  });
  it("radiant : le type remplace celui de l'arme (base et polyvalent)", () => {
    const out = rewritePactChanges(PHB, { ...rule, chosen: "radiant" }).filter(c => c.key.startsWith("system.damage"));
    expect(out).toEqual([
      { key: "system.damage.base.types", type: "override", value: "radiant", phase: "initial" },
      { key: "system.damage.versatile.types", type: "override", value: "radiant", phase: "initial" }
    ]);
  });
  it("schéma", () => {
    expect(validateEntry({ enchantTarget: "ownWeapon", pact: { damageTypes: ["radiant"], ability: "spellcasting" } })).toEqual([]);
    expect(validateEntry({ pact: { damageTypes: [] } })).toEqual(["pact.damageTypes : liste de types de dégâts"]);
  });
});
