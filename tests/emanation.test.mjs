/** M7 (SPEC §18.11) : auras de monstre qui agissent — lecture du texte anglais d'origine, et qui est atteint. */
import { describe, it, expect } from "vitest";
import { readEmanationText, emanationTargets } from "../module/scripts/core/emanation.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

// Textes de la forme de ceux du Monster Manual 2024, enrichers compris : créatures du SRD 5.2 (Blême, Diantrefosse, Azer,
// Balor), ou texte synthétique de même grammaire (créature inventée) hors SRD.
const STENCH = `<p><em>Constitution Saving Throw</em>: DC [[lookup @save.dc.value activity=mJbwhj3beOIB3Jgj]], any creature (other than a [[lookup @name lowercase]]) that starts its turn in a [[lookup @target.template.size activity=mJbwhj3beOIB3Jgj]]-foot Emanation originating from the [[lookup @name lowercase]]. <em>Failure</em>: The target has the &amp;Reference[Poisoned] condition until the start of its next turn. <em>Success</em>: The target is immune to the Stench of all [[lookup @name lowercase]]s for 1 hour.</p>`;
const FEAR = `<p>The [[lookup @name lowercase]] emanates an aura in a 20-foot Emanation while it doesn’t have the &amp;Reference[Incapacitated] condition. <em>Wisdom Saving Throw</em>: DC 21, any enemy that starts its turn in the aura. <em>Failure</em>: The target has the Frightened condition until the start of its next turn. <em>Success</em>: The target is immune to this [[lookup @name lowercase]]'s aura for 24 hours.</p>`;
const AZER = `<p>At the end of each of the [[lookup @name lowercase]]'s turns, each creature of the azer's choice in a 5-foot Emanation originating from the azer takes [[/damage average]] damage unless the [[lookup @name lowercase]] has the &amp;Reference[Incapacitated] condition.</p>`;
const BALOR = `<p>At the end of each of the [[lookup @name lowercase]]'s turns, each creature of the balor's choice in a 10-foot Emanation originating from the balor takes [[/damage average]] damage.</p>`;
const MOAN = `<p>Success: The target is immune to this gloomwing’s Wail for the next 24 hours.</p>`;

describe("émanations de monstre (M7)", () => {
  it("lit « autre qu'un … », l'immunité et sa portée", () => {
    expect(readEmanationText(STENCH)).toEqual({ active: false, kin: true, immunity: { hours: 1, all: true } });
    expect(readEmanationText(FEAR)).toEqual({ active: true, kin: false, immunity: { hours: 24, all: false } });
    expect(readEmanationText(MOAN).immunity).toEqual({ hours: 24, all: false });
  });

  it("« sauf s'il est Neutralisé » : Azer oui, Balor non", () => {
    expect(readEmanationText(AZER)).toMatchObject({ active: true, immunity: null });
    expect(readEmanationText(BALOR)).toMatchObject({ active: false, kin: false, immunity: null });
  });

  const source = { token: "S", disposition: -1, radius: 10, affects: "any", inactive: false };
  const c = (token, extra={}) => ({ token, disposition: 1, distance: 5, ...extra });

  it("atteint qui est à portée, ni le porteur, ni les hors jeu, ni les immunisés, ni les semblables", () => {
    expect(emanationTargets(source, [
      c("S", { distance: 0 }), c("A"), c("loin", { distance: 15 }), c("bord", { distance: 10 }), c("mort", { out: true }),
      c("immunisé", { immune: true }), c("ghast", { kin: true }), c("derrière un mur", { lineOfEffect: false }),
      c("ne voit pas", { sees: false }), c("voit ?", { sees: null })
    ])).toEqual(["A", "bord", "voit ?"]);
  });

  it("« de son choix » : les camps opposés seulement ; porteur éteint : personne", () => {
    const choice = { ...source, affects: "enemy" };
    expect(emanationTargets(choice, [c("PJ"), c("allié", { disposition: -1 }), c("neutre", { disposition: 0 })])).toEqual(["PJ"]);
    expect(emanationTargets({ ...source, inactive: true }, [c("PJ")])).toEqual([]);
  });

  it("le contenu livré est valide", () => {
    for ( const id of ["fire-aura", "stench", "fear-aura", "vile-appearance", "death-burst", "death-throes"] ) {
      expect(CONTENT[id]?.emanation).toBeTruthy();
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(validateEntry({ emanation: { on: "whenever" } })).toHaveLength(1);
    expect(validateEntry({ emanation: { on: "turnStart", radius: 10 } })).toHaveLength(1);   // un rayon sans unité
  });
});
