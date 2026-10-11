import { describe, it, expect } from "vitest";
import { versatileGrip } from "../module/scripts/core/attack.mjs";

const modes = ["oneHanded", "twoHanded", "thrown"];
describe("§149 : arme Polyvalente, la prise", () => {
  it("l'autre main libre : à deux mains (sans mode, ou à une main par défaut / mémoire)", () => {
    expect(versatileGrip({ mode: null, modes, explicit: false, otherHandBusy: false })).toBe("twoHanded");
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: false, otherHandBusy: false })).toBe("twoHanded");
    expect(versatileGrip({ mode: "twoHanded", modes, explicit: false, otherHandBusy: false })).toBe(null);
  });
  it("l'autre main prise : à une main, même si la mémoire disait deux mains", () => {
    expect(versatileGrip({ mode: "twoHanded", modes, explicit: false, otherHandBusy: true })).toBe("oneHanded");
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: false, otherHandBusy: true })).toBe(null);
  });
  it("un choix du joueur, un lancer, une arme sans prise à deux mains : rien ne change", () => {
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: true, otherHandBusy: false })).toBe(null);
    expect(versatileGrip({ mode: "thrown", modes, explicit: false, otherHandBusy: false })).toBe(null);
    expect(versatileGrip({ mode: null, modes: ["oneHanded"], explicit: false, otherHandBusy: false })).toBe(null);
  });

  it("§151 : dégâts à deux mains vides — reste à une main, même si dnd5e se souvenait des deux mains", () => {
    expect(versatileGrip({ mode: null, modes, explicit: false, otherHandBusy: false, twoHandedDamage: false })).toBe("oneHanded");
    expect(versatileGrip({ mode: "twoHanded", modes, explicit: false, otherHandBusy: false, twoHandedDamage: false })).toBe("oneHanded");
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: false, otherHandBusy: false, twoHandedDamage: false })).toBe(null);
  });
});
