import { describe, it, expect } from "vitest";
import { holds } from "../module/scripts/core/triggers.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

/**
 * §431 : le SRD de dnd5e 6.1 renomme les options d'Impacts bénis (Clerc) et de Fureur élémentaire (Druide) — les deux Incantations
 * puissantes s'appellent `potent-spellcasting` — et déplace l'activité de Calcination des morts-vivants sur le Conduit divin. Les
 * anciennes fiches (Manuel premium, SRD 6.0) gardent les anciens identifiants : les deux formes comptent.
 */

/** Un acteur de test : ses classes et ses items (identifiant, classe d'origine, activités). */
const actorWith = (classes, items) => {
  const actor = { classes: Object.fromEntries(classes.map(c => [c, { identifier: c }])) };
  actor.items = items.map(({ id, cls=null, requirements="", activities=[] }) => {
    const acts = new Map(activities.map(a => [a, { id: a }]));
    const item = { name: id, actor, system: { identifier: id, classIdentifier: cls ?? undefined, requirements, activities: acts } };
    for ( const a of acts.values() ) { a.item = item; a.actor = actor; }
    return item;
  });
  return actor;
};

describe("§431 : la classe d'une aptitude au même identifiant (potent-spellcasting)", async () => {
  const { featureClassOf, hasClassFeature } = await import("../module/scripts/adapter/content.mjs");

  it("lit system.classIdentifier (6.1), puis l'item racine de l'avancement (6.0), puis requirements s'il nomme une classe de l'acteur", () => {
    expect(featureClassOf({ system: { classIdentifier: "druid" } })).toBe("druid");
    expect(featureClassOf({ system: { advancementRootItem: { type: "class", identifier: "cleric" } } })).toBe("cleric");
    expect(featureClassOf({ system: { advancementRootItem: { type: "subclass", system: { classIdentifier: "cleric" } } } })).toBe("cleric");
    expect(featureClassOf({ system: { requirements: "Druid" }, actor: { classes: { druid: {} } } })).toBe("druid");
    expect(featureClassOf({ system: { requirements: "Druide" }, actor: { classes: { druid: {} } } })).toBe(null);
  });

  it("l'option du Druide ne compte pas pour le Clerc, et l'inverse ; classe inconnue : celle de l'acteur", () => {
    const multi = actorWith(["cleric", "druid"], [{ id: "potent-spellcasting", cls: "druid" }]);
    expect(hasClassFeature(multi, "potent-spellcasting", "druid")).toBe(true);
    expect(hasClassFeature(multi, "potent-spellcasting", "cleric")).toBe(false);
    const loose = actorWith(["cleric"], [{ id: "potent-spellcasting" }]);
    expect(hasClassFeature(loose, "potent-spellcasting", "cleric")).toBe(true);
    expect(hasClassFeature(loose, "potent-spellcasting", "druid")).toBe(false);
    expect(hasClassFeature(actorWith(["druid"], [{ id: "elemental-fury-potent-spellcasting" }]),
      ["elemental-fury-potent-spellcasting", "potent-spellcasting"], "druid")).toBe(true);
  });

  it("§433 : un PNJ sans classe qui porte l'option — le texte `requirements` dit laquelle", () => {
    const npc = actorWith([], [{ id: "potent-spellcasting", requirements: "Druid" }]);
    expect(featureClassOf(npc.items[0])).toBe("druid");
    expect(hasClassFeature(npc, "potent-spellcasting", "druid")).toBe(true);
    expect(hasClassFeature(npc, "potent-spellcasting", "cleric")).toBe(false);
    // Un texte qui n'est pas un nom de classe seul (« Druid 7 », vide) ne dit rien.
    expect(featureClassOf(actorWith([], [{ id: "potent-spellcasting", requirements: "Circle of the Land" }]).items[0])).toBe(null);
    expect(hasClassFeature(actorWith([], [{ id: "potent-spellcasting" }]), "potent-spellcasting", "druid")).toBe(false);
  });
});

