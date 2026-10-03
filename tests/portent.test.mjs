import { describe, it, expect } from "vitest";
import { readPortent, canForetell, portentChoices, spendPortent, foretoldRange } from "../module/scripts/core/portent.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§36 : Présage", () => {
  it("lit l'état tel quel, sans valeur hors d'un d20", () => {
    expect(readPortent(undefined)).toEqual({ rolls: [], turn: null });
    expect(readPortent({ rolls: [7, 0, 21, 3.5, "12", 20, 1], turn: 4 })).toEqual({ rolls: [7, 20, 1], turn: null });
  });

  it("une fois par tour en combat, sans limite hors combat, rien sans jet noté", () => {
    expect(canForetell({ rolls: [7] }, null)).toBe(true);
    expect(canForetell({ rolls: [7], turn: "c.1.2" }, "c.1.2")).toBe(false);
    expect(canForetell({ rolls: [7], turn: "c.1.2" }, "c.1.3")).toBe(true);
    expect(canForetell({ rolls: [7], turn: "c.1.2" }, null)).toBe(true);
    expect(canForetell({ rolls: [] }, null)).toBe(false);
  });

  it("propose chaque valeur une fois, de la plus haute à la plus basse", () => {
    expect(portentChoices({ rolls: [4, 17, 4] })).toEqual([17, 4]);
  });

  it("dépense une seule occurrence et retient le tour", () => {
    expect(spendPortent({ rolls: [4, 17, 4] }, 4, "c.2.0")).toEqual({ rolls: [17, 4], turn: "c.2.0" });
    expect(spendPortent({ rolls: [4] }, 9, null)).toBeNull();
  });

  it("borne le d20 à la valeur notée", () => {
    expect(foretoldRange(20)).toEqual({ minimum: 20, maximum: 20 });
  });

  it("contenu : `portent: { dice }`, entier positif — Présage 2, Présage supérieur 3", () => {
    expect(validateEntry({ portent: { dice: 2 } }, { facts: {} })).toEqual([]);
    expect(validateEntry({ portent: { dice: 0 } }, { facts: {} })).toEqual(["portent : { dice } (entier positif)"]);
    expect(validateEntry({ portent: { dice: 2, keep: true } }, { facts: {} })).toEqual(["portent : { dice } (entier positif)"]);
    expect(CONTENT["portent"].portent.dice).toBe(2);
    expect(CONTENT["greater-portent"].portent.dice).toBe(3);
  });
});
