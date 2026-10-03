import { describe, it, expect } from "vitest";
import {
  freshBudget, costOf, checkUse, spendUse, dash, disengage, dodge, toggleResource, movementAllowance
} from "../module/scripts/core/turn.mjs";
import { rangeIssue } from "../module/scripts/core/range.mjs";

const spell = { cost: "action", weaponAttack: false, usesSpellSlot: true };
const cantrip = { cost: "action", weaponAttack: false, usesSpellSlot: false };
const sword = { cost: "action", weaponAttack: true, usesSpellSlot: false };
const bonusSpell = { cost: "bonus", weaponAttack: false, usesSpellSlot: true };
const shield = { cost: "reaction", weaponAttack: false, usesSpellSlot: true };
const mine = { isOwnTurn: true, attacksPerAction: 1 };
const theirs = { isOwnTurn: false, attacksPerAction: 1 };

describe("coût", () => {
  it("ne compte que action, action bonus et réaction", () => {
    expect(["action", "bonus", "reaction", "minute", "legendary", "special", ""].map(costOf))
      .toEqual(["action", "bonus", "reaction", null, null, null, null]);
  });
  it("une activité hors budget ne pose jamais de problème et ne coûte rien", () => {
    const free = { cost: null, weaponAttack: false, usesSpellSlot: false };
    expect(checkUse(freshBudget(), free, theirs)).toEqual([]);
    expect(spendUse(freshBudget(), free, mine)).toEqual(freshBudget());
  });
});

describe("légalité", () => {
  it("tout est permis en début de tour", () => {
    expect(checkUse(freshBudget(), spell, mine)).toEqual([]);
  });
  it("signale une action déjà dépensée", () => {
    expect(checkUse(spendUse(freshBudget(), cantrip, mine), cantrip, mine)).toEqual(["noAction"]);
  });
  it("signale une action hors de son tour, mais pas une réaction", () => {
    expect(checkUse(freshBudget(), sword, theirs)).toEqual(["notYourTurn"]);
    expect(checkUse(freshBudget(), shield, theirs)).toEqual([]);
  });
  it("signale une réaction déjà dépensée", () => {
    expect(checkUse(spendUse(freshBudget(), shield, theirs), shield, theirs)).toEqual(["noReaction"]);
  });
  it("règle 2024 : un seul sort à emplacement par tour", () => {
    const after = spendUse(freshBudget(), bonusSpell, mine);
    expect(checkUse(after, spell, mine)).toEqual(["slotAlreadyCast"]);
    expect(checkUse(after, cantrip, mine)).toEqual([]);
  });
  it("Bouclier au tour d'un autre n'entame pas le sort de son propre tour", () => {
    const after = spendUse(freshBudget(), shield, theirs);
    expect(after.slotCast).toBe(false);
  });
});

describe("action Attaquer et attaques multiples", () => {
  const fighter = { isOwnTurn: true, attacksPerAction: 2 };

  it("la première attaque paie l'action et ouvre les suivantes", () => {
    const after = spendUse(freshBudget(), sword, fighter);
    expect(after).toMatchObject({ action: 0, attacks: { granted: 2, used: 1 } });
    expect(checkUse(after, sword, fighter)).toEqual([]);
  });
  it("la deuxième attaque ne coûte plus rien, la troisième est signalée", () => {
    const after = spendUse(spendUse(freshBudget(), sword, fighter), sword, fighter);
    expect(after.attacks).toEqual({ granted: 2, used: 2 });
    expect(checkUse(after, sword, fighter)).toEqual(["noAction"]);
  });
  it("une attaque supplémentaire ne couvre pas un sort", () => {
    expect(checkUse(spendUse(freshBudget(), sword, fighter), cantrip, fighter)).toEqual(["noAction"]);
  });
  it("sans attaque supplémentaire, une seule attaque", () => {
    expect(checkUse(spendUse(freshBudget(), sword, mine), sword, mine)).toEqual(["noAction"]);
  });
  it("une dépense confirmée au-delà du budget ne descend pas sous zéro", () => {
    const after = spendUse(spendUse(freshBudget(), cantrip, mine), cantrip, mine);
    expect(after.action).toBe(0);
  });
});

