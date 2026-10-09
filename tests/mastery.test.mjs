import { describe, it, expect } from "vitest";
import { masteryEffect, grazeDamage, toppleDC, cleaveModifier, markExpires, MASTERIES } from "../module/scripts/core/mastery.mjs";

const hit = { hit: true, damaged: true, melee: true, size: "med", down: false };
const miss = { ...hit, hit: false, damaged: false };

describe("§21 bottes d'arme : ce que fait chacune", () => {
  it("Écorchure : seulement sur un raté", () => {
    expect(masteryEffect("graze", miss)).toBe("graze");
    expect(masteryEffect("graze", hit)).toBe(null);
  });
  it("Sape, Renversement : sur un coup ; Ralentissement, Ouverture : sur un coup qui blesse", () => {
    expect(masteryEffect("sap", hit)).toBe("sap");
    expect(masteryEffect("topple", hit)).toBe("topple");
    expect(masteryEffect("slow", hit)).toBe("slow");
    expect(masteryEffect("vex", hit)).toBe("vex");
    expect(masteryEffect("slow", { ...hit, damaged: false })).toBe(null);
    expect(masteryEffect("vex", { ...hit, damaged: false })).toBe(null);
    for ( const m of ["sap", "topple", "slow", "vex", "push", "cleave"] ) expect(masteryEffect(m, miss)).toBe(null);
  });
  it("Poussée : taille G ou moins", () => {
    expect(masteryEffect("push", { ...hit, size: "lg" })).toBe("push");
    expect(masteryEffect("push", { ...hit, size: "huge" })).toBe(null);
  });
  it("Enchaînement : au corps à corps, une fois par tour", () => {
    expect(masteryEffect("cleave", hit)).toBe("cleave");
    expect(masteryEffect("cleave", { ...hit, melee: false })).toBe(null);
    expect(masteryEffect("cleave", { ...hit, cleaveSpent: true })).toBe(null);
  });
  it("une cible à 0 PV : rien, sauf Enchaînement et Écorchure", () => {
    for ( const m of ["sap", "topple", "slow", "vex", "push"] ) expect(masteryEffect(m, { ...hit, down: true })).toBe(null);
    expect(masteryEffect("cleave", { ...hit, down: true })).toBe("cleave");
  });
  it("Coup double et inconnues : rien ici", () => {
    expect(masteryEffect("nick", hit)).toBe(null);
    expect(masteryEffect(null, hit)).toBe(null);
    expect(MASTERIES).toHaveLength(8);
  });
});

describe("§21 bottes d'arme : nombres", () => {
  it("Écorchure = le modificateur, rien s'il est nul ou négatif", () => {
    expect(grazeDamage(4)).toBe(4);
    expect(grazeDamage(0)).toBe(0);
    expect(grazeDamage(-1)).toBe(0);
  });
  it("Renversement : DD 8 + modificateur + maîtrise", () => expect(toppleDC(4, 2)).toBe(14));
  it("Enchaînement : sans le modificateur, sauf s'il est négatif", () => {
    expect(cleaveModifier(3)).toBe(0);
    expect(cleaveModifier(-1)).toBe(-1);
  });
});

describe("§21 marques : quand elles tombent", () => {
  const e = (moment, sourceTurn, turnKey=null) => ({ moment, sourceTurn, turnKey, placedOn: "c.1.0" });
  it("Sape et Ralentissement : au début du prochain tour de l'attaquant", () => {
    expect(markExpires("sap", e("turnStart", true))).toBe(true);
    expect(markExpires("slow", e("turnStart", true))).toBe(true);
    expect(markExpires("sap", e("turnEnd", true, "c.1.0"))).toBe(false);
    expect(markExpires("sap", e("turnStart", false))).toBe(false);
  });
  it("Ouverture : à la fin de son prochain tour, pas de celui où elle a été posée", () => {
    expect(markExpires("vex", e("turnEnd", true, "c.1.0"))).toBe(false);
    expect(markExpires("vex", e("turnEnd", true, "c.2.0"))).toBe(true);
    expect(markExpires("vex", e("turnStart", true))).toBe(false);
  });
});

import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§21 Guerrier : schéma et contenu", () => {
  it("les clés nouvelles", () => {
    expect(validateEntry({ grantsAction: true, movesAfter: "second-wind", studiedAttacks: true, heroicWarrior: true, greatWeaponFighting: true, thrownDamage: 2 })).toEqual([]);
    expect(validateEntry({ movesAfter: "" })).toEqual(["movesAfter: item identifier, or { item, disengage? }"]);
    expect(validateEntry({ movesAfter: { item: "rage", disengage: false } })).toEqual([]);
    expect(validateEntry({ thrownDamage: 0 })).toEqual(["thrownDamage: positive integer"]);
  });
  it("le contenu livré", () => {
    expect(CONTENT["action-surge"].grantsAction).toBe(true);
    expect(CONTENT["tactical-shift"].movesAfter).toBe("second-wind");
    expect(CONTENT["studied-attacks"].studiedAttacks).toBe(true);
    expect(CONTENT["thrown-weapon-fighting"].thrownDamage).toBe(2);
  });
  it("Attaques avisées tombent comme l'Ouverture", () => {
    expect(markExpires("studied", { moment: "turnEnd", sourceTurn: true, turnKey: "c.1.0", placedOn: "c.1.0" })).toBe(false);
    expect(markExpires("studied", { moment: "turnEnd", sourceTurn: true, turnKey: "c.2.0", placedOn: "c.1.0" })).toBe(true);
  });
});

