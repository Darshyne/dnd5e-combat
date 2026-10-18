import { describe, it, expect } from "vitest";
import { localizeEffectNames, retranslateItem, retranslateActor } from "../module/scripts/core/localize.mjs";

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

describe("textes restés dans la langue d'origine (§203)", () => {
  const original = {
    name: "Walloping Ammunition", description: "<p>A creature hit…</p>", chat: "",
    effects: { "Walloping Ammunition": { name: "Walloping Ammunition", description: "" } },
    activities: { act1: { name: "Walloping Save", condition: "on hit with this ammunition", chatFlavor: "Target is prone." } }
  };
  const translated = {
    name: "Projectile percutant", system: {
      description: { value: "<p>Une créature touchée…</p>", chat: "" },
      activities: { act1: { name: "Sauvegarde percutante", activation: { condition: "quand ce projectile touche" }, description: { chatFlavor: "La cible est à terre." } } }
    },
    effects: [{ _id: "eff1", name: "Projectile percutant", description: "" }]
  };
  const english = () => ({
    name: "Walloping Ammunition", system: {
      description: { value: "<p>A creature hit…</p>", chat: "" },
      activities: { act1: { name: "Walloping Save", activation: { condition: "on hit with this ammunition" }, description: { chatFlavor: "Target is prone." } } }
    },
    effects: [{ _id: "eff1", name: "Walloping Ammunition", description: "" }]
  });

  it("un objet resté en anglais reprend nom, description, activités et effets traduits", () => {
    const { update, effects } = retranslateItem(english(), original, translated);
    expect(update).toEqual({
      name: "Projectile percutant", "system.description.value": "<p>Une créature touchée…</p>",
      "system.activities.act1.name": "Sauvegarde percutante",
      "system.activities.act1.activation.condition": "quand ce projectile touche",
      "system.activities.act1.description.chatFlavor": "La cible est à terre."
    });
    expect(effects).toEqual([{ _id: "eff1", name: "Projectile percutant" }]);
  });
  it("le cas de table : nom traduit, effet resté en anglais — seul l'effet change", () => {
    const item = english();
    Object.assign(item, { name: "Projectile percutant" });
    item.system.description.value = "<p>Une créature touchée…</p>";
    item.system.activities = translated.system.activities;
    const { update, effects } = retranslateItem(item, original, translated);
    expect(update).toEqual({});
    expect(effects).toEqual([{ _id: "eff1", name: "Projectile percutant" }]);
  });
  it("un texte modifié à la main, un champ vide ou déjà traduit ne sont jamais repris", () => {
    const item = english();
    item.name = "Flèche de Laurent";
    item.system.description.value = "<p>Ma description</p>";
    const { update } = retranslateItem(item, original, translated);
    expect(update.name).toBeUndefined();
    expect(update["system.description.value"]).toBeUndefined();
    expect(update["system.description.chat"]).toBeUndefined();
  });
  it("un effet sans id commun n'est apparié que s'il est le seul des deux côtés", () => {
    const item = english();
    item.effects = [{ _id: "autre", name: "Walloping Ammunition", description: "" }];
    expect(retranslateItem(item, original, translated).effects).toEqual([{ _id: "autre", name: "Projectile percutant" }]);
    const two = { ...translated, effects: [...translated.effects, { _id: "eff2", name: "Autre" }] };
    expect(retranslateItem(item, original, two).effects).toEqual([]);
  });
  it("un acteur : nom, biographie et nom du token prototype qui suivait le nom d'origine", () => {
    const { update } = retranslateActor(
      { name: "Otherworldly Steed", system: { details: { biography: { value: "" } } }, prototypeToken: { name: "Otherworldly Steed" } },
      { name: "Otherworldly Steed", biography: "" },
      { name: "Destrier d'outre-monde", prototypeToken: { name: "Destrier d'outre-monde" }, system: { details: { biography: { value: "" } } } });
    expect(update).toEqual({ name: "Destrier d'outre-monde", "prototypeToken.name": "Destrier d'outre-monde" });
  });
  it("une fiche renommée à la main garde son nom et son token", () => {
    const { update } = retranslateActor(
      { name: "Gray Ooze Glob", prototypeToken: { name: "Gray Ooze" } }, { name: "Gray Ooze" },
      { name: "Vase grise", prototypeToken: { name: "Vase grise" } });
    expect(update).toEqual({});
  });
  it("sans charge d'origine (référence non traduite) : rien", () => {
    expect(retranslateItem(english(), null, translated).update).toEqual({});
    expect(retranslateActor({ name: "X" }, null, { name: "Y" }).update).toEqual({});
  });
});
