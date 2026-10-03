import { describe, it, expect } from "vitest";
import { eligibleReactions, areHostile, opportunityAttackers } from "../module/scripts/core/reaction.mjs";
import { resolveAttack } from "../module/scripts/core/attack.mjs";

describe("fenêtres de réaction", () => {
  const declared = [{ on: ["isHit"], name: "Bouclier" }, { on: ["isDamaged"], name: "Représailles infernales" }];

  it("ne propose que les réactions de la fenêtre ouverte", () => {
    expect(eligibleReactions(declared, "isHit", { reactionAvailable: true }).map(r => r.name)).toEqual(["Bouclier"]);
  });
  it("ne propose rien si la réaction est déjà dépensée", () => {
    expect(eligibleReactions(declared, "isHit", { reactionAvailable: false })).toEqual([]);
  });
  it("ne propose rien à une créature neutralisée", () => {
    expect(eligibleReactions(declared, "isHit", { reactionAvailable: true, incapacitated: true })).toEqual([]);
  });
  it("Bouclier : +5 à la CA transforme un toucher en raté, mais pas un critique", () => {
    const roll = { total: 17, isCritical: false, isFumble: false };
    const mage = { token: "T.m", name: "Magicien", ac: 13 };
    expect(resolveAttack(roll, [mage])[0].hit).toBe(true);
    expect(resolveAttack(roll, [{ ...mage, ac: 18 }])[0].hit).toBe(false);
    expect(resolveAttack({ ...roll, isCritical: true }, [{ ...mage, ac: 18 }])[0].hit).toBe(true);
  });
});

describe("camps", () => {
  it("seuls amicaux et hostiles s'opposent", () => {
    expect(areHostile(1, -1)).toBe(true);
    expect(areHostile(-1, 1)).toBe(true);
    expect(areHostile(1, 1)).toBe(false);
    expect(areHostile(0, -1)).toBe(false);
    expect(areHostile(-2, 1)).toBe(false);
  });
});

describe("attaque d'opportunité", () => {
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 15, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  const pj = { disposition: 1, disengaged: false, teleported: false };

  it("se déclenche quand un ennemi sort de l'allonge", () => {
    expect(opportunityAttackers(pj, [zombi])).toEqual(["T.z"]);
  });
  it("pas si l'on reste dans l'allonge, ni si l'on n'y était pas", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, after: 5 }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, before: 10 }])).toEqual([]);
  });
  it("une allonge de 10 ft couvre deux cases", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, reach: 10, after: 10 }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, reach: 10, after: 15 }])).toEqual(["T.z"]);
  });
  it("pas après Se désengager, ni sur une téléportation", () => {
    expect(opportunityAttackers({ ...pj, disengaged: true }, [zombi])).toEqual([]);
    expect(opportunityAttackers({ ...pj, teleported: true }, [zombi])).toEqual([]);
  });
  it("pas entre alliés, pas sans réaction, pas sans attaque de mêlée, pas neutralisé", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, disposition: 1 }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, reactionAvailable: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, hasMeleeAttack: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, incapacitated: true }])).toEqual([]);
  });
  it("chaque ennemi est jugé séparément", () => {
    const goule = { ...zombi, token: "T.g", after: 5 };
    expect(opportunityAttackers(pj, [zombi, goule])).toEqual(["T.z"]);
  });
});

describe("attaque d'opportunité et vision (P1)", () => {
  const pj = { disposition: 1, disengaged: false, teleported: false };
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 10, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  it("qui ne voit pas celui qui bouge ne réagit pas ; inconnu ne l'exclut pas", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, seesMover: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, seesMover: true }])).toEqual(["T.z"]);
    expect(opportunityAttackers(pj, [{ ...zombi, seesMover: null }])).toEqual(["T.z"]);
    expect(opportunityAttackers(pj, [zombi])).toEqual(["T.z"]);
  });
});

describe("opportunityAttackers — ligne d'effet (P2)", () => {
  const pj = { disposition: 1, disengaged: false, teleported: false };
  const zombi = { token: "T.z", disposition: -1, before: 5, after: 10, reach: 5, reactionAvailable: true, hasMeleeAttack: true };
  it("qui ne peut pas frapper celui qui bouge (plancher entre eux) ne réagit pas ; inconnu ne l'exclut pas", () => {
    expect(opportunityAttackers(pj, [{ ...zombi, hasLineOfEffect: false }])).toEqual([]);
    expect(opportunityAttackers(pj, [{ ...zombi, hasLineOfEffect: true }])).toEqual(["T.z"]);
    expect(opportunityAttackers(pj, [{ ...zombi, hasLineOfEffect: null }])).toEqual(["T.z"]);
  });
});
