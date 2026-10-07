/** M8 (SPEC §18.16) : drain du maximum de PV — lecture du texte anglais d'origine, part drainée. */
import { describe, it, expect } from "vitest";
import { readDrain, drainedAmount, drains, drainEffectShape } from "../module/scripts/core/drain.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// Textes de la forme de ceux du Monster Manual 2024, enrichers compris : créatures du SRD 5.2 (Nécrophage, Vampire, Momie),
// ou texte synthétique de même grammaire (créature inventée) hors SRD.
const LIFE_DRAIN = `<p>[[/attack extended]]. [[/damage average extended]]. If the target is a creature, its Hit Point maximum decreases by an amount equal to the damage taken.</p>`;
const VAMPIRE_BITE = `<p><em>Constitution Saving Throw</em>: DC 17, one creature within 5 feet. <em>Failure</em>: [[/damage average]] damage. The target's Hit Point maximum decreases by an amount equal to the Necrotic damage taken, and the vampire regains Hit Points equal to that amount.</p>`;
const ENERGY_DRAIN = `<p><em>Constitution Saving Throw</em>: DC 15, one creature the marrow wraith can see within 30 feet. <em>Failure</em>: The target's Hit Point maximum decreases by 14 ([[/r 4d6]]).</p>`;
const ROTTING_FIST = `<p>If the target is a creature, it is cursed. While cursed, the target can't regain Hit Points, and its Hit Point maximum decreases by [[/r 3d6#HP Max Decrease]]{10 (3d6)} every 24 hours that elapse.</p>`;
// §105 : caractéristique (Ombre, SRD 5.2), format 2014 en français (fiche faite à la main).
const DRAINING_SWIPE = `<p class="feature">[[/attack extended]]. [[/damage average extended]], and the target’s Strength score decreases by [[/r 1d4]]. The target dies if this reduces that score to 0.</p>`;
const SWIPE_FR = `<p>[[/attack extended]]. [[/damage average extended]], et la valeur de Force de la cible est réduite de [[/r 1d4]]. La cible meurt si l'effet fait tomber cette valeur à 0.</p>`;
const MIST_FR = `<p><em>Touché :</em> 10 (2d6 + 3) dégâts nécrotiques. La cible doit réussir un jet de sauvegarde de Constitution DD 13, sinon son maximum de points de vie est réduit d'un montant égal aux dégâts subis, et la brume regagne autant de points de vie. Cette réduction dure jusqu'à ce que la cible termine un repos long.</p>`;
const MIST_2014 = `<p><em>Hit:</em> 10 (2d6 + 3) necrotic damage. The target must succeed on a DC 13 Constitution saving throw or its hit point maximum is reduced by an amount equal to the damage taken, and the mist regains hit points equal to that amount.</p>`;
const PLAIN_BITE = `<p>[[/attack extended]]. [[/damage average extended]].</p>`;

describe("drain du maximum de PV (M8)", () => {
  it("lit la forme du drain", () => {
    expect(readDrain(LIFE_DRAIN)).toEqual({ equal: true, type: null, regains: false, fixed: null, onFailedSave: false, ability: null });
    expect(readDrain(VAMPIRE_BITE)).toEqual({ equal: true, type: "necrotic", regains: true, fixed: null, onFailedSave: false, ability: null });
    expect(readDrain(ENERGY_DRAIN)).toEqual({ equal: false, type: null, regains: false, fixed: "4d6", onFailedSave: false, ability: null });
  });

  it("une malédiction « every 24 hours » ou une morsure ordinaire ne draine pas en combat", () => {
    expect(readDrain(ROTTING_FIST)).toEqual({ equal: false, type: null, regains: false, fixed: null, onFailedSave: false, ability: null });
    expect(readDrain(PLAIN_BITE)).toEqual({ equal: false, type: null, regains: false, fixed: null, onFailedSave: false, ability: null });
  });

  it("§105 : caractéristique, format 2014, texte français", () => {
    expect(readDrain(DRAINING_SWIPE).ability).toEqual({ key: "str", formula: "1d4" });
    expect(readDrain(SWIPE_FR).ability).toEqual({ key: "str", formula: "1d4" });
    expect(drains(readDrain(DRAINING_SWIPE))).toBe(true);
    expect(readDrain(MIST_FR)).toEqual({ equal: true, type: null, regains: true, fixed: null, onFailedSave: true, ability: null });
    expect(readDrain(MIST_2014)).toEqual({ equal: true, type: null, regains: true, fixed: null, onFailedSave: true, ability: null });
    expect(readDrain(VAMPIRE_BITE).onFailedSave).toBe(false);   // 2024 : les dégâts ne tombent que sur l'échec
    expect(drains(readDrain(PLAIN_BITE))).toBe(false);
  });

  it("§105 : l'effet qui porte le drain", () => {
    expect(drainEffectShape({ kind: "hp", total: 12 })).toEqual({ key: "system.attributes.hp.tempmax", change: -12, expiry: "longRest" });
    expect(drainEffectShape({ kind: "str", total: 3 })).toEqual({ key: "system.abilities.str.value", change: -3, expiry: "longRest" });
  });

  it("la part drainée : le type nommé, ou tous les dégâts ; jamais plus que le total subi", () => {
    const damages = [{ type: "piercing", value: 7 }, { type: "necrotic", value: 10 }, { type: "healing", value: 5 }];
    expect(drainedAmount(damages, "necrotic", 17)).toBe(10);
    expect(drainedAmount(damages, null, 17)).toBe(17);
    expect(drainedAmount(damages, null, 12)).toBe(12);   // seuil, PV temporaires : borné au total
    expect(drainedAmount([{ type: "necrotic", value: 0 }], "necrotic", 0)).toBe(0);   // immunité
  });

  it("contenu livré", () => {
    for ( const id of ["life-drain", "bite", "slam", "energy-drain", "draining-swipe"] ) {
      expect(CONTENT[id].drain).toBe(true);
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(validateEntry({ drain: "oui" })).toHaveLength(1);
  });
});
