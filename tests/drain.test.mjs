/** M8 (SPEC §18.16) : drain du maximum de PV — lecture du texte anglais d'origine, part drainée. */
import { describe, it, expect } from "vitest";
import { readDrain, drainedAmount } from "../module/scripts/core/drain.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// Textes de la forme de ceux du Monster Manual 2024, enrichers compris : créatures du SRD 5.2 (Nécrophage, Vampire, Momie),
// ou texte synthétique de même grammaire (créature inventée) hors SRD.
const LIFE_DRAIN = `<p>[[/attack extended]]. [[/damage average extended]]. If the target is a creature, its Hit Point maximum decreases by an amount equal to the damage taken.</p>`;
const VAMPIRE_BITE = `<p><em>Constitution Saving Throw</em>: DC 17, one creature within 5 feet. <em>Failure</em>: [[/damage average]] damage. The target's Hit Point maximum decreases by an amount equal to the Necrotic damage taken, and the vampire regains Hit Points equal to that amount.</p>`;
const ENERGY_DRAIN = `<p><em>Constitution Saving Throw</em>: DC 15, one creature the marrow wraith can see within 30 feet. <em>Failure</em>: The target's Hit Point maximum decreases by 14 ([[/r 4d6]]).</p>`;
const ROTTING_FIST = `<p>If the target is a creature, it is cursed. While cursed, the target can't regain Hit Points, and its Hit Point maximum decreases by [[/r 3d6#HP Max Decrease]]{10 (3d6)} every 24 hours that elapse.</p>`;
const PLAIN_BITE = `<p>[[/attack extended]]. [[/damage average extended]].</p>`;

describe("drain du maximum de PV (M8)", () => {
  it("lit la forme du drain", () => {
    expect(readDrain(LIFE_DRAIN)).toEqual({ equal: true, type: null, regains: false, fixed: null });
    expect(readDrain(VAMPIRE_BITE)).toEqual({ equal: true, type: "necrotic", regains: true, fixed: null });
    expect(readDrain(ENERGY_DRAIN)).toEqual({ equal: false, type: null, regains: false, fixed: "4d6" });
  });

  it("une malédiction « every 24 hours » ou une morsure ordinaire ne draine pas en combat", () => {
    expect(readDrain(ROTTING_FIST)).toEqual({ equal: false, type: null, regains: false, fixed: null });
    expect(readDrain(PLAIN_BITE)).toEqual({ equal: false, type: null, regains: false, fixed: null });
  });

  it("la part drainée : le type nommé, ou tous les dégâts ; jamais plus que le total subi", () => {
    const damages = [{ type: "piercing", value: 7 }, { type: "necrotic", value: 10 }, { type: "healing", value: 5 }];
    expect(drainedAmount(damages, "necrotic", 17)).toBe(10);
    expect(drainedAmount(damages, null, 17)).toBe(17);
    expect(drainedAmount(damages, null, 12)).toBe(12);   // seuil, PV temporaires : borné au total
    expect(drainedAmount([{ type: "necrotic", value: 0 }], "necrotic", 0)).toBe(0);   // immunité
  });

  it("contenu livré", () => {
    for ( const id of ["life-drain", "bite", "slam", "energy-drain"] ) {
      expect(CONTENT[id].drain).toBe(true);
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(validateEntry({ drain: "oui" })).toHaveLength(1);
  });
});
