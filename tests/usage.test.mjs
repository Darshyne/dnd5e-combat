import { describe, it, expect } from "vitest";
import { pickSpellSlot, misplacedSelfUses, canCastHigher } from "../module/scripts/core/usage.mjs";

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

describe("§77 : utilisations de l'activité posées sur l'item", () => {
  const self = [{ type: "activityUses", target: "" }, { type: "itemUses", target: "" }, { type: "activityUses", target: "aaaaaaaaaaaaaaaa" }];
  it("l'activité sans maximum, l'item avec : ses propres utilisations deviennent celles de l'item", () => expect(misplacedSelfUses(self, false, true)).toEqual([0]));
  it("sinon rien", () => {
    expect(misplacedSelfUses(self, true, true)).toEqual([]);
    expect(misplacedSelfUses(self, false, false)).toEqual([]);
  });
});

describe("§106 : un sort lançable plus haut garde la fenêtre de dnd5e", () => {
  const slots = { spell1: { value: 2, level: 1 }, spell2: { value: 0, level: 2 }, spell3: { value: 1, level: 3 }, pact: { value: 0, level: 3 } };
  it("un emplacement plus haut reste", () => expect(canCastHigher(slots, 1)).toBe(true));
  it("rien au-dessus du niveau du sort", () => expect(canCastHigher(slots, 3)).toBe(false));
  it("les emplacements vides ne comptent pas", () => expect(canCastHigher({ ...slots, spell3: { value: 0, level: 3 } }, 1)).toBe(false));
  it("le pacte compte, à son niveau", () => expect(canCastHigher({ spell1: { value: 0, level: 1 }, pact: { value: 1, level: 3 } }, 2)).toBe(true));
});
