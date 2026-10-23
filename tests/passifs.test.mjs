import { describe, expect, it } from "vitest";
import { SHIPPED } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

/** Relevé des trous (2026-10-22, SPEC §235) : les aptitudes passives qui n'avaient aucun effet. */
describe("aptitudes passives du relevé des trous", () => {
  const facts = { "activity.cantripOf": true, "activity.isWeapon": true, "source.hasFeature": true, "source.wildShaped": true, "activity.isAttack": true };

  it("Incantation puissante : le modificateur de Sagesse aux tours de magie de la classe, Druide et Clerc", () => {
    for ( const [id, cls] of [["elemental-fury-potent-spellcasting", "druid"], ["blessed-strikes-potent-spellcasting", "cleric"]] ) {
      const [d] = SHIPPED[id].triggers;
      expect(d).toMatchObject({ on: "preDamageRoll", if: { "activity.cantripOf": cls } });
      expect(d.do).toEqual([{ type: "damage", formula: "@abilities.wis.mod", damageType: "weapon" }]);
    }
  });

  it("Attaque primitive et Impact divin : pas pour qui a l'option Incantation puissante", () => {
    for ( const [id, option] of [["elemental-fury", "elemental-fury-potent-spellcasting"], ["blessed-strikes", "blessed-strikes-potent-spellcasting"]] ) {
      for ( const d of SHIPPED[id].triggers ) {
        const facts = has => ({ "activity.isWeapon": () => true, "source.wildShaped": () => false, "activity.isAttack": () => true,
          "source.hasFeature": f => has.includes(f) });
        expect(holds(d.if, facts([]))).toBe(!d.if.all.some(c => c["source.hasFeature"]));   // sans option : seule la version de base
        expect(holds(d.if, facts([option, "improved-elemental-fury", "improved-blessed-strikes"]))).toBe(false);
      }
    }
  });

  it("Chasseur implacable, Concentration fanatique, Sorts psychiques, Athlète remarquable, Inspiration de combat", () => {
    expect(SHIPPED["relentless-hunter"].keepsConcentration).toEqual(["hunters-mark"]);
    expect(SHIPPED["fanatical-focus"].rollBonus).toEqual({ on: ["save"], reroll: { bonus: "@scale.barbarian.rage-damage", during: "rage" } });
    expect(SHIPPED["psychic-spells"].spellDamageTypes).toEqual({ class: "warlock", types: ["psychic"] });
    expect(SHIPPED["remarkable-athlete"].critMove).toBe(true);
    expect(SHIPPED["combat-inspiration"].combatInspiration).toBe(true);
  });

  it("les nouvelles clés refusent les formes fausses", () => {
    expect(validateEntry({ keepsConcentration: ["hunters-mark"] }, { facts })).toEqual([]);
    expect(validateEntry({ keepsConcentration: [] }, { facts })).toHaveLength(1);
    expect(validateEntry({ keepsConcentration: "hunters-mark" }, { facts })).toHaveLength(1);
    expect(validateEntry({ spellDamageTypes: { class: "warlock", types: ["psychic"] } }, { facts })).toEqual([]);
    expect(validateEntry({ spellDamageTypes: { class: "warlock", types: [] } }, { facts })).toHaveLength(1);
    expect(validateEntry({ spellDamageTypes: { class: "warlock", types: ["psychic"], level: 1 } }, { facts })).toHaveLength(1);
    expect(validateEntry({ critMove: true, combatInspiration: true }, { facts })).toEqual([]);
    expect(validateEntry({ critMove: "yes" }, { facts })).toHaveLength(1);
    expect(validateEntry({ combatInspiration: 1 }, { facts })).toHaveLength(1);
  });

  it("§236 : niveaux 9 à 20 — déclarations et formes", () => {
    expect(SHIPPED["self-restoration"].endsOwnConditions).toEqual(["charmed", "frightened", "poisoned"]);
    expect(SHIPPED["fleet-step"].fleetStep).toEqual({ item: "monks-focus", activity: "0MuRZ0Ur95xQTKFq" });
    expect(SHIPPED["superior-inspiration"].regainOnInitiative).toEqual({ item: "bardic-inspiration", upTo: 2 });
    expect(SHIPPED["avatar-of-battle"].grantsResistances).toEqual(["bludgeoning", "piercing", "slashing"]);
    expect(SHIPPED["indomitable-might"].scoreFloor).toEqual(["str"]);
    expect(SHIPPED["improved-elemental-fury"].cantripRange).toMatchObject({ class: "druid", add: { value: 300, units: "ft" } });
    expect(SHIPPED["supreme-sneak"].cunningStrikes.stealthAttack).toEqual({ cost: 1, keepsHidden: true });
    expect(SHIPPED["thiefs-reflexes"].extraFirstTurn).toEqual({ minus: 10 });
    expect(SHIPPED["soul-of-vengeance"].triggers[0].on).toBe("enemyAttacked");
    for ( const [entry, n] of [[{ endsOwnConditions: [] }, 1], [{ regainOnInitiative: { item: "x", upTo: 0 } }, 1], [{ grantsResistances: "fire" }, 1],
      [{ cantripRange: { class: "druid", add: { value: 300 } } }, 1], [{ fleetStep: { item: "monks-focus", activity: "court" } }, 1],
      [{ extraFirstTurn: { minus: -10 } }, 1], [{ cunningStrikes: { x: { cost: 1, keepsHidden: "oui" } } }, 1]] ) {
      expect(validateEntry(entry, { facts }), JSON.stringify(entry)).toHaveLength(n);
    }
  });
});