describe("§22 Barbare : schéma, contenu, Témérité", () => {
  it("les clés nouvelles", () => {
    expect(validateEntry({ rage: { effect: "G5XZTi4zYTFiHVll" }, persistentRage: true, reckless: true, relentless: { activity: "dnd5eactivity100" } })).toEqual([]);
    expect(validateEntry({ rage: { effect: "court" } })).toEqual(["rage: { effect } (effect id)"]);
    expect(validateEntry({ relentless: {} })).toEqual(["relentless: { activity } (activity id)"]);
  });
  it("le contenu livré", () => {
    expect(CONTENT.rage.rage.effect).toBe("G5XZTi4zYTFiHVll");
    expect(CONTENT["instinctive-pounce"].movesAfter).toEqual({ item: "rage", disengage: false });
    expect(CONTENT.frenzy.triggers[0].oncePerTurn).toBe(true);
    expect(CONTENT["divine-fury"].triggers[0].do[0]).toEqual({ type: "damage", formula: "1d6 + floor(@classes.barbarian.levels / 2)", damageType: "radiant" });
  });
  it("la Témérité tombe au début de son prochain tour", () => {
    expect(markExpires("reckless", { moment: "turnStart", sourceTurn: true, turnKey: null, placedOn: "c.1.0" })).toBe(true);
    expect(markExpires("reckless", { moment: "turnEnd", sourceTurn: true, turnKey: "c.1.0", placedOn: "c.1.0" })).toBe(false);
  });
});

describe("§23 tours de magie : schéma et contenu", () => {
  it("les clés nouvelles", () => {
    expect(validateEntry({ effectEnds: { zwks0mAqBHGZC1Pk: "casterTurnEnd" }, blocksHealing: true, noOpportunityAttacks: true, oneAttack: true,
      byWounds: { healthy: "LFXYm5sLg6D3ZilN", wounded: "w9KUTNVoj3K8XSlv" }, breaksOn: ["save"] })).toEqual([]);
    expect(validateEntry({ effectEnds: { zwks0mAqBHGZC1Pk: "nextWeek" } })).toEqual(["effectEnds.zwks0mAqBHGZC1Pk: casterTurnStart, casterTurnEnd, bearerTurnStart, bearerTurnEnd"]);
    expect(validateEntry({ byWounds: { healthy: "LFXYm5sLg6D3ZilN" } })).toEqual(["byWounds: { healthy, wounded } (activity ids)"]);
  });
  it("le contenu livré", () => {
    expect(CONTENT["chill-touch"]).toMatchObject({ blocksHealing: true, effectEnds: { zwks0mAqBHGZC1Pk: "casterTurnEnd" } });
    expect(CONTENT["ray-of-frost"].effectEnds).toEqual({ "7dnnwBMWLykrVJub": "casterTurnStart" });
    expect(CONTENT["mind-sliver"].breaksOn).toEqual(["save"]);
    expect(CONTENT["shocking-grasp"].noOpportunityAttacks).toBe(true);
    // Moquerie cruelle garde sa marque consommée (§16.12) et reçoit sa fin de durée.
    expect(CONTENT["vicious-mockery"].triggers[0].do.map(s => s.type)).toEqual(["disadvantage", "consume"]);
    expect(CONTENT["vicious-mockery"].effectEnds).toEqual({ suEeAQQXl0X2JqzF: "casterTurnEnd" });
    expect(CONTENT.friends.targets.types).toEqual(["humanoid"]);
    expect(CONTENT["true-strike"]).toMatchObject({ enchantTarget: "ownWeapon", oneAttack: true });
  });
});

import { open, advance, applicationPlan, STEPS } from "../module/scripts/core/action.mjs";

describe("§24 Moine : Parade et schéma", () => {
  const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
  const base = { id: "r", carrier: "M", origin: "M", activity: "Act", source: "Src" };
  const roll = total => ({ total, isCritical: false, isFumble: false });
  it("Parade : la réaction réduit les dégâts de l'attaque d'un montant (plan d'application)", () => {
    let { resolution } = open({ ...base, plan: { attack: true, damage: "author" }, targets: [] });
    ({ resolution } = advance(resolution, { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { canReact: true }), T(2)] }));
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Parade", ac: 12, reduce: 8 }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, reduced: 8 });
    ({ resolution } = advance(resolution, { type: "damageRolled", messageId: "d", damages: [{ type: "slashing", value: 9, properties: [] }] }));
    const plan = applicationPlan(resolution);
    expect(plan[0]).toMatchObject({ token: "T1", multiplier: 1, reduction: 8 });
    expect(plan[1].reduction).toBeUndefined();
  });
  it("les clés nouvelles", () => {
    expect(validateEntry({ martialArts: true, flurry: { activity: "2ghJTBhilLrFn9xT", strikes: 2 },
      stunningStrike: { activity: "Xto99a8Zt46VLwaR", focus: "monks-focus" }, openHand: { addle: "1jdSaWanuRrdkVs3" },
      basicActions: { "7xj7b6e8tDznDSrE": ["disengage", "dodge"] } })).toEqual([]);
    expect(validateEntry({ flurry: { activity: "2ghJTBhilLrFn9xT" } })).toEqual(["flurry: { activity, strikes, weapons? }"]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "reduce" }] }] }))
      .toEqual(["triggers[0].do: \"reduce\" requires the isHit or allyIsHit moment and a \"use\" reaction"]);
  });
  it("le contenu livré", () => {
    expect(CONTENT["monks-focus"].basicActions["0MuRZ0Ur95xQTKFq"]).toEqual(["dash", "disengage"]);
    expect(CONTENT["deflect-attacks"].triggers[0].do.map(s => s.type)).toEqual(["use", "reduce"]);
    expect(CONTENT["stunning-strike"].savedEffects).toEqual(["cj9HhBNKtF6iOsH4"]);
  });
});
