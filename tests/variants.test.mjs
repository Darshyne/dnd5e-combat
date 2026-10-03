import { describe, it, expect } from "vitest";
import { variantsOf, chooseVariant, advantageVariant, chargeOnlyEffects, straightChargeFeet } from "../module/scripts/core/variants.mjs";

const atk = (id, name, extra={}) => ({ id, type: "attack", name, ...extra });

describe("variantes d'attaque (M5)", () => {
  it("Défense du Sanglier : charge de 20 ft, À terre seulement après la charge", () => {
    const plan = variantsOf([atk("base000000000000", "Attack", { effects: ["prone00000000000"] }),
      atk("moving0000000000", "Moving Attack", { condition: "moved 20+ feet", effects: ["prone00000000000"] })]);
    expect(plan).toEqual({ base: "base000000000000", baseEffects: ["prone00000000000"],
      variants: [{ id: "moving0000000000", kind: "charge", feet: 20, effects: ["prone00000000000"] }] });
    expect(chargeOnlyEffects(plan)).toEqual(["prone00000000000"]);
    expect(chooseVariant(plan, { chargedFeet: 15 })).toBeNull();
    expect(chooseVariant(plan, { chargedFeet: 20 })).toBe("moving0000000000");
  });

  it("distance lue dans le texte quand l'activité ne la dit pas (créature inventée, 30 ft)", () => {
    const plan = variantsOf([atk("a", ""), atk("b", "Moving Attack")], "<p>If the skyhorn moved 30+ feet straight toward the target…</p>");
    expect(plan.variants[0].feet).toBe(30);
  });

  it("En sang : la nuée elle-même, ou la cible (Faucon de sang)", () => {
    const swarm = variantsOf([atk("a", ""), atk("b", "Bloodied Attack")], "<p>… or 1d4 if the swarm is Bloodied.</p>");
    expect(swarm.variants[0].subject).toBe("self");
    expect(chooseVariant(swarm, { selfBloodied: true })).toBe("b");
    expect(chooseVariant(swarm, { targetBloodied: true })).toBeNull();
    const hawk = variantsOf([atk("a", ""), atk("b", "Bloodied Attack")], "<p>… damage if the target is &amp;Reference[Bloodied].</p>");
    expect(hawk.variants[0].subject).toBe("target");
    expect(chooseVariant(hawk, { targetBloodied: true })).toBe("b");
  });

  it("avantage : se juge au jet de dégâts, pas avant", () => {
    const plan = variantsOf([atk("a", ""), atk("b", "Attack with Advantage")]);
    expect(chooseVariant(plan, { selfBloodied: true, chargedFeet: 99 })).toBeNull();
    expect(advantageVariant(plan)).toBe("b");
  });

  it("Mimique : cible agrippée par elle", () => {
    const plan = variantsOf([atk("a", ""), atk("b", "Attacked if Grappling")]);
    expect(chooseVariant(plan, { grappledBySelf: true })).toBe("b");
  });

  it("pas de variante : une seule attaque, ou des attaques sans condition (Changement d'apparence)", () => {
    expect(variantsOf([atk("a", "")])).toBeNull();
    expect(variantsOf([atk("a", "Attack: Claws"), atk("b", "Attack: Hooves")])).toBeNull();
  });
});

describe("charge en ligne droite", () => {
  const T = { x: 10, y: 0 };
  it("quatre cases droit vers la cible : 20 ft", () => {
    expect(straightChargeFeet([{ x: 5, y: 0 }, { x: 7, y: 0 }, { x: 9, y: 0 }], T, 5)).toBe(20);
  });
  it("diagonale : une case par pas (règle par défaut de dnd5e)", () => {
    expect(straightChargeFeet([{ x: 5, y: 5 }, { x: 9, y: 1 }], T, 5)).toBe(20);
  });
  it("un coude : seule la fin droite compte", () => {
    expect(straightChargeFeet([{ x: 7, y: 5 }, { x: 7, y: 0 }, { x: 9, y: 0 }], T, 5)).toBe(10);
  });
  it("s'éloigner ou longer la cible ne compte pas", () => {
    expect(straightChargeFeet([{ x: 9, y: -4 }, { x: 9, y: 0 }], { x: 13, y: 0 }, 5)).toBe(0);
    expect(straightChargeFeet([{ x: 12, y: 0 }, { x: 16, y: 0 }], T, 5)).toBe(0);
  });
  it("sans déplacement : 0", () => {
    expect(straightChargeFeet([{ x: 9, y: 0 }], T, 5)).toBe(0);
    expect(straightChargeFeet([], T, 5)).toBe(0);
  });
});
