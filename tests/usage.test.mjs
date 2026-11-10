import { describe, it, expect } from "vitest";
import { pickSpellSlot, misplacedSelfUses, canCastHigher, forcedSpellSlot, atCastLevel, followUpScaling, castLevelUsage, spellCastLevel } from "../module/scripts/core/usage.mjs";

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

describe("§384 : un sort plus haut que l'emplacement de pacte (issue #38, Création de morts-vivants)", () => {
  const warlock = { pact: { value: 2, max: 2, level: 3 }, spell6: { value: 0, max: 0, level: 6 } };
  it("l'emplacement de pacte de niveau 3 ne lance pas un sort de niveau 6", () => {
    expect(pickSpellSlot(warlock, "pact", 6)).toBeNull();
    expect(pickSpellSlot(warlock, "pact", 3)).toBe("pact");
    expect(pickSpellSlot(warlock, "pact", 1)).toBe("pact");
  });
  it("lancé quand même par le MJ : au niveau du sort", () => {
    expect(forcedSpellSlot(warlock, "pact", 6)).toBe("spell6");
    expect(forcedSpellSlot(warlock, "pact", 3)).toBe("pact");
    expect(forcedSpellSlot({ spell5: { level: 5 } }, "spell5", 5)).toBe("spell5");
    expect(forcedSpellSlot({ spell7: { level: 7 } }, "spell7", 5)).toBe("spell7");
  });
  it("rien pour un tour de magie ou sans emplacement proposé", () => {
    expect(forcedSpellSlot(warlock, "pact", 0)).toBeNull();
    expect(forcedSpellSlot(warlock, null, 6)).toBeNull();
  });
});

describe("§404 : l'activité au niveau de lancement", () => {
  // Un item factice : `scaledClone(n)` rend une copie dont l'activité porte la montée.
  const itemOf = calls => {
    const item = {
      scaledClone: n => {
        calls.push(n);
        const clone = { flags: { scaling: n } };
        clone.system = { activities: new Map([["atk", { id: "atk", item: clone, dice: 3 + n }]]) };
        return clone;
      }
    };
    return item;
  };
  it("une montée d'emplacement → la copie mise à l'échelle, même id", () => {
    const calls = [];
    const activity = { id: "atk", item: itemOf(calls), dice: 3 };
    const scaled = atCastLevel(activity, 2);
    expect(calls).toEqual([2]);
    expect(scaled.id).toBe("atk");
    expect(scaled.dice).toBe(5);
  });
  it("une montée lue sur un message (chaîne) est convertie", () => {
    const calls = [];
    expect(atCastLevel({ id: "atk", item: itemOf(calls), dice: 3 }, "1").dice).toBe(4);
  });
  it("sans montée, négative ou illisible : l'activité telle quelle, sans clone", () => {
    const calls = [];
    const activity = { id: "atk", item: itemOf(calls), dice: 3 };
    for ( const s of [0, null, undefined, -1, "x"] ) expect(atCastLevel(activity, s)).toBe(activity);
    expect(calls).toEqual([]);
  });
  it("sans `scaledClone` (activité d'un objet non item) ou sans activité : inchangé", () => {
    const bare = { id: "atk", item: {} };
    expect(atCastLevel(bare, 2)).toBe(bare);
    expect(atCastLevel(null, 2)).toBeNull();
  });
  it("l'activité absente de la copie : l'activité d'origine", () => {
    const activity = { id: "autre", item: itemOf([]) };
    expect(atCastLevel(activity, 1)).toBe(activity);
  });
});

describe("§405 : une activité d'un sort sans emplacement, au niveau de sa concentration", () => {
  it("Lame de feu lancée au niveau 4 : l'attaque suivante à +2, emplacement de niveau 4 (rien n'est dépensé)", () => {
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, scaling: 0, concentrationScaling: 2 })).toEqual({ scaling: 2, slot: "spell4" });
  });
  it("une montée lue sur un effet (chaîne) est convertie", () => {
    expect(followUpScaling({ spellLevel: 1, consumesSlot: false, concentrationScaling: "1" })).toEqual({ scaling: 1, slot: "spell2" });
  });
  it("rien : activité qui dépense un emplacement, montée déjà fixée, concentration au niveau de base ou absente, tour de magie", () => {
    expect(followUpScaling({ spellLevel: 2, consumesSlot: true, concentrationScaling: 2 })).toBeNull();
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, scaling: 1, concentrationScaling: 2 })).toBeNull();
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, concentrationScaling: 0 })).toBeNull();
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false })).toBeNull();
    expect(followUpScaling({ spellLevel: 0, consumesSlot: false, concentrationScaling: 2 })).toBeNull();
  });
  it("`scaling: false` (dnd5e, mise à l'échelle interdite) n'empêche pas la reprise", () => {
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, scaling: false, concentrationScaling: 1 })).toEqual({ scaling: 1, slot: "spell3" });
  });
});

describe("§406 : une activité rejouée par le moteur au niveau du lancement (castLevelUsage)", () => {
  it("Boule de feu à retardement lancée au niveau 9 (sort de niveau 7, montée 2) : montée et emplacement de ce niveau", () => {
    expect(castLevelUsage(7, 2)).toEqual({ scaling: 2, spell: { slot: "spell9" } });
    expect(castLevelUsage("3", "1")).toEqual({ scaling: 1, spell: { slot: "spell4" } });
  });
  it("rien sans montée, ni pour un tour de magie", () => {
    expect(castLevelUsage(7, 0)).toEqual({});
    expect(castLevelUsage(7, undefined)).toEqual({});
    expect(castLevelUsage(0, 2)).toEqual({});
  });
});

describe("§406 : le niveau de lancement lu sur une copie mise à l'échelle (spellCastLevel)", () => {
  it("niveau du sort + montée (`flags.dnd5e.scaling`) ; le niveau du sort seul sans montée", () => {
    expect(spellCastLevel({ system: { level: 1 }, flags: { dnd5e: { scaling: 2 } } })).toBe(3);
    expect(spellCastLevel({ system: { level: 3 }, flags: {} })).toBe(3);
    expect(spellCastLevel(null)).toBe(0);
  });
});
