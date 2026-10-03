import { describe, it, expect } from "vitest";
import { normalize, holds, unknownFacts, select, stepsOf, MOMENTS } from "../module/scripts/core/triggers.mjs";
import { STEP_TYPES } from "../module/scripts/core/content.mjs";
import { TRIGGERS } from "../module/scripts/content/triggers.mjs";
import { eligibleReactions } from "../module/scripts/core/reaction.mjs";

const facts = {
  "activity.isAttack": true,
  "activity.type": "attack",
  "target.hasStatus": id => ["prone", "poisoned"].includes(id),
  "target.hasEffectFrom": id => id === "hex"
};

describe("conditions", () => {
  it("absente ou vraie : tient ; fausse : ne tient pas", () => {
    expect(holds(undefined, facts)).toBe(true);
    expect(holds(null, facts)).toBe(true);
    expect(holds(true, facts)).toBe(true);
    expect(holds(false, facts)).toBe(false);
  });

  it("compare un fait-valeur strictement, ou dans une liste", () => {
    expect(holds({ "activity.type": "attack" }, facts)).toBe(true);
    expect(holds({ "activity.type": "save" }, facts)).toBe(false);
    expect(holds({ "activity.type": ["save", "attack"] }, facts)).toBe(true);
    expect(holds({ "activity.isAttack": 1 }, facts)).toBe(false);   // pas de conversion
  });

  it("appelle un fait-fonction avec l'argument", () => {
    expect(holds({ "target.hasStatus": "prone" }, facts)).toBe(true);
    expect(holds({ "target.hasStatus": "stunned" }, facts)).toBe(false);
  });

  it("plusieurs clés = toutes ; all / any / not se combinent", () => {
    expect(holds({ "activity.isAttack": true, "target.hasEffectFrom": "hex" }, facts)).toBe(true);
    expect(holds({ "activity.isAttack": true, "target.hasEffectFrom": "hunters-mark" }, facts)).toBe(false);
    expect(holds({ any: [{ "target.hasStatus": "stunned" }, { "target.hasStatus": "prone" }] }, facts)).toBe(true);
    expect(holds({ all: [{ "target.hasStatus": "stunned" }, { "target.hasStatus": "prone" }] }, facts)).toBe(false);
    expect(holds({ not: { "target.hasStatus": "stunned" } }, facts)).toBe(true);
    expect(holds([{ "activity.isAttack": true }, { not: { "activity.type": "save" } }], facts)).toBe(true);
  });

  it("une clé inconnue rend la condition fausse, et se laisse lister", () => {
    expect(holds({ "moon.phase": "full" }, facts)).toBe(false);
    expect(holds({ any: [{ "moon.phase": "full" }, { "activity.isAttack": true }] }, facts)).toBe(true);
    expect(unknownFacts({ all: [{ "moon.phase": "full" }, { not: { "tide.high": true } }, { "activity.isAttack": true }] }, facts))
      .toEqual(["moon.phase", "tide.high"]);
    expect(unknownFacts({ "activity.isAttack": true }, facts)).toEqual([]);
  });
});

describe("déclarations", () => {
  it("se normalisent : `on` en liste, `if` et `do` présents, provenance ajoutée", () => {
    expect(normalize({ on: "isHit", do: [{ type: "use" }] }, { item: "I" })).toEqual({ item: "I", on: ["isHit"], if: null, do: [{ type: "use" }], via: null });
    expect(normalize({ on: ["enter", null, "turnEnd"] })).toEqual({ on: ["enter", "turnEnd"], if: null, do: [], via: null });
  });

  it("select : le moment ET la condition", () => {
    const declared = [
      normalize({ on: "preDamageRoll", if: { "target.hasEffectFrom": "hex" }, do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }] }, { name: "Maléfice" }),
      normalize({ on: "preDamageRoll", if: { "target.hasEffectFrom": "hunters-mark" }, do: [{ type: "damage", formula: "1d6", damageType: "force" }] }, { name: "Marque" }),
      normalize({ on: "isHit", do: [{ type: "use" }] }, { name: "Bouclier" })
    ];
    expect(select(declared, "preDamageRoll", facts).map(d => d.name)).toEqual(["Maléfice"]);
    expect(select(declared, "isHit", facts).map(d => d.name)).toEqual(["Bouclier"]);
    expect(select(declared, "turnEnd", facts)).toEqual([]);
    expect(stepsOf(declared[0], "damage")).toEqual([{ type: "damage", formula: "1d6", damageType: "necrotic" }]);
    expect(stepsOf(declared[0], "use")).toEqual([]);
  });

  it("le budget de réaction filtre après la sélection", () => {
    const shield = normalize({ on: "isHit", do: [{ type: "use" }] }, { name: "Bouclier" });
    expect(eligibleReactions([shield], "isHit", { reactionAvailable: true })).toHaveLength(1);
    expect(eligibleReactions([shield], "isHit", { reactionAvailable: false })).toHaveLength(0);
  });
});

