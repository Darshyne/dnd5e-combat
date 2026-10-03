import { describe, it, expect } from "vitest";
import { chooseRoller } from "../module/scripts/core/roller.mjs";

const u = (id, over = {}) => ({ id, active: true, isGM: false, owner: true, ...over });

describe("chooseRoller", () => {
  it("le moteur lance pour un PNJ que seul le MJ possède", () => {
    expect(chooseRoller([u("mj", { isGM: true })])).toBeNull();
  });
  it("le joueur connecté lance pour son PJ", () => {
    expect(chooseRoller([u("mj", { isGM: true }), u("alice")])).toBe("alice");
  });
  it("le moteur lance si le joueur est absent", () => {
    expect(chooseRoller([u("mj", { isGM: true }), u("alice", { active: false })])).toBeNull();
  });
  it("ignore un joueur connecté qui ne possède pas l'acteur", () => {
    expect(chooseRoller([u("bob", { owner: false })])).toBeNull();
  });
  it("désigne toujours le même joueur quand un PJ est partagé", () => {
    expect(chooseRoller([u("zoe"), u("alice")])).toBe("alice");
    expect(chooseRoller([u("alice"), u("zoe")])).toBe("alice");
  });
});
