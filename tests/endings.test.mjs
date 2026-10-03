import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

/** Fins de sorts (SPEC §42.2) : ce que le schéma accepte, et ce que le contenu livré déclare. */
describe("fins de sorts — schéma", () => {
  it("effectThen : un effet de l'item en suit un autre", () => {
    expect(validateEntry({ effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" } })).toEqual([]);
    expect(validateEntry({ effectThen: {} })).toEqual(["effectThen : { id d'effet: id d'effet }"]);
    expect(validateEntry({ effectThen: { NEFWcyysYgsE6de3: "NEFWcyysYgsE6de3" } })).toEqual(["effectThen.NEFWcyysYgsE6de3 : deux ids d'effets distincts (16 caractères)"]);
    expect(validateEntry({ effectThen: { NEFWcyysYgsE6de3: "court" } })).toHaveLength(1);
  });

  it("effectEnds : la fin du prochain tour du porteur", () => {
    expect(validateEntry({ effectEnds: { S5XcFawnnNHO8bUr: "bearerTurnEnd" } })).toEqual([]);
  });

  it("smite.effect : l'effet posé par le châtiment", () => {
    expect(validateEntry({ smite: { damage: "M4KS57lcf4K6fUMU", effect: "A0tTvLeRetrC708K" } })).toEqual([]);
    expect(validateEntry({ smite: { damage: "M4KS57lcf4K6fUMU", effect: "court" } })).toHaveLength(1);
  });

  it("resave.unlessSeesOrigin : true ou absent", () => {
    const entry = unless => ({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", unlessSeesOrigin: unless }] }] });
    expect(validateEntry(entry(true))).toEqual([]);
    expect(validateEntry(entry(false))).toEqual(["triggers[0].do[0].unlessSeesOrigin : true ou absent"]);
  });

  it("effectThen se fusionne clé par clé entre les couches", () => {
    const merged = mergeEntries([{ effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" } }, { effectThen: { A0tTvLeRetrC708K: "5FPaEGhqJ5yPP2Ln" } }]);
    expect(merged.effectThen).toEqual({ NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr", A0tTvLeRetrC708K: "5FPaEGhqJ5yPP2Ln" });
  });
});

describe("compteur et action de fin — schéma (§43)", () => {
  const resave = extra => ({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", ...extra }] }] });

  it("resave.tally : des seuils entiers positifs, un état facultatif", () => {
    expect(validateEntry(resave({ tally: { successes: 3, failures: 3 } }))).toEqual([]);
    expect(validateEntry(resave({ tally: { successes: 3, failures: 3, status: "petrified" } }))).toEqual([]);
    expect(validateEntry(resave({ tally: { successes: 0, failures: 3 } }))).toHaveLength(1);
    expect(validateEntry(resave({ tally: { successes: 3 } }))).toHaveLength(1);
    expect(validateEntry(resave({ tally: { successes: 3, failures: 3, consecutive: true } }))).toHaveLength(1);
    expect(validateEntry(resave({ keep: true, tally: { successes: 3, failures: 3 } }))).toEqual(["triggers[0].do[0].tally : sans objet avec keep"]);
  });

  it("actionEnds : par le porteur ou par un autre, avec ou sans jet", () => {
    const id = "MpToumiJ2o3S16K7";
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", roll: "save" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", roll: "check" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "other", verb: "wake" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "other", roll: "check" } } })).toEqual([]);
    // la sauvegarde du sort ne se rejoue que par celui qui la subit
    expect(validateEntry({ actionEnds: { [id]: { by: "other", roll: "save" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: { [id]: { by: "ally" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: { court: { by: "bearer" } } })).toHaveLength(1);
    // §49 : l'état que le porteur se donne en y mettant fin (feu grégeois : À terre) — le porteur seul, un état connu.
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", status: "prone" } } })).toEqual([]);
    expect(validateEntry({ actionEnds: { [id]: { by: "other", verb: "wake", status: "prone" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: { [id]: { by: "bearer", status: "dead" } } })).toHaveLength(1);
    expect(validateEntry({ actionEnds: {} })).toEqual(["actionEnds : { id d'effet: { by, roll?, verb? } }"]);
  });

  it("actionEnds se fusionne clé par clé entre les couches", () => {
    const merged = mergeEntries([{ actionEnds: { MpToumiJ2o3S16K7: { by: "bearer", roll: "save" } } }, { actionEnds: { QeYsfnjEj2T9A3C8: { by: "bearer" } } }]);
    expect(Object.keys(merged.actionEnds)).toEqual(["MpToumiJ2o3S16K7", "QeYsfnjEj2T9A3C8"]);
  });
});

describe("compteur et action de fin — contenu livré (§43)", () => {
  it("Contagion et Pétrification : trois réussites ou trois échecs", () => {
    expect(CONTENT.contagion.triggers[0].do[0]).toEqual({ type: "resave", tally: { successes: 3, failures: 3 } });
    expect(CONTENT["flesh-to-stone"].triggers[0].do[0].tally).toEqual({ successes: 3, failures: 3, status: "petrified" });
    expect(CONTENT["flesh-to-stone"]).toMatchObject({ savedEffects: ["sFyjp6wt9bjyIl9W"], effectEnds: { sFyjp6wt9bjyIl9W: "casterTurnStart" } });
    // Contagion garde le choix de sa caractéristique
    expect(CONTENT.contagion.choice).toBeTruthy();
  });

  it("Danse irrésistible d'Otto : l'action rejoue la sauvegarde", () => {
    expect(CONTENT["ottos-irresistible-dance"]).toMatchObject({
      actionEnds: { MpToumiJ2o3S16K7: { by: "bearer", roll: "save" } }, savedEffects: ["UhFtBDEZEDpVgz9G"], effectEnds: { UhFtBDEZEDpVgz9G: "bearerTurnEnd" } });
  });

  it("secouer un dormeur : Sommeil, Motif hypnotique, Mauvais œil, Symbole — sans perdre leur fin sur dégâts", () => {
    for ( const id of ["sleep", "hypnotic-pattern", "eyebite", "symbol"] ) {
      expect(Object.values(CONTENT[id].actionEnds), id).toEqual([{ by: "other", verb: "wake" }]);
    }
    for ( const id of ["sleep", "hypnotic-pattern", "eyebite"] ) expect(CONTENT[id].triggers.some(d => [].concat(d.on).includes("isDamaged")), id).toBe(true);
  });

  it("Forme gazeuse sans jet, Tremblement de terre par son test, Frappe piégeuse par un autre", () => {
    expect(Object.values(CONTENT["gaseous-form"].actionEnds)).toEqual([{ by: "bearer" }]);
    expect(Object.values(CONTENT.earthquake.actionEnds)).toEqual([{ by: "bearer", roll: "check" }]);
    expect(Object.values(CONTENT["ensnaring-strike"].actionEnds)).toEqual([{ by: "other", roll: "check" }]);
  });
});

describe("fins de sorts — contenu livré", () => {
  const steps = (id, moment) => (CONTENT[id]?.triggers ?? []).filter(d => [].concat(d.on).includes(moment)).flatMap(d => d.do.map(s => s.type));

  it("le Fou rire de Tasha du Manuel des joueurs porte la règle du SRD", () => {
    expect(CONTENT["tashas-hideous-laughter"].triggers).toEqual(CONTENT["hideous-laughter"].triggers);
  });

  it("sauvegarde rejouée à la fin du tour : Immobilisation de monstre, Lenteur, Confusion, Éclat du soleil, Châtiment de cécité", () => {
    for ( const id of ["hold-monster", "slow", "confusion", "sunburst", "blinding-smite", "wrathful-smite"] ) expect(steps(id, "endOfTurn"), id).toEqual(["resave"]);
  });

  it("sauvegarde rejouée et dégâts sur un échec : Assassin imaginaire, Ennemi subconscient", () => {
    for ( const id of ["phantasmal-killer", "weird"] ) expect(steps(id, "endOfTurn"), id).toEqual(["resave", "damage"]);
  });

  it("Châtiment de fournaise : les dégâts d'abord, la sauvegarde ensuite, au début du tour", () => {
    expect(CONTENT["searing-smite"].triggers.map(d => d.do.map(s => s.type))).toEqual([["damage"], ["resave"]]);
    expect(CONTENT["searing-smite"].smite.effect).toBe("A0tTvLeRetrC708K");
  });

  it("Sphère de vitriol : les dégâts de fin de tour, puis l'effet tombe", () => {
    expect(steps("vitriolic-sphere", "endOfTurn")).toEqual(["damage", "remove"]);
  });

  it("Terreur : rejouée seulement sans vue sur le lanceur", () => {
    expect(CONTENT.fear.triggers[0].do[0]).toEqual({ type: "resave", unlessSeesOrigin: true });
  });

  it("Apaisement des émotions cesse sur dégâts ; Sanctuaire et Double illusoire sur une attaque, un sort, des dégâts", () => {
    expect(steps("calm-emotions", "isDamaged")).toEqual(["remove"]);
    for ( const id of ["sanctuary", "mislead", "invisibility"] ) expect(CONTENT[id].breaksOn, id).toEqual(["attack", "damage", "spell"]);
  });

  it("Hâte : la léthargie suit, jusqu'à la fin du prochain tour du porteur", () => {
    expect(CONTENT.haste).toMatchObject({ effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" }, effectEnds: { S5XcFawnnNHO8bUr: "bearerTurnEnd" } });
  });
});

describe("§54 : marque posée à l'issue (Huile)", () => {
  it("une marque nommée, sur un moment d'issue", () => {
    const mark = { type: "mark", mark: "oiled", label: "Marque.Huile", seconds: 60 };
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [mark] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "mark", label: "Marque.Huile" }] }] })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ ...mark, seconds: -1 }] }] })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "startOfTurn", via: "effect", do: [mark] }] }).length).toBeGreaterThan(0);
  });
});