describe("Foncer, corrections, déplacement", () => {
  it("Foncer coûte l'action et double le déplacement", () => {
    const after = dash(freshBudget());
    expect(after).toMatchObject({ action: 0, dashed: true });
    expect(movementAllowance(after, 9)).toBe(18);
    expect(movementAllowance(freshBudget(), 9)).toBe(9);
  });
  it("Se désengager coûte l'action, une seule fois", () => {
    const after = disengage(freshBudget());
    expect(after).toMatchObject({ action: 0, disengaged: true });
    expect(disengage(after)).toBe(after);
  });
  it("Esquiver coûte l'action, une seule fois", () => {
    const after = dodge(freshBudget());
    expect(after).toMatchObject({ action: 0, dodging: true });
    expect(dodge(after)).toBe(after);
  });
  it("Foncer sans action disponible ne change rien", () => {
    const spent = spendUse(freshBudget(), cantrip, mine);
    expect(dash(spent)).toBe(spent);
  });
  it("une pastille se corrige à la main dans les deux sens", () => {
    const off = toggleResource(freshBudget(), "bonus");
    expect(off.bonus).toBe(0);
    expect(toggleResource(off, "bonus").bonus).toBe(1);
  });
  it("ne modifie jamais le budget d'origine", () => {
    const budget = freshBudget();
    spendUse(budget, sword, { isOwnTurn: true, attacksPerAction: 2 });
    dash(budget);
    expect(budget).toEqual(freshBudget());
  });
});

describe("portée", () => {
  const factors = { ft: 1, m: 10 / 3 };
  const m = value => ({ value, units: "m" });

  it("un arc en pieds dans un monde métrique : portée normale, longue, hors de portée", () => {
    const bow = { value: 80, long: 320, units: "ft" };   // 24 m / 96 m
    expect(rangeIssue(m(24), bow, factors)).toBeNull();
    expect(rangeIssue(m(25.5), bow, factors)).toBe("longRange");
    expect(rangeIssue(m(97.5), bow, factors)).toBe("outOfRange");
  });
  it("une allonge de 1,5 m atteint la case voisine, pas la suivante", () => {
    const reach = { value: 1.5, units: "m" };
    expect(rangeIssue(m(1.5), reach, factors)).toBeNull();
    expect(rangeIssue(m(3), reach, factors)).toBe("outOfRange");
  });
  it("ne dit rien d'une portée sans valeur (soi, contact, spéciale)", () => {
    expect(rangeIssue(m(30), { value: null, units: "self" }, factors)).toBeNull();
    expect(rangeIssue(m(30), { value: 10, units: "spec" }, factors)).toBeNull();
  });
});

describe("coût gratuit (§16.27)", () => {
  it("un rayon enchaîné ou un rebond ne demande rien, même hors tour ou après un sort à emplacement", () => {
    const budget = { ...freshBudget(), action: 0, slotCast: true };
    expect(checkUse(budget, { cost: "free", usesSpellSlot: true, weaponAttack: false }, { isOwnTurn: false })).toEqual([]);
  });
});

import { standUpCost } from "../module/scripts/core/turn.mjs";

describe("§17.2 : se relever", () => {
  it("coûte la moitié de la vitesse, s'il en reste assez", () => {
    expect(standUpCost({ speed: 30, remaining: 30 })).toEqual({ cost: 15, issue: null });
    expect(standUpCost({ speed: 30, remaining: 15 })).toEqual({ cost: 15, issue: null });
    expect(standUpCost({ speed: 30, remaining: 10 })).toEqual({ cost: 15, issue: "noMovement" });
    expect(standUpCost({ speed: 0, remaining: Infinity }).issue).toBe("noSpeed");
    expect(standUpCost({ speed: 30, remaining: Infinity }).issue).toBe(null);
  });
});

describe("§19.6 : plusieurs réactions par round, une par tour", () => {
  it("trois réactions, mais pas deux dans le même tour de jeu", () => {
    let b = freshBudget({ reactions: 3 });
    const r = { cost: "reaction", weaponAttack: false, usesSpellSlot: false };
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.0" })).toEqual([]);
    b = spendUse(b, r, { isOwnTurn: false, attacksPerAction: 1, turnKey: "c.1.0" });
    expect(b.reaction).toBe(2);
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.0" })).toEqual(["noReaction"]);
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.1" })).toEqual([]);
  });
  it("une seule réaction : la règle ordinaire", () => {
    let b = freshBudget();
    const r = { cost: "reaction", weaponAttack: false, usesSpellSlot: false };
    b = spendUse(b, r, { isOwnTurn: false, attacksPerAction: 1, turnKey: "c.1.0" });
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.1" })).toEqual(["noReaction"]);
  });
});
