import { describe, it, expect } from "vitest";
import {
  segmentTouchesRect, isClimbableWall, climbSpeed, climbMultiplier, climbFallReason, climbableCells, climbCheckDue, MAX_CLIMB_CELLS,
  CEILING_DC, CEILING_IDENTIFIERS, grantsCeiling, ceilingPerch, hangsFrom, flippedScale,
  grantedSpeedChanges, sameSpeedChanges, acrobaticAllowed, acrobaticFallDue
} from "../module/scripts/core/climb.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";
import { overlapsVertically, verticalExtent, verticalGap } from "../module/scripts/core/space.mjs";

const cell = { x: 100, y: 100, width: 100, height: 100 };

describe("près d'un mur (§192)", () => {
  it("un mur sur le bord de la case la touche, un mur à côté non", () => {
    expect(segmentTouchesRect({ x: 100, y: 0 }, { x: 100, y: 300 }, cell)).toBe(true);     // le long du bord gauche
    expect(segmentTouchesRect({ x: 0, y: 200 }, { x: 300, y: 200 }, cell)).toBe(true);     // le long du bord bas
    expect(segmentTouchesRect({ x: 50, y: 0 }, { x: 50, y: 300 }, cell)).toBe(false);      // une demi-case plus loin
    expect(segmentTouchesRect({ x: 0, y: 0 }, { x: 300, y: 300 }, cell)).toBe(true);       // la diagonale traverse
    expect(segmentTouchesRect({ x: 0, y: 250 }, { x: 300, y: 250 }, cell)).toBe(false);    // sous la case
  });
  it("la tolérance rattrape un mur tracé un peu à côté", () => {
    expect(segmentTouchesRect({ x: 92, y: 0 }, { x: 92, y: 300 }, cell, 10)).toBe(true);
    expect(segmentTouchesRect({ x: 80, y: 0 }, { x: 80, y: 300 }, cell, 10)).toBe(false);
  });
  it("un segment entièrement dans la case compte", () => {
    expect(segmentTouchesRect({ x: 120, y: 120 }, { x: 180, y: 180 }, cell)).toBe(true);
  });
  it("une porte ouverte, un mur sans restriction de déplacement, un mur de sort (sauf Mur de pierre) ne se grimpent pas", () => {
    expect(isClimbableWall({ move: true, openDoor: false })).toBe(true);
    expect(isClimbableWall({ move: true, openDoor: true })).toBe(false);
    expect(isClimbableWall({ move: false, openDoor: false })).toBe(false);
    expect(isClimbableWall({ move: true, openDoor: false, spell: "wall-of-fire" })).toBe(false);
    expect(isClimbableWall({ move: true, openDoor: false, spell: "wall-of-stone" })).toBe(true);
  });
});

describe("vitesse et coût", () => {
  it("l'escalade borne le tour si la fiche en a une, sinon la marche", () => {
    expect(climbSpeed({ walk: 30, climb: 20 })).toEqual({ speed: 20, native: true });
    expect(climbSpeed({ walk: 30 })).toEqual({ speed: 30, native: false });
    expect(climbSpeed({ walk: 30, climb: 0 })).toEqual({ speed: 30, native: false });
    expect(climbSpeed({})).toEqual({ speed: 0, native: false });
  });
  it("un pied coûte deux pieds sans vitesse d'escalade", () => {
    expect(climbMultiplier({ walk: 30 })).toBe(2);
    expect(climbMultiplier({ walk: 30, climb: 30 })).toBe(1);
  });
  it("les cases qu'on peut monter : budget, plafond, limite", () => {
    // 30 ft restants, 5 ft la case, ×2 : trois cases.
    expect(climbableCells({ remaining: 30, gridDistance: 5, multiplier: 2 })).toBe(3);
    expect(climbableCells({ remaining: 30, gridDistance: 5, multiplier: 1 })).toBe(6);
    expect(climbableCells({ remaining: 30, gridDistance: 5, multiplier: 1, ceilingCells: 2 })).toBe(2);
    expect(climbableCells({ remaining: 7, gridDistance: 5, multiplier: 2 })).toBe(0);
    expect(climbableCells({ remaining: Infinity, gridDistance: 5, multiplier: 2 })).toBe(MAX_CLIMB_CELLS);
    expect(climbableCells({ remaining: Infinity, gridDistance: 5, multiplier: 2, ceilingCells: 2.9 })).toBe(2);
    expect(climbableCells({ remaining: Infinity, gridDistance: 5, multiplier: 2, ceilingCells: 0 })).toBe(0);
  });
});

describe("chute", () => {
  it("À terre, Neutralisé, Agrippé ou sans vitesse : on tombe", () => {
    expect(climbFallReason({ speed: 30 })).toBeNull();
    expect(climbFallReason({ prone: true, speed: 30 })).toBe("prone");
    expect(climbFallReason({ incapacitated: true, speed: 30 })).toBe("incapacitated");
    expect(climbFallReason({ grappled: true, speed: 30 })).toBe("grappled");
    expect(climbFallReason({ speed: 0 })).toBe("noSpeed");
  });
  it("le test « maison » est dû après l'intervalle, ou s'il n'a jamais été fait", () => {
    expect(climbCheckDue(null, 1000, 10000)).toBe(true);
    expect(climbCheckDue(0, 9000, 10000)).toBe(false);
    expect(climbCheckDue(0, 10000, 10000)).toBe(true);
  });
});

