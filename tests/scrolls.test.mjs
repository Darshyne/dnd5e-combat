import { describe, expect, it } from "vitest";
import { scrollCandidates, scrollSpell, slug, spellPartOf } from "../module/scripts/core/scrolls.mjs";

// Les parchemins relevés dans `ravenloft-test` le 2026-10-02 (SPEC §48).
const known = new Map([
  ["healing-word", { identifier: "healing-word", level: 1, school: "evo" }],
  ["mot-de-guerison", { identifier: "healing-word", level: 1, school: "evo" }],
  ["command", { identifier: "command", level: 1, school: "enc" }],
  ["toll-the-dead", { identifier: "toll-the-dead", level: 0, school: "nec" }],
  ["spiritual-weapon", { identifier: "spiritual-weapon", level: 2, school: "evo" }],
  ["protection-from-poison", { identifier: "protection-from-poison", level: 2, school: "abj" }],
  ["protection-contre-le-poison", { identifier: "protection-from-poison", level: 2, school: "abj" }]
]);
const of = (name, originalNames=[], level=null, stamped=null) =>
  scrollSpell({ stamped, candidates: scrollCandidates({ name, originalNames }), known, level });

describe("slug et nom du sort", () => {
  it("à la façon de dnd5e : sans accents ni ponctuation", () => {
    expect(slug("Mot de guérison")).toBe("mot-de-guerison");
    expect(slug("Melf's Acid Arrow")).toBe("melfs-acid-arrow");
    expect(slug("Blindness/Deafness")).toBe("blindness-deafness");
    // Comme dnd5e : son « a/b » → « a-b » ne voit pas une lettre accentuée (\w), la barre est ensuite retirée.
    expect(slug("Cécité/Surdité")).toBe("cecitesurdite");
  });
  it("ce qui suit les deux-points", () => {
    expect(spellPartOf("Parchemin de sort : Mot de guérison")).toBe("Mot de guérison");
    expect(spellPartOf("Healing Word")).toBe("Healing Word");
  });
});

describe("le sort d'un parchemin", () => {
  it("dnd5e traduit par Babele : le nom anglais d'origine", () => {
    expect(of("Parchemin: Mot de guérison", ["Healing Word"], 1)).toEqual({ identifier: "healing-word", level: 1, school: "evo" });
  });
  it("import D&D Beyond : le nom d'origine de l'import, pas celui du parchemin de base", () => {
    expect(of("Parchemin: Command", ["Spell Scroll, 1st Level", "Command"], 1)?.identifier).toBe("command");
    expect(of("Parchemin: Toll the Dead", ["Spell Scroll, Cantrip", "Toll the Dead"], 0)).toEqual({ identifier: "toll-the-dead", level: 0, school: "nec" });
  });
  it("ancien parchemin anglais : le nom seul", () => {
    expect(of("Spell Scroll: Spiritual Weapon", [], 2)?.identifier).toBe("spiritual-weapon");
  });
  it("nom français seul : retrouvé par l'index des noms traduits", () => {
    expect(of("Parchemin: Protection contre le poison")?.identifier).toBe("protection-from-poison");
  });
  it("le niveau du parchemin l'emporte, sinon celui du sort", () => {
    expect(of("Spell Scroll: Spiritual Weapon", [], 4)?.level).toBe(4);
    expect(of("Spell Scroll: Spiritual Weapon")?.level).toBe(2);
  });
  it("le sort noté à la création passe avant les noms", () => {
    expect(of("Parchemin: Mot de guérison", [], 1, { identifier: "cure-wounds", level: 1, school: "abj" })?.identifier).toBe("cure-wounds");
  });
  it("un parchemin de base, ou un sort inconnu : rien", () => {
    expect(of("Parchemin de sort : 1er niveau", ["Spell Scroll 1st Level"])).toBeNull();
    expect(of("Spell Scroll, 1st Level")).toBeNull();
    expect(of("Parchemin: Sort maison")).toBeNull();
  });
  it("les noms du parchemin de base ne sont jamais candidats", () => {
    expect(scrollCandidates({ name: "Parchemin de sort : 2e niveau", originalNames: ["Spell Scroll, 2nd Level"] })).toEqual([]);
  });
});