describe("§431 : Impact divin et Attaque primitive retirés par l'une ou l'autre forme de l'option", () => {
  const facts = (features, classFeatures=[]) => ({ "activity.isWeapon": () => true, "source.wildShaped": () => false, "activity.isAttack": () => true,
    "source.hasFeature": f => features.includes(f),
    "source.hasClassFeature": ({ id, class: cls }) => classFeatures.some(([i, c]) => [id].flat().includes(i) && (c === cls)) });

  it("le Clerc : ancien identifiant, ou `potent-spellcasting` du Clerc — pas celui du Druide", () => {
    const [basic] = SHIPPED["blessed-strikes"].triggers;
    expect(holds(basic.if, facts([]))).toBe(true);
    expect(holds(basic.if, facts(["blessed-strikes-potent-spellcasting"]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "cleric"]]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "druid"]]))).toBe(true);
  });

  it("le Druide : ancien identifiant, ou `potent-spellcasting` du Druide — pas celui du Clerc", () => {
    const [basic] = SHIPPED["elemental-fury"].triggers;
    expect(holds(basic.if, facts([]))).toBe(true);
    expect(holds(basic.if, facts(["elemental-fury-potent-spellcasting"]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "druid"]]))).toBe(false);
    expect(holds(basic.if, facts([], [["potent-spellcasting", "cleric"]]))).toBe(true);
  });

  it("aucune entrée `potent-spellcasting` : dnd5e 6.1 ajoute lui-même la Sagesse (effet de l'item), pas de bonus compté deux fois", () => {
    expect(SHIPPED["potent-spellcasting"]).toBeUndefined();
    expect(SHIPPED["blessed-strikes-potent-spellcasting"].triggers).toHaveLength(1);
    expect(SHIPPED["elemental-fury-potent-spellcasting"].triggers).toHaveLength(1);
  });

  it("Fureur élémentaire améliorée : la portée des sorts mineurs demande l'une ou l'autre forme", () => {
    expect(SHIPPED["improved-elemental-fury"].cantripRange.requires).toEqual(["elemental-fury-potent-spellcasting", "potent-spellcasting"]);
    const add = { value: 300, units: "ft" };
    expect(validateEntry({ cantripRange: { class: "druid", add, requires: ["a", "b"] } })).toEqual([]);
    expect(validateEntry({ cantripRange: { class: "druid", add, requires: [] } })).toHaveLength(1);
    expect(validateEntry({ cantripRange: { class: "druid", add, requires: ["a", 3] } })).toHaveLength(1);
  });
});

describe("§431 : Calcination des morts-vivants, ancienne et nouvelle forme", async () => {
  const { upgradeOf } = await import("../module/scripts/adapter/pick-targets.mjs");
  const TURN = "aOptL5pMaj3WtR8S", SEAR_OLD = "fW3U8L8Ca9a6O9Wx", SEAR_61 = "rprxorXdFoHbRERZ";
  const rule = SHIPPED["channel-divinity-cleric"].pickTargets;

  it("la liste s'ouvre aussi pour « Sear Undead » du Conduit divin (6.1), et la déclaration est valide", () => {
    expect(rule.activities).toEqual([TURN, SEAR_61]);
    expect(SHIPPED["channel-divinity"].pickTargets.activities).toEqual([TURN, SEAR_61]);
    expect(validateEntry({ pickTargets: rule })).toEqual([]);
    expect(validateEntry({ pickTargets: { ...rule, upgrade: [] } })).toHaveLength(1);
    expect(validateEntry({ pickTargets: { ...rule, upgrade: [{ item: "x", activity: SEAR_61, requires: "" }] } })).toHaveLength(1);
  });

  it("ancienne forme : l'activité de l'item Calcination", () => {
    const actor = actorWith(["cleric"], [{ id: "channel-divinity-cleric", activities: [TURN] }, { id: "sear-undead", activities: [SEAR_OLD] }]);
    const turn = actor.items[0].system.activities.get(TURN);
    expect(upgradeOf(turn, rule)?.id).toBe(SEAR_OLD);
  });

  it("forme 6.1 : l'activité du Conduit divin, seulement avec l'item Calcination (niveau 5), jamais elle-même", () => {
    const at5 = actorWith(["cleric"], [{ id: "channel-divinity-cleric", activities: [TURN, SEAR_61] }, { id: "sear-undead" }]);
    expect(upgradeOf(at5.items[0].system.activities.get(TURN), rule)?.id).toBe(SEAR_61);
    expect(upgradeOf(at5.items[0].system.activities.get(SEAR_61), rule)).toBe(null);
    const at3 = actorWith(["cleric"], [{ id: "channel-divinity-cleric", activities: [TURN, SEAR_61] }]);
    expect(upgradeOf(at3.items[0].system.activities.get(TURN), rule)).toBe(null);
  });

  it("« Sear Undead » 6.1 ne vise que les morts-vivants, et ses propres dégâts ne font pas tomber « Turned »", () => {
    expect(SHIPPED["channel-divinity-cleric"].targets.unaffectedIf["activity.id"]).toEqual([TURN, SEAR_61]);
    expect(SHIPPED["channel-divinity-cleric"].triggers.find(t => t.on === "isDamaged")).toMatchObject({ fromEffect: "iUeSbfduM7K8XrCF", by: "otherActivity" });
  });
});