describe("occupation en trois dimensions", () => {
  it("un grimpeur au-dessus d'une créature au sol n'occupe pas sa case", () => {
    expect(overlapsVertically({ elevation: 0, depth: 1 }, { elevation: 0, depth: 1 }, 5)).toBe(true);
    expect(overlapsVertically({ elevation: 10, depth: 1 }, { elevation: 0, depth: 1 }, 5)).toBe(false);
    expect(overlapsVertically({ elevation: 5, depth: 1 }, { elevation: 0, depth: 1 }, 5)).toBe(true);   // tête contre pieds : contact
    expect(overlapsVertically({ elevation: 5, depth: 1 }, { elevation: 0, depth: 2 }, 5)).toBe(true);   // un Grand de 10 ft
    expect(overlapsVertically({ elevation: 15, depth: 1 }, { elevation: 0, depth: 2 }, 5)).toBe(false);
  });
});

describe("plafonds (§192, lot 2)", () => {
  it("la capacité vient d'un identifiant connu ou d'une entrée de contenu `climbsCeilings`", () => {
    expect(grantsCeiling("spider-climb")).toBe(true);
    expect(grantsCeiling("slippers-of-spider-climbing")).toBe(true);
    expect(grantsCeiling("cloak-of-arachnida")).toBe(true);
    expect(grantsCeiling("athlete")).toBe(false);
    expect(grantsCeiling("ma-creature", { climbsCeilings: true })).toBe(true);
    expect(grantsCeiling("ma-creature", { climbsCeilings: false })).toBe(false);
    expect(CEILING_IDENTIFIERS).toContain("spider-climb");
    expect(CEILING_DC).toBe(20);
  });
  it("accroché au plafond, les pieds sont au plafond moins la hauteur", () => {
    expect(ceilingPerch(20, 1, 5)).toBe(15);
    expect(ceilingPerch(20, 2, 5)).toBe(10);   // un Grand de 10 ft
    expect(ceilingPerch(Infinity, 1, 5)).toBeNull();
    expect(hangsFrom(15, 1, 5, 20)).toBe(true);
    expect(hangsFrom(10, 1, 5, 20)).toBe(false);
    expect(hangsFrom(15, 1, 5, Infinity)).toBe(false);
  });
  it("le miroir vertical inverse l'échelle, et la rend telle qu'elle était", () => {
    expect(flippedScale(1)).toBe(-1);
    expect(flippedScale(-1)).toBe(1);   // un token déjà en miroir repasse à l'endroit : la tête en bas pour lui
    expect(flippedScale(1.5)).toBe(-1.5);
    expect(flippedScale(undefined)).toBe(-1);
  });
  it("une cible au plafond est hors d'allonge d'une créature au sol, un Grand de 10 ft la touche", () => {
    // Pieds à 15 ft, tête à 20 : 10 ft de vide au-dessus d'un Moyen (0–5), 5 ft au-dessus d'un Grand (0–10).
    const gap = (a, b) => verticalGap(verticalExtent(a, 5), verticalExtent(b, 5));
    expect(gap({ elevation: 0, depth: 1 }, { elevation: 15, depth: 1 })).toBe(10);
    expect(gap({ elevation: 0, depth: 2 }, { elevation: 15, depth: 1 })).toBe(5);
    expect(gap({ elevation: 10, depth: 1 }, { elevation: 15, depth: 1 })).toBe(0);
  });
});

