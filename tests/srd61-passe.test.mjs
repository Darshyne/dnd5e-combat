import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

/**
 * §433 : ce que la passe de scénarios sur dnd5e 6.1 a relevé — le SRD 6.1 change des identifiants d'activité et d'effet, déplace des
 * effets d'un item à l'autre et remplace des effets d'item par ceux du compendium `dnd5e.effects`. Les anciennes fiches (Manuel des
 * joueurs, SRD 6.0) gardent les anciens identifiants : chaque règle se lit sous les deux formes.
 */

const fromEffects = (id, on) => SHIPPED[id].triggers.filter(t => [t.on].flat().includes(on)).map(t => t.fromEffect);

describe("§433 : les règles du contenu sous les deux formes de données", () => {
  it("Nuage puant : la sauvegarde de début de tour, sous ses deux identifiants d'activité", () => {
    const [turnStart] = SHIPPED["stinking-cloud"].triggers;
    expect(turnStart.do.filter(s => s.type === "replay").map(s => s.activity)).toEqual(["dnd5eactivity000", "pyaS54TcG7kx15V2"]);
  });

  it("Frappe rusée, Poison : l'effet de l'item, ou « Empoisonné » du compendium d'effets", () => {
    expect(fromEffects("cunning-strike", "endOfTurn")).toEqual(["RazTM6biKVtNtjEW", "wAnw5y4atBxNJHUP"]);
  });

  it("Frappes sournoises, Assommer : nouvelle sauvegarde et fin sur dégâts pour les deux effets", () => {
    expect(fromEffects("devious-strikes", "endOfTurn")).toEqual(["C2IGgt4PnRMxZVey", "HjLkxDzLNBogspf9"]);
    expect(fromEffects("devious-strikes", "isDamaged")).toEqual(["C2IGgt4PnRMxZVey", "HjLkxDzLNBogspf9"]);
  });

  it("Coup brutal amélioré : l'effet de chaque option, sur cet item ou sur Coup brutal", () => {
    const { options } = SHIPPED["improved-brutal-strike"].brutalStrike;
    expect(options.staggering.effect).toEqual(["L9N4evZo1jt46dap", "uacly0JAXLVwAS6y"]);
    expect(options.sundering.effect).toEqual(["tUyuyTQGmpUqMcFe", "Q0ou16II1WEcCdyW"]);
    const brutal = SHIPPED["brutal-strike"];
    // Les règles des deux effets suivent l'item qui les porte : fin au début du tour du barbare, Désavantage aux sauvegardes, pas
    // d'attaque d'opportunité, +5 à la prochaine attaque d'un autre.
    expect(brutal.effectEnds).toMatchObject({ uacly0JAXLVwAS6y: "casterTurnStart", Q0ou16II1WEcCdyW: "casterTurnStart" });
    expect(brutal.effectChanges.uacly0JAXLVwAS6y).toEqual(SHIPPED["improved-brutal-strike"].effectChanges.L9N4evZo1jt46dap);
    expect(brutal.noOpportunityAttacks).toEqual(["uacly0JAXLVwAS6y"]);
    expect(brutal.triggers.some(t => (t.fromEffect === "Q0ou16II1WEcCdyW") && t.do.some(s => s.type === "attackBonus"))).toBe(true);
  });

  it("Coup handicapant : la Vitesse n'est pas retirée deux fois quand l'effet la retire déjà", () => {
    const [walk] = SHIPPED["brutal-strike"].effectChanges.bg9jWpPRIJ0Q2vPY;
    expect(walk).toMatchObject({ key: "system.attributes.movement.walk", value: "-15", unlessKey: "system.attributes.movement.bonus" });
  });
});

describe("§433 : le schéma accepte ces formes", () => {
  it("brutalStrike : `effect` en identifiant ou en liste d'identifiants", () => {
    expect(validateEntry({ brutalStrike: { options: { a: { effect: ["L9N4evZo1jt46dap", "uacly0JAXLVwAS6y"] } } } })).toEqual([]);
    expect(validateEntry({ brutalStrike: { options: { a: { effect: [] } } } }).length).toBe(1);
    expect(validateEntry({ brutalStrike: { options: { a: { effect: ["trop-court"] } } } }).length).toBe(1);
  });

  it("effectChanges : `unlessKey`", () => {
    const change = { key: "system.attributes.movement.walk", type: "add", value: "-15" };
    expect(validateEntry({ effectChanges: { bg9jWpPRIJ0Q2vPY: [{ ...change, unlessKey: "system.attributes.movement.bonus" }] } })).toEqual([]);
    expect(validateEntry({ effectChanges: { bg9jWpPRIJ0Q2vPY: [{ ...change, unlessKey: "" }] } }).length).toBe(1);
  });
});
