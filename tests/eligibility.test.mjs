import { describe, it, expect } from "vitest";
import { typeAllowed, blockedStatuses, immuneToAll, CREATURE_TYPES } from "../module/scripts/core/eligibility.mjs";

describe("type de créature (§16.8)", () => {
  it("« un Humanoïde » : oui pour un humanoïde, non pour un mort-vivant", () => {
    expect(typeAllowed(["humanoid"], "humanoid")).toBe(true);
    expect(typeAllowed(["humanoid"], "undead")).toBe(false);
  });
  it("sans restriction, ou sans type connu : permis (jamais de refus par ignorance)", () => {
    expect(typeAllowed(null, "undead")).toBe(true);
    expect(typeAllowed([], "undead")).toBe(true);
    expect(typeAllowed(["beast"], null)).toBe(true);
  });
  it("connaît les quatorze types de dnd5e", () => {
    expect(CREATURE_TYPES).toHaveLength(14);
    expect(CREATURE_TYPES).toContain("humanoid");
  });
});

describe("immunités aux états (§16.8)", () => {
  it("les états bloqués d'un effet", () => {
    expect(blockedStatuses(["charmed", "incapacitated"], ["charmed", "poisoned"])).toEqual(["charmed"]);
    expect(blockedStatuses(["paralyzed"], [])).toEqual([]);
  });
  it("une action qui ne fait que poser des effets bloqués n'affecte pas la créature", () => {
    expect(immuneToAll({ effects: [["charmed", "incapacitated"]] }, ["charmed"])).toBe("charmed");
    expect(immuneToAll({ effects: [["paralyzed"], ["charmed"]] }, ["charmed"])).toBeNull();   // un effet passe
  });
  it("des dégâts, un soin ou une étape d'issue l'affectent quand même ; sans effet, rien à juger", () => {
    expect(immuneToAll({ damage: true, effects: [["poisoned"]] }, ["poisoned"])).toBeNull();
    expect(immuneToAll({ steps: true, effects: [["poisoned"]] }, ["poisoned"])).toBeNull();
    expect(immuneToAll({ effects: [] }, ["poisoned"])).toBeNull();
    expect(immuneToAll({ effects: [[]] }, ["poisoned"])).toBeNull();   // un effet sans état n'est jamais bloqué
  });
});