describe("escalade, contenu (§195)", () => {
  it("les Pantoufles ne donnent pas le plafond sur une surface glissante, les autres capacités si", () => {
    const slippers = SHIPPED["slippers-of-spider-climbing"];
    expect(grantsCeiling("slippers-of-spider-climbing", slippers)).toBe(true);
    expect(grantsCeiling("slippers-of-spider-climbing", slippers, { slippery: true })).toBe(false);
    expect(grantsCeiling("cloak-of-arachnida", null, { slippery: true })).toBe(true);
    expect(grantsCeiling("spider-climb", SHIPPED["spider-climb"], { slippery: true })).toBe(true);
  });
  it("la Graisse et la flaque d'Huile sont des surfaces glissantes", () => {
    expect(SHIPPED["grease"].slippery).toBe(true);
    expect(SHIPPED["oil"].slippery).toBe(true);
    expect(SHIPPED["web"].slippery).toBeUndefined();
  });
  it("Athlète : une vitesse d'escalade égale à la Vitesse, de la forme des capacités de dnd5e", () => {
    expect(SHIPPED["athlete"].grantsSpeeds).toEqual({ climb: "walk" });
    expect(grantedSpeedChanges({ climb: "walk" }, 30)).toEqual([{ key: "system.attributes.movement.climb", type: "upgrade", value: "30" }]);
    expect(grantedSpeedChanges({ swim: 20, climb: "walk" }, 25).map(c => c.value)).toEqual(["20", "25"]);
    expect(grantedSpeedChanges({ climb: "walk" }, 0)).toEqual([]);   // sans Vitesse, rien
  });
  it("un effet de vitesse accordée n'est réécrit que si ses changements diffèrent", () => {
    const wanted = grantedSpeedChanges({ climb: "walk" }, 30);
    expect(sameSpeedChanges([{ key: "system.attributes.movement.climb", type: "upgrade", value: "30", phase: "initial" }], wanted)).toBe(true);
    expect(sameSpeedChanges([{ key: "system.attributes.movement.climb", type: "upgrade", value: "25" }], wanted)).toBe(false);
    expect(sameSpeedChanges([], wanted)).toBe(false);
  });
  it("Mouvement acrobatique : sans armure ni bouclier, à son tour en combat, toujours hors combat", () => {
    expect(acrobaticAllowed({})).toBe(true);
    expect(acrobaticAllowed({ inCombat: true, ownTurn: true })).toBe(true);
    expect(acrobaticAllowed({ inCombat: true, ownTurn: false })).toBe(false);
    expect(acrobaticAllowed({ armor: true })).toBe(false);
    expect(acrobaticAllowed({ shield: true, inCombat: true, ownTurn: true })).toBe(false);
    expect(SHIPPED["acrobatic-movement"].climbsOnTurn).toBe(true);
  });
  it("le moine tombe s'il finit son tour encore au mur, pas redescendu ni au plafond", () => {
    expect(acrobaticFallDue({ acrobatic: true, climbing: true, aboveGround: true })).toBe(true);
    expect(acrobaticFallDue({ acrobatic: true, climbing: true, aboveGround: false })).toBe(false);
    expect(acrobaticFallDue({ acrobatic: true, climbing: true, aboveGround: true, onCeiling: true })).toBe(false);
    expect(acrobaticFallDue({ acrobatic: false, climbing: true, aboveGround: true })).toBe(false);
  });
  it("le schéma : grantsSpeeds, climbsOnTurn, slippery, notOnSlippery, effectChanges.replace", () => {
    for ( const id of ["athlete", "acrobatic-movement", "slippers-of-spider-climbing", "grease", "oil", "spider-climb", "levitate"] ) {
      expect(validateEntry(SHIPPED[id])).toEqual([]);
    }
    expect(validateEntry({ grantsSpeeds: { climb: 30 } })).toEqual([]);
    expect(validateEntry({ grantsSpeeds: { walk: "walk" } }).length).toBe(1);   // la marche ne s'accorde pas ainsi
    expect(validateEntry({ grantsSpeeds: { climb: 0 } }).length).toBe(1);
    expect(validateEntry({ grantsSpeeds: {} }).length).toBe(1);
    expect(validateEntry({ climbsOnTurn: "oui" }).length).toBe(1);
    expect(validateEntry({ slippery: false }).length).toBe(1);
    expect(validateEntry({ effectChanges: { q2ug9SpVRCGuudoG: [{ key: "k", type: "upgrade", value: "@walk", replace: false }] } }).length).toBe(1);
  });
  it("Pattes d'araignée : la vitesse d'escalade remplacée par la Vitesse ; Lévitation : immunisé contre la chute", () => {
    const [change] = Object.values(SHIPPED["spider-climb"].effectChanges)[0];
    expect(change).toEqual({ key: "system.attributes.movement.climb", type: "upgrade", value: "@walk", replace: true });
    const [immune] = SHIPPED["levitate"].effectChanges.axhLHcJQHprSpHRD;
    expect(immune).toEqual({ key: "system.traits.ci.value", type: "add", value: "falling" });
  });
});

describe("se hisser sur un rebord (§209)", async () => {
  const { ledgeRise, ledgeCost } = await import("../module/scripts/core/climb.mjs");
  it("le rebord doit être au-dessus des pieds et à portée de la tête, avec de la place au-dessus", () => {
    expect(ledgeRise({ feet: 15, height: 5, ground: 20 })).toBe(5);          // la tête au niveau du toit
    expect(ledgeRise({ feet: 15, height: 5, ground: 25 })).toBeNull();       // trop haut
    expect(ledgeRise({ feet: 15, height: 5, ground: 15 })).toBeNull();       // pas plus haut que les pieds
    expect(ledgeRise({ feet: 15, height: 5, ground: 20, ceiling: 22 })).toBeNull();   // pas la place de s'y tenir
    expect(ledgeRise({ feet: 15, height: 5, ground: NaN })).toBeNull();
  });
  it("coût : la hauteur au prix de l'escalade, plus une case", () => {
    expect(ledgeCost({ rise: 5, multiplier: 2, gridDistance: 5 })).toBe(15);
    expect(ledgeCost({ rise: 5, multiplier: 1, gridDistance: 5 })).toBe(10);
  });
});
