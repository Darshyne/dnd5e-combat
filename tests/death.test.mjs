import { describe, it, expect } from "vitest";
import { makesDeathSaves, damageAtZero, needsDeathSave, statusAfterDeathSave } from "../module/scripts/core/death.mjs";

describe("qui fait des jets contre la mort", () => {
  it("les PJ et les PNJ importants, pas les autres PNJ", () => {
    expect(makesDeathSaves({ type: "character" })).toBe(true);
    expect(makesDeathSaves({ type: "npc", important: true })).toBe(true);
    expect(makesDeathSaves({ type: "npc", important: false })).toBe(false);
    expect(makesDeathSaves({ type: "vehicle" })).toBe(false);
  });
});

describe("dégâts et 0 PV", () => {
  const pj = { max: 30, saves: true };

  it("tomber à 0 sans reste suffisant : rien de plus (le système pose Inconscient)", () => {
    expect(damageAtZero({ ...pj, hp: 10, through: 25 })).toMatchObject({ failures: null, dead: false });
  });
  it("Mort sur le coup : le reste atteint les PV max", () => {
    expect(damageAtZero({ ...pj, hp: 10, through: 40 })).toMatchObject({ dead: true, reason: "massive", failures: null });
    expect(damageAtZero({ ...pj, hp: 10, through: 39 }).dead).toBe(false);
  });
  it("à 0 PV : un échec, deux sur un coup critique", () => {
    expect(damageAtZero({ ...pj, hp: 0, through: 5 })).toMatchObject({ failures: 1, added: 1, dead: false, unstable: true });
    expect(damageAtZero({ ...pj, hp: 0, through: 5, critical: true, failures: 0 })).toMatchObject({ failures: 2, added: 2 });
  });
  it("à 0 PV : le troisième échec tue, sans dépasser trois", () => {
    expect(damageAtZero({ ...pj, hp: 0, through: 5, failures: 2 })).toMatchObject({ failures: 3, dead: true, reason: "failures" });
    expect(damageAtZero({ ...pj, hp: 0, through: 5, failures: 2, critical: true }).failures).toBe(3);
  });
  it("à 0 PV : des dégâts au moins égaux aux PV max tuent", () => {
    expect(damageAtZero({ ...pj, hp: 0, through: 30 })).toMatchObject({ dead: true, reason: "massive" });
  });
  it("rien pour qui ne fait pas de jets contre la mort, ni sans dégâts qui passent les PV temporaires", () => {
    expect(damageAtZero({ hp: 0, max: 30, through: 50, saves: false }).dead).toBe(false);
    expect(damageAtZero({ ...pj, hp: 0, through: 0 }).failures).toBeNull();
  });
});

describe("jet contre la mort en début de tour", () => {
  const base = { hp: 0, saves: true, statuses: ["unconscious"] };
  it("à 0 PV, ni stabilisé ni mort : oui", () => {
    expect(needsDeathSave(base)).toBe(true);
    expect(needsDeathSave({ ...base, failures: 2, successes: 2 })).toBe(true);
  });
  it("non : PV au-dessus de 0, stabilisé, mort, trois échecs, ou pas de jets contre la mort", () => {
    expect(needsDeathSave({ ...base, hp: 1 })).toBe(false);
    expect(needsDeathSave({ ...base, statuses: ["stable"] })).toBe(false);
    expect(needsDeathSave({ ...base, statuses: ["dead"] })).toBe(false);
    expect(needsDeathSave({ ...base, failures: 3 })).toBe(false);
    expect(needsDeathSave({ ...base, saves: false })).toBe(false);
  });
});

describe("après un jet contre la mort", () => {
  it("trois succès : Stabilisé ; trois échecs : Mort ; sinon rien", () => {
    expect(statusAfterDeathSave("stable")).toBe("stable");
    expect(statusAfterDeathSave("death")).toBe("dead");
    expect(statusAfterDeathSave("revive")).toBeNull();
    expect(statusAfterDeathSave(null)).toBeNull();
  });
});

import { downedStatus, isDead } from "../module/scripts/core/death.mjs";

describe("§17.1 : l'état obligatoire à 0 PV", () => {
  it("PNJ ordinaire à 0 PV : Mort ; PJ : Inconscient ; trois échecs : Mort", () => {
    expect(downedStatus({ hp: 0, saves: false, statuses: [] })).toBe("dead");
    expect(downedStatus({ hp: 0, saves: true, statuses: [] })).toBe("unconscious");
    expect(downedStatus({ hp: 0, saves: true, statuses: ["unconscious"], failures: 3 })).toBe("dead");
  });
  it("rien à poser : PV restants, déjà mort, déjà inconscient", () => {
    expect(downedStatus({ hp: 3, saves: false, statuses: [] })).toBe(null);
    expect(downedStatus({ hp: 0, saves: false, statuses: ["dead"] })).toBe(null);
    expect(downedStatus({ hp: 0, saves: true, statuses: ["unconscious", "incapacitated"] })).toBe(null);
  });
  it("mort : l'état, ou 0 PV sans jets contre la mort", () => {
    expect(isDead({ hp: 0, saves: false, statuses: [] })).toBe(true);
    expect(isDead({ hp: 0, saves: true, statuses: ["unconscious"] })).toBe(false);
    expect(isDead({ hp: 5, saves: true, statuses: ["dead"] })).toBe(true);
  });
});

import { canStabilize } from "../module/scripts/core/death.mjs";

describe("§50 : stabiliser (trousse de soins)", () => {
  it("à 0 PV, ni morte ni déjà stable", () => {
    expect(canStabilize({ hp: 0, statuses: ["unconscious"] })).toBe(true);
    expect(canStabilize({ hp: 3, statuses: [] })).toBe(false);
    expect(canStabilize({ hp: 0, statuses: ["dead"] })).toBe(false);
    expect(canStabilize({ hp: 0, statuses: ["unconscious", "stable"] })).toBe(false);
  });
});
