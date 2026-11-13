import { describe, it, expect } from "vitest";
import { knownFormsMax, formRefusal, formMustEnd, moonLevelsFormula, moonSpellLists } from "../module/scripts/core/wildshape.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("formes connues", () => {
  it("4 au niveau 2, 6 au niveau 4, 8 au niveau 8", () => {
    expect([1, 2, 3, 4, 7, 8, 20].map(knownFormsMax)).toEqual([0, 4, 4, 6, 6, 8, 8]);
  });
});

describe("forme permise par le profil", () => {
  const wolf = { cr: 0.25, type: "beast", fly: 0 };
  const owl = { cr: 0, type: "beast", fly: 60 };
  const bear = { cr: 1, type: "beast", fly: 0 };
  const imp = { cr: 1, type: "fiend", fly: 40 };
  const limits = { maxCr: 0.25, types: ["beast"], noMovement: ["fly"] };
  it("FP, type, vol", () => {
    expect(formRefusal(wolf, limits)).toBe(null);
    expect(formRefusal(bear, limits)).toBe("cr");
    expect(formRefusal(owl, limits)).toBe("fly");
    expect(formRefusal(imp, { ...limits, maxCr: 2 })).toBe("type");
  });
  it("sans limite de vol (niveau 8)", () => {
    expect(formRefusal(owl, { maxCr: 1, types: ["beast"], noMovement: [] })).toBe(null);
  });
});

describe("fin de la forme", () => {
  const incapacitating = ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"];
  it("0 PV ou Neutralisé", () => {
    expect(formMustEnd({ hp: 0, statuses: [] }, incapacitating)).toBe(true);
    expect(formMustEnd({ hp: 12, statuses: ["unconscious"] }, incapacitating)).toBe(true);
    expect(formMustEnd({ hp: 12, statuses: ["prone", "frightened"] }, incapacitating)).toBe(false);
  });
});

describe("durée d'une invocation (summon.lasts)", () => {
  it("valide, ou refusée", () => {
    expect(validateEntry({ summon: { initiative: "own", lasts: { value: "floor(@classes.druid.levels / 2)", units: "hour" } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "own", lasts: { value: "", units: "hour" } } })).toEqual(["summon.lasts: { value, units }"]);
  });
});

describe("§432 : Cercle de la Lune sous ses deux identifiants (Manuel des joueurs `moon`, dnd5e 6.1 `circle-moon`)", () => {
  const BOTH = "max(@subclasses.circle-moon.levels, @subclasses.moon.levels)";
  it("le préréglage de dnd5e 6.1 lit aussi `moon`", () => {
    expect(moonLevelsFormula("(13 + @abilities.wis.mod) * sign(@subclasses.circle-moon.levels)"))
      .toBe(`(13 + @abilities.wis.mod) * sign(${BOTH})`);
    expect(moonLevelsFormula("max(@classes.druid.levels, @subclasses.circle-moon.levels * 3)"))
      .toBe(`max(@classes.druid.levels, ${BOTH} * 3)`);
  });
  it("le préréglage de dnd5e 6.0 lit aussi `circle-moon`", () => {
    expect(moonLevelsFormula("max(@classes.druid.levels, @subclasses.moon.levels * 3)"))
      .toBe(`max(@classes.druid.levels, ${BOTH} * 3)`);
  });
  it("déjà élargie, sans Lune, vide ou absente : telle quelle", () => {
    const widened = moonLevelsFormula("@subclasses.moon.levels * 3");
    expect(moonLevelsFormula(widened)).toBe(widened);
    expect(moonLevelsFormula("@classes.druid.levels")).toBe("@classes.druid.levels");
    expect(moonLevelsFormula("@subclasses.moonlight.levels")).toBe("@subclasses.moonlight.levels");
    expect(moonLevelsFormula("")).toBe("");
    expect(moonLevelsFormula(undefined)).toBe(undefined);
  });
  it("les sorts du cercle : la liste de l'autre identifiant s'ajoute", () => {
    expect(moonSpellLists(new Set(["subclass:circle-moon"])).sort()).toEqual(["subclass:circle-moon", "subclass:moon"]);
    expect(moonSpellLists(["subclass:moon", "class:druid"]).sort()).toEqual(["class:druid", "subclass:circle-moon", "subclass:moon"]);
    expect(moonSpellLists(["class:druid"])).toEqual(["class:druid"]);
    expect(moonSpellLists(undefined)).toEqual([]);
  });
});
