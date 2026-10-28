/** §258 : fins génériques (`endsWhen`) relevées par l'audit CAT / CPR — décisions pures, schéma, contenu livré. */
import { describe, it, expect } from "vitest";
import { armorEnds, tooFarApart, nobodyAffected } from "../module/scripts/core/endings.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const target = (over={}) => ({ unaffected: null, hit: null, save: null, ...over });

describe("fins génériques — décisions", () => {
  it("armure : toute armure, ou seulement lourde ; un bouclier ne compte pas", () => {
    expect(armorEnds("any", "light")).toBe(true);
    expect(armorEnds("any", "shield")).toBe(false);
    expect(armorEnds("heavy", "medium")).toBe(false);
    expect(armorEnds("heavy", "heavy")).toBe(true);
  });

  it("distance : strictement au-delà de la limite", () => {
    expect(tooFarApart(60, 60)).toBe(false);
    expect(tooFarApart(65, 60)).toBe(true);
    expect(tooFarApart(NaN, 60)).toBe(false);
  });

  it("personne d'affecté : toutes les sauvegardes réussies", () => {
    const saved = { targets: [target({ save: { success: true } }), target({ save: { success: true } })] };
    expect(nobodyAffected(saved, "failedSave")).toBe(true);
    const one = { targets: [target({ save: { success: true } }), target({ save: { success: false } })] };
    expect(nobodyAffected(one, "failedSave")).toBe(false);
  });

  it("une sauvegarde pas encore jugée ne décide rien ; une cible inaffectable ne compte pas", () => {
    expect(nobodyAffected({ targets: [target()] }, "failedSave")).toBe(false);
    const immune = { targets: [target({ unaffected: { reason: "type" } }), target({ save: { success: true } })] };
    expect(nobodyAffected(immune, "failedSave")).toBe(true);
    expect(nobodyAffected({ targets: [target({ unaffected: { reason: "immune" } })] }, "noTargets")).toBe(true);
  });

  it("aucun coup au but", () => {
    expect(nobodyAffected({ targets: [target({ hit: false }), target({ hit: false })] }, "noHits")).toBe(true);
    expect(nobodyAffected({ targets: [target({ hit: false }), target({ hit: true })] }, "noHits")).toBe(false);
  });
});

describe("fins génériques — schéma", () => {
  it("accepte les quatre fins et `spell`", () => {
    expect(validateEntry({ endsWhen: { armor: "any" } })).toEqual([]);
    expect(validateEntry({ endsWhen: { apart: { distance: 30, units: "ft", at: "casterTurnEnd" }, zeroHp: true, spell: true } })).toEqual([]);
    expect(validateEntry({ endsWhen: { unaffected: "noHits" } })).toEqual([]);
  });
  it("refuse le reste", () => {
    expect(validateEntry({ endsWhen: {} })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { armor: "shield" } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { apart: { distance: 0, units: "ft" } } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { apart: { distance: 30, units: "ft", at: "never" } } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { unaffected: "nobody" } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { later: true } })).toHaveLength(1);
  });
});

describe("fins génériques — contenu livré", () => {
  it("Armure du mage, Rage, Lien de garde, Duel forcé", () => {
    expect(CONTENT["mage-armor"].endsWhen).toEqual({ armor: "any" });
    expect(CONTENT["rage"].endsWhen).toEqual({ armor: "heavy" });
    expect(CONTENT["rage"].rage).toBeTruthy();
    expect(CONTENT["warding-bond"].endsWhen).toEqual({ apart: { distance: 60, units: "ft" }, zeroHp: true, spell: true });
    expect(CONTENT["warding-bond"].triggers).toBeTruthy();
    expect(CONTENT["compelled-duel"].endsWhen.apart.at).toBe("casterTurnEnd");
    expect(CONTENT["compelled-duel"].endsWhen.casterTargetsOther).toBe(true);
    expect(CONTENT["compelled-duel"].endsWhen.allyDamages).toBe(true);
    expect(CONTENT["compelled-duel"].triggers).toBeTruthy();
  });
  it("les sorts de sauvegarde à concentration finissent quand personne n'est affecté", () => {
    for ( const id of ["hold-person", "banishment", "slow", "hypnotic-pattern", "polymorph"] ) {
      expect(CONTENT[id].endsWhen?.unaffected).toBe("failedSave");
      expect(validateEntry(CONTENT[id])).toEqual([]);
    }
  });
});