describe("contenu livré", () => {
  const all = Object.entries(TRIGGERS).flatMap(([id, list]) => list.map(d => ({ id, ...normalize(d) })));

  it("ne s'accroche qu'à des moments connus, avec des étapes connues", () => {
    for ( const d of all ) {
      for ( const m of d.on ) expect(Object.keys(MOMENTS), `${d.id} : moment ${m}`).toContain(m);
      for ( const s of d.do ) expect(STEP_TYPES, `${d.id} : étape ${s.type}`).toContain(s.type);
      expect(d.do.length, `${d.id} : aucune étape`).toBeGreaterThan(0);
    }
  });

  it("n'emploie que des faits que l'adaptateur fournit", () => {
    // Les clés de adapter/facts.mjs, `factsFor` — à tenir à jour avec lui (tests/content.test.mjs les redit).
    const provided = ["activity.type", "activity.isAttack", "activity.isSpell", "activity.isWeapon", "activity.identifier", "activity.id", "activity.hasProperty",
      "source.hasStatus", "source.hasEffect", "source.creatureType", "source.allyNearTarget", "source.summonNearTarget", "source.seesTarget",
      "target.hasStatus", "target.hasEffect", "target.hasEffectFrom", "target.sizeAtMost", "target.within", "target.seesSource",
      "target.creatureType", "target.immuneTo", "activity.isMelee", "target.hasTempHp", "damage.hasType", "target.hpAtMost"];
    const known = Object.fromEntries(provided.map(k => [k, true]));
    for ( const d of all ) expect(unknownFacts(d.if, known), d.id).toEqual([]);
  });

  it("Maléfice : dégâts bonus sur la cible marquée par CE lanceur, sur une attaque seulement", () => {
    const [hex] = select(all.filter(d => d.id === "hex"), "preDamageRoll", facts);
    expect(stepsOf(hex, "damage")).toEqual([{ type: "damage", formula: "1d6", damageType: "necrotic" }]);
    expect(select(all.filter(d => d.id === "hex"), "preDamageRoll", { ...facts, "activity.isAttack": false })).toEqual([]);
    expect(select(all.filter(d => d.id === "hex"), "preDamageRoll", { ...facts, "target.hasEffectFrom": () => false })).toEqual([]);
  });

  it("Bouclier et Représailles infernales : les mêmes fenêtres qu'avant, la cible en plus", () => {
    expect(select(all.filter(d => d.id === "shield"), "isHit")).toHaveLength(1);
    const sees = { "target.seesSource": want => want === true };
    const [rebuke] = select(all.filter(d => d.id === "hellish-rebuke"), "isDamaged", sees);
    expect(stepsOf(rebuke, "use")[0].target).toBe("source");
  });

  it("Représailles infernales exige de voir qui vous a blessé (P1) ; Bouclier, non", () => {
    const blind = { "target.seesSource": want => want === false };
    expect(select(all.filter(d => d.id === "hellish-rebuke"), "isDamaged", blind)).toHaveLength(0);
    expect(select(all.filter(d => d.id === "shield"), "isHit", blind)).toHaveLength(1);
  });

  it("zones : Rayon de lune agit à l'entrée et en fin de tour ; la Sphère de feu n'est pas une zone (§16.15 : pulse)", () => {
    const on = id => all.filter(d => d.id === id).flatMap(d => d.on);
    expect(on("moonbeam")).toEqual(["enter", "turnEnd"]);
    expect(on("flaming-sphere")).toEqual([]);
  });
});

import { OUTCOME_MOMENTS, TURN_MOMENTS } from "../module/scripts/core/triggers.mjs";

describe("briques (SPEC §16) : moments d'issue et de tour, via", () => {
  it("les moments d'issue et de tour sont connus du registre", () => {
    for ( const m of [...OUTCOME_MOMENTS, ...TURN_MOMENTS] ) expect(MOMENTS[m]).toBeTruthy();
    expect(OUTCOME_MOMENTS).toEqual(["hit", "failedSave"]);
    expect(MOMENTS.preAttackRoll).toBeTruthy();
    expect(MOMENTS.castsSpell).toBeTruthy();
    expect(MOMENTS.isAttacked).toBeTruthy();
    expect(TURN_MOMENTS).toEqual(["startOfTurn", "endOfTurn"]);
  });

  it("normalize : via vaut null par défaut, sinon ce qui est déclaré", () => {
    expect(normalize({ on: "endOfTurn", do: [{ type: "resave" }] }).via).toBe(null);
    expect(normalize({ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }).via).toBe("effect");
  });

  it("select : une déclaration « via effect » se sélectionne comme les autres, par moment", () => {
    const d = normalize({ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }, { effect: "E1" });
    expect(select([d], "endOfTurn", facts)).toEqual([d]);
    expect(select([d], "turnEnd", facts)).toEqual([]);
    expect(stepsOf(d, "resave")).toEqual([{ type: "resave" }]);
  });
});
