import { describe, it, expect } from "vitest";
import { ritualMode, recoveryBudget, recoverableLevels } from "../module/scripts/core/grimoire.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

const base = { ritual: true, requiresSlot: true, inCombat: false, prepared: true, adept: false, slotLeft: true };

describe("§139 : rituels", () => {
  it("préparé avec un emplacement : au joueur ; sans emplacement : en rituel", () => {
    expect(ritualMode(base)).toBe("ask");
    expect(ritualMode({ ...base, slotLeft: false })).toBe("ritual");
  });
  it("non préparé : en rituel seulement avec Savoir rituel", () => {
    expect(ritualMode({ ...base, prepared: false })).toBe("none");
    expect(ritualMode({ ...base, prepared: false, adept: true })).toBe("ritual");
    expect(ritualMode({ ...base, prepared: false, adept: true, slotLeft: false })).toBe("ritual");
  });
  it("jamais en combat, ni pour un sort sans l'étiquette, ni sans emplacement à dépenser", () => {
    expect(ritualMode({ ...base, inCombat: true, adept: true, slotLeft: false })).toBe("none");
    expect(ritualMode({ ...base, ritual: false, slotLeft: false })).toBe("none");
    expect(ritualMode({ ...base, requiresSlot: false })).toBe("none");
  });
});

describe("§139 : Restauration magique", () => {
  it("la moitié du niveau, arrondie au supérieur", () => {
    expect(recoveryBudget(1)).toBe(1);
    expect(recoveryBudget(5)).toBe(3);
    expect(recoveryBudget(20)).toBe(10);
  });
  it("niveaux dépensés, dans le budget, jamais au-delà du 5e", () => {
    const slots = { 1: { value: 0, max: 4 }, 2: { value: 3, max: 3 }, 3: { value: 1, max: 3 }, 6: { value: 0, max: 1 } };
    expect(recoverableLevels(slots, 3)).toEqual([1, 3]);
    expect(recoverableLevels(slots, 2)).toEqual([1]);
    expect(recoverableLevels(slots, 10)).toEqual([1, 3]);
    expect(recoverableLevels(slots, 0)).toEqual([]);
  });
  it("les déclarations sont valides", () => {
    expect(validateEntry(SHIPPED["ritual-adept"])).toEqual([]);
    expect(validateEntry(SHIPPED["arcane-recovery"])).toEqual([]);
    expect(validateEntry({ slotRecovery: { maxLevel: 5 } }).length).toBeGreaterThan(0);
  });
});