describe("§259 : invocations qui disparaissent à 0 PV", () => {
  it("les sorts d'invocation, Insecte géant, Destrier fidèle, Serviteur invisible", () => {
    for ( const id of ["summon-beast", "summon-undead", "giant-insect", "find-steed", "unseen-servant"] ) {
      expect(CONTENT[id].summon.vanishesAtZero).toBe(true);
      expect(validateEntry(CONTENT[id])).toEqual([]);
    }
    expect(CONTENT["find-steed"].summon.replaces).toBe(true);
    expect(CONTENT["animate-objects"].summon.vanishesAtZero).toBeUndefined();
  });
  it("schéma : true ou absent", () => {
    expect(validateEntry({ summon: { initiative: "after", vanishesAtZero: "oui" } })).toHaveLength(1);
  });
});

describe("§259 : Gardien de la foi, plafond de dégâts", () => {
  it("60 dégâts au total", () => {
    expect(CONTENT["guardian-of-faith"].summon.vanishesAfterDamage).toBe(60);
    expect(validateEntry(CONTENT["guardian-of-faith"])).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", vanishesAfterDamage: 0 } })).toHaveLength(1);
  });
});

describe("§261 : terrain difficile laissé par une zone instantanée", () => {
  it("Tempête de grêle, jusqu'à la fin du prochain tour du lanceur", () => {
    expect(CONTENT["ice-storm"].difficultTerrain).toEqual({ lingers: "casterNextTurnEnd" });
    expect(validateEntry(CONTENT["ice-storm"])).toEqual([]);
    expect(validateEntry({ difficultTerrain: { lingers: "forever" } })).toHaveLength(1);
  });
});

describe("§262 : Châtiment bannissant, sauvegarde sous 50 PV", () => {
  it("contenu et schéma", () => {
    expect(CONTENT["banishing-smite"].smite.saveAtMostHp).toBe(50);
    expect(validateEntry(CONTENT["banishing-smite"])).toEqual([]);
    expect(validateEntry({ smite: { damage: "CXmmXBTfen6D6LXY", saveAtMostHp: -1 } })).toHaveLength(1);
  });
});

describe("§263 : « chaque créature de votre choix » — les alliés épargnés", () => {
  it("Vague destructrice, Parole radieuse, Tir de barrage, Volée", () => {
    for ( const id of ["destructive-wave", "word-of-radiance", "conjure-barrage", "conjure-volley"] ) expect(CONTENT[id].zoneAffects).toBe("enemy");
  });
});

describe("§264 : téléportation avec passager", () => {
  it("Porte dimensionnelle emmène une créature à 1,50 m", () => {
    expect(CONTENT["dimension-door"].teleport.passengers).toEqual({ count: 1, within: 5, units: "ft" });
    expect(validateEntry(CONTENT["dimension-door"])).toEqual([]);
    expect(validateEntry({ teleport: { distance: 30, units: "ft", passengers: { count: 0 } } })).toHaveLength(1);
  });
});

describe("§265 : Bannissement réel", () => {
  it("les effets « Banni » déclarés", () => {
    expect(CONTENT["banishment"].banishes).toEqual(["nwne4bDtD4pSWWPM"]);
    expect(CONTENT["banishing-smite"].banishes).toEqual(["dAnHnTaGvsiN1WzK"]);
    expect(CONTENT["banishing-smite"].smite.saveAtMostHp).toBe(50);
    expect(validateEntry({ banishes: ["court"] })).toHaveLength(1);
  });
});

describe("§266 : Bouclier de feu éclaire", () => {
  it("3 m de lumière vive, 3 m de faible", () => {
    expect(CONTENT["fire-shield"].light).toEqual({ on: "effect", bright: 10, dim: 20, units: "ft" });
    expect(CONTENT["fire-shield"].choice).toBeTruthy();
    expect(validateEntry({ light: CONTENT["fire-shield"].light })).toEqual([]);
  });
});

describe("§267 : Lenteur, une seule attaque", () => {
  it("contenu", () => {
    expect(CONTENT["slow"].singleAttack).toBe(true);
    expect(CONTENT["slow"].actionOrBonus).toBe(true);
    expect(validateEntry({ singleAttack: "oui" })).toHaveLength(1);
  });
});

describe("§268 : Protection contre le Mal et le Bien écarte Charmé et Effrayé", () => {
  it("contenu et schéma", () => {
    expect(CONTENT["protection-from-evil-and-good"].wardsConditions.statuses).toEqual(["charmed", "frightened"]);
    expect(CONTENT["protection-from-evil-and-good"].wardsConditions.types).toContain("fiend");
    expect(CONTENT["protection-from-evil-and-good"].triggers).toBeTruthy();
    expect(validateEntry({ wardsConditions: { types: ["dragonkin"], statuses: ["charmed"] } })).toHaveLength(1);
  });
});

describe("§269 : Forme gazeuse, ni attaque ni sort", () => {
  it("contenu", () => {
    expect(CONTENT["gaseous-form"].noAttacksOrSpells).toBe(true);
    expect(CONTENT["gaseous-form"].actionEnds).toBeTruthy();
  });
});
