import { describe, it, expect } from "vitest";
import { ammoChoice } from "../module/scripts/core/ammo.mjs";

const fleches = { id: "fleches0000000001", quantity: 20 };
const plusUn = { id: "flechesPlus000001", quantity: 5 };
const vides = { id: "flechesVides00001", quantity: 0 };

describe("ammoChoice (§274)", () => {
  it("une seule munition utilisable : tirée sans demander", () => {
    expect(ammoChoice({ options: [fleches, vides] })).toMatchObject({ use: fleches.id, ask: false });
  });
  it("plusieurs utilisables : demande, la dernière présélectionnée", () => {
    expect(ammoChoice({ options: [fleches, plusUn], remembered: plusUn.id })).toMatchObject({ use: plusUn.id, ask: true });
  });
  it("une dernière munition épuisée ou oubliée : la première utilisable est présélectionnée", () => {
    expect(ammoChoice({ options: [vides, plusUn, fleches], remembered: vides.id })).toMatchObject({ use: plusUn.id, ask: true });
    expect(ammoChoice({ options: [fleches, plusUn], remembered: "" }).use).toBe(fleches.id);
  });
  it("une munition imposée par l'appelant ne demande rien", () => {
    expect(ammoChoice({ options: [fleches, plusUn], remembered: fleches.id, explicit: plusUn.id })).toMatchObject({ use: plusUn.id, ask: false });
  });
  it("une munition imposée inconnue de l'arme est ignorée", () => {
    expect(ammoChoice({ options: [fleches, plusUn], explicit: "inconnue00000000" }).ask).toBe(true);
  });
  it("plus rien d'utilisable : la mémoire de dnd5e est laissée, sans demander", () => {
    expect(ammoChoice({ options: [vides], remembered: vides.id })).toMatchObject({ use: vides.id, ask: false });
    expect(ammoChoice({ options: [] })).toMatchObject({ use: null, ask: false });
  });
});
