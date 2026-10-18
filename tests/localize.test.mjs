import { describe, it, expect } from "vitest";
import { localizeEffectNames } from "../module/scripts/core/localize.mjs";

describe("effets recopiés du compendium par le diagnostic (§202)", () => {
  const effects = [{ _id: "a", name: "Walloping Ammunition" }, { _id: "b", name: "Prone" }];
  it("un effet au nom d'origine de l'objet prend son nom traduit, les autres ne changent pas", () => {
    expect(localizeEffectNames(effects, "Walloping Ammunition", "Projectile percutant").map(e => e.name)).toEqual(["Projectile percutant", "Prone"]);
  });
  it("sans nom d'origine (pas de traduction), ou un nom inchangé : rien", () => {
    expect(localizeEffectNames(effects, null, "Projectile percutant").map(e => e.name)).toEqual(["Walloping Ammunition", "Prone"]);
    expect(localizeEffectNames(effects, "Walloping Ammunition", "Walloping Ammunition").map(e => e.name)).toEqual(["Walloping Ammunition", "Prone"]);
  });
  it("ne modifie pas les données d'origine", () => {
    localizeEffectNames(effects, "Walloping Ammunition", "Projectile percutant");
    expect(effects[0].name).toBe("Walloping Ammunition");
  });
});
