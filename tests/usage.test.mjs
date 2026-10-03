import { describe, it, expect } from "vitest";
import { pickSpellSlot } from "../module/scripts/core/usage.mjs";

describe("§68 : l'emplacement d'une utilisation sans fenêtre", () => {
  const slots = { spell1: { value: 0, level: 1 }, spell2: { value: 2, level: 2 }, spell3: { value: 1, level: 3 }, pact: { value: 1, level: 2 } };
  it("celui que dnd5e propose, s'il en reste", () => expect(pickSpellSlot(slots, "spell2", 1)).toBe("spell2"));
  it("sinon le plus bas qui en a encore (l'emplacement ordinaire avant le pacte à niveau égal)", () => {
    expect(pickSpellSlot(slots, "spell1", 1)).toBe("spell2");
    expect(pickSpellSlot({ ...slots, spell2: { value: 0, level: 2 } }, "spell1", 1)).toBe("pact");
  });
  it("jamais en dessous du niveau du sort", () => expect(pickSpellSlot(slots, "spell1", 3)).toBe("spell3"));
  it("null : plus aucun emplacement", () => {
    expect(pickSpellSlot({ spell1: { value: 0, level: 1 }, pact: { value: 0, level: 1 } }, "spell1", 1)).toBeNull();
  });
});
