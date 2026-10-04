import { describe, it, expect } from "vitest";
import {
  attackModifiers, netMode, combineTargets, isAutoCritical, autoFailSave, verbalSpellBlocked
} from "../module/scripts/core/conditions.mjs";

const attack = over => attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false, ...over });
const keys = list => list.map(r => `${r.who}.${r.key}`);

describe("états de la cible", () => {
  it.each(["blinded", "paralyzed", "petrified", "restrained", "stunned", "unconscious"])(
    "attaquer une cible %s donne l'avantage", status => {
      expect(netMode(attack({ target: [status] }))).toBe(1);
    });
  it("attaquer une cible invisible ou qui esquive donne le désavantage", () => {
    expect(netMode(attack({ target: ["invisible"] }))).toBe(-1);
    expect(netMode(attack({ target: ["dodging"] }))).toBe(-1);
  });
  it("À terre : avantage au contact, désavantage de loin", () => {
    expect(keys(attack({ target: ["prone"], adjacent: true }).advantage)).toEqual(["target.prone"]);
    expect(keys(attack({ target: ["prone"], adjacent: false, ranged: true }).disadvantage)).toEqual(["target.proneFar"]);
  });
  it("une allonge de 10 ft contre une cible à terre non adjacente : désavantage", () => {
    expect(netMode(attack({ target: ["prone"], adjacent: false, ranged: false }))).toBe(-1);
  });
});

describe("états de l'attaquant", () => {
  it.each(["blinded", "frightened", "prone", "restrained"])("un attaquant %s a le désavantage", status => {
    expect(netMode(attack({ attacker: [status] }))).toBe(-1);
  });
  it("un attaquant invisible a l'avantage", () => {
    expect(netMode(attack({ attacker: ["invisible"] }))).toBe(1);
  });
  it("ne reprend pas ce que dnd5e applique déjà tout seul (Empoisonné)", () => {
    expect(attack({ attacker: ["poisoned"] })).toEqual({ advantage: [], disadvantage: [] });
  });
});

describe("situation", () => {
  it("portée longue et corps à corps ne pèsent que sur une attaque à distance", () => {
    expect(keys(attack({ ranged: true, adjacent: false, longRange: true, closeCombat: true }).disadvantage))
      .toEqual(["situation.longRange", "situation.closeCombat"]);
    expect(attack({ ranged: false, longRange: true, closeCombat: true }).disadvantage).toEqual([]);
  });
});

describe("cumul", () => {
  it("un avantage et un désavantage s'annulent", () => {
    expect(netMode(attack({ attacker: ["prone"], target: ["restrained"] }))).toBe(0);
  });
  it("deux avantages contre un désavantage : toujours un jet normal", () => {
    expect(netMode(attack({ attacker: ["prone"], target: ["restrained", "blinded"] }))).toBe(0);
  });
  it("garde toutes les raisons pour l'affichage", () => {
    const mods = attack({ attacker: ["invisible"], target: ["stunned"] });
    expect(keys(mods.advantage)).toEqual(["attacker.invisible", "target.stunned"]);
  });
});

describe("plusieurs cibles, un seul jet", () => {
  it("tranche quand toutes les cibles s'accordent", () => {
    expect(combineTargets([attack({ target: ["prone"] }), attack({ target: ["stunned"] })])).toEqual({ mode: 1, agreed: true });
  });
  it("ne tranche pas quand elles divergent", () => {
    expect(combineTargets([attack({ target: ["prone"] }), attack({})])).toEqual({ mode: 0, agreed: false });
  });
  it("sans cible, jet normal", () => {
    expect(combineTargets([])).toEqual({ mode: 0, agreed: true });
  });
});

describe("critique et échec automatiques", () => {
  it("toucher une cible paralysée ou inconsciente à 5 ft est un critique", () => {
    expect(isAutoCritical(["paralyzed"], true)).toBe(true);
    expect(isAutoCritical(["unconscious"], true)).toBe(true);
  });
  it("pas à distance, pas pour un simple étourdissement", () => {
    expect(isAutoCritical(["paralyzed"], false)).toBe(false);
    expect(isAutoCritical(["stunned"], true)).toBe(false);
  });
  it("Force et Dextérité échouent d'office pour une créature paralysée, étourdie, inconsciente, pétrifiée", () => {
    for ( const s of ["paralyzed", "petrified", "stunned", "unconscious"] ) {
      expect(autoFailSave([s], "dex")).toBe(s);
      expect(autoFailSave([s], "str")).toBe(s);
    }
  });
  it("pas les autres caractéristiques, pas les autres états", () => {
    expect(autoFailSave(["paralyzed"], "wis")).toBeNull();
    expect(autoFailSave(["restrained"], "dex")).toBeNull();
  });
});

describe("Silence : sorts à composante verbale", () => {
  it("un lanceur réduit au silence ne lance pas un sort verbal", () => {
    expect(verbalSpellBlocked(["silenced", "deafened"], { spell: true, verbal: true })).toBe("silenced");
  });
  it("un sort sans composante verbale, ou ce qui n'est pas un sort, passe", () => {
    expect(verbalSpellBlocked(["silenced"], { spell: true, verbal: false })).toBeNull();
    expect(verbalSpellBlocked(["silenced"], { spell: false, verbal: false })).toBeNull();
  });
  it("Assourdi seul n'empêche rien", () => {
    expect(verbalSpellBlocked(["deafened"], { spell: true, verbal: true })).toBeNull();
  });
});

describe("vision simulée (P1) : qui voit qui", () => {
  const seen = { attackerSees: true, targetSees: true };

  it("sans faits de vision, rien ne change (états forfaitaires)", () => {
    expect(keys(attack({ target: ["invisible"] }).disadvantage)).toEqual(["target.invisible"]);
    expect(keys(attack({ attacker: ["blinded"] }).disadvantage)).toEqual(["attacker.blinded"]);
  });

  it("tout le monde se voit : aucun modificateur", () => {
    expect(netMode(attack({ vision: seen }))).toBe(0);
  });

  it("attaquer une cible qu'on ne voit pas : désavantage", () => {
    const m = attack({ vision: { attackerSees: false, targetSees: true } });
    expect(keys(m.disadvantage)).toEqual(["target.unseen"]);
    expect(netMode(m)).toBe(-1);
  });

  it("attaquer sans être vu : avantage", () => {
    const m = attack({ vision: { attackerSees: true, targetSees: false } });
    expect(keys(m.advantage)).toEqual(["attacker.unseen"]);
    expect(netMode(m)).toBe(1);
  });

  it("ni l'un ni l'autre ne voit : avantage et désavantage s'annulent", () => {
    expect(netMode(attack({ vision: { attackerSees: false, targetSees: false } }))).toBe(0);
  });

  it("avec la vision, Invisible et Aveuglé ne comptent plus par eux-mêmes : c'est ce qu'on voit qui compte", () => {
    // Cible invisible mais vue (vision aveugle) : pas de désavantage.
    expect(keys(attack({ target: ["invisible"], vision: seen }).disadvantage)).toEqual([]);
    // Attaquant invisible mais vu : pas d'avantage.
    expect(keys(attack({ attacker: ["invisible"], vision: seen }).advantage)).toEqual([]);
    // Attaquant aveuglé qui voit quand même (vision aveugle) : pas de désavantage ; cible aveuglée qui voit : pas d'avantage.
    expect(keys(attack({ attacker: ["blinded"], vision: seen }).disadvantage)).toEqual([]);
    expect(keys(attack({ target: ["blinded"], vision: seen }).advantage)).toEqual([]);
    // Et l'inverse : un invisible non vu donne bien l'avantage, par la vision et une seule fois.
    expect(keys(attack({ attacker: ["invisible"], vision: { attackerSees: true, targetSees: false } }).advantage)).toEqual(["attacker.unseen"]);
  });

  it("Esquive (2024) : désavantage seulement si la cible voit l'attaquant", () => {
    expect(keys(attack({ target: ["dodging"], vision: seen }).disadvantage)).toEqual(["target.dodging"]);
    expect(keys(attack({ target: ["dodging"], vision: { attackerSees: true, targetSees: false } }).disadvantage)).toEqual([]);
  });

  it("les autres états gardent leur effet avec la vision (À terre, Paralysé, Effrayé)", () => {
    expect(keys(attack({ target: ["paralyzed"], vision: seen }).advantage)).toEqual(["target.paralyzed"]);
    expect(keys(attack({ attacker: ["frightened"], vision: seen }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ target: ["prone"], adjacent: false, ranged: true, vision: seen }).disadvantage)).toEqual(["target.proneFar"]);
  });
});

describe("Effrayé « tant que la source est en vue » (P1)", () => {
  it("l'état gêne l'attaque sauf si aucune source connue n'est en vue", () => {
    expect(keys(attack({ attacker: ["frightened"] }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ attacker: ["frightened"], frightenedSourceSeen: true }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ attacker: ["frightened"], frightenedSourceSeen: null }).disadvantage)).toEqual(["attacker.frightened"]);
    expect(keys(attack({ attacker: ["frightened"], frightenedSourceSeen: false }).disadvantage)).toEqual([]);
  });
});

describe("raisons déclarées par le contenu (SPEC §16, B6)", () => {
  it("s'ajoutent aux états, par nom d'item, et pèsent comme les autres", () => {
    const r = attack({ declared: { advantage: ["Lueurs féeriques"], disadvantage: [] } });
    expect(keys(r.advantage)).toEqual(["content.Lueurs féeriques"]);
    expect(netMode(r)).toBe(1);
    expect(netMode(attack({ declared: { disadvantage: ["Protection contre le mal et le bien"] } }))).toBe(-1);
    // Avec un désavantage d'état, ils s'annulent comme le reste.
    expect(netMode(attack({ attacker: ["prone"], declared: { advantage: ["Tactique de meute"] } }))).toBe(0);
  });
  it("sans déclaration : rien de plus", () => {
    expect(attack({ declared: null })).toEqual({ advantage: [], disadvantage: [] });
    expect(attack({})).toEqual({ advantage: [], disadvantage: [] });
  });
});

import { hampersRangedAttack } from "../module/scripts/core/conditions.mjs";

describe("tir au contact : qui gêne", () => {
  it("un ennemi qui voit l'attaquant et n'est pas Neutralisé", () => {
    expect(hampersRangedAttack({ hostile: true, statuses: [], seesAttacker: true })).toBe(true);
    expect(hampersRangedAttack({ hostile: true, statuses: [] })).toBe(true);
    expect(hampersRangedAttack({ hostile: true, statuses: [], seesAttacker: false })).toBe(false);
    expect(hampersRangedAttack({ hostile: false, statuses: [], seesAttacker: true })).toBe(false);
    expect(hampersRangedAttack({ hostile: true, statuses: ["unconscious", "incapacitated"] })).toBe(false);
    expect(hampersRangedAttack({ hostile: true, statuses: ["stunned"] })).toBe(false);
    expect(hampersRangedAttack({ hostile: true, statuses: [], dead: true })).toBe(false);
  });
});

import { conditionUseIssues, forbiddenAgainstCharmer, requiresSight, movesCloser } from "../module/scripts/core/conditions.mjs";

describe("§17.3 : ce que les états interdisent", () => {
  it("Neutralisé : ni action, ni Bonus, ni Réaction", () => {
    expect(conditionUseIssues({ statuses: ["stunned", "incapacitated"], cost: "action" })).toEqual(["incapacitated"]);
    expect(conditionUseIssues({ statuses: ["paralyzed"], cost: "bonus" })).toEqual(["incapacitated"]);
    expect(conditionUseIssues({ statuses: ["unconscious"], cost: "reaction" })).toEqual(["incapacitated"]);
    expect(conditionUseIssues({ statuses: ["incapacitated"], cost: null })).toEqual([]);
    expect(conditionUseIssues({ statuses: ["prone"], cost: "action" })).toEqual([]);
  });
  it("Charmé : attaque, dégâts ou effet magique contre le charmeur", () => {
    expect(forbiddenAgainstCharmer({ attack: true, damage: false, magical: false })).toBe(true);
    expect(forbiddenAgainstCharmer({ attack: false, damage: false, magical: true })).toBe(true);
    expect(forbiddenAgainstCharmer({ attack: false, damage: false, magical: false })).toBe(false);
  });
  it("« une créature que vous pouvez voir »", () => {
    expect(requiresSight("<p>Choose a creature that you can see within range.</p>")).toBe(true);
    expect(requiresSight("<p>One creature you can see within range must succeed</p>")).toBe(true);
    expect(requiresSight("<p>Une créature que vous voyez dans un rayon de 18 m</p>")).toBe(true);
    expect(requiresSight("<p>jusqu'à trois créatures de votre choix parmi celles que vous voyez</p>")).toBe(true);
    expect(requiresSight("<p>vers un espace inoccupé que vous voyez</p>")).toBe(false);
    expect(requiresSight("<p>A bright streak flashes to a point you choose within range</p>")).toBe(false);
  });
  it("Effrayé : se rapprocher de la source", () => {
    expect(movesCloser(30, [30, 35])).toBe(false);
    expect(movesCloser(30, [35, 25])).toBe(true);
  });
});

import { breakMoments, curable, fightingAdvantage } from "../module/scripts/core/conditions.mjs";

describe("§16.47 : règles de sorts", () => {
  it("Tentacules de Hadar : pas de Réaction", () => {
    expect(conditionUseIssues({ statuses: [], cost: "reaction", noReactions: true })).toEqual(["noReactions"]);
    expect(conditionUseIssues({ statuses: [], cost: "action", noReactions: true })).toEqual([]);
  });
  it("Invisibilité : ce qui la rompt", () => {
    expect(breakMoments({ attack: true, damage: false, spell: false })).toEqual(["attack"]);
    expect(breakMoments({ attack: false, damage: true, spell: true })).toEqual(["damage", "spell"]);
    expect(breakMoments({ attack: false, damage: false, spell: false })).toEqual([]);
  });
  it("Restauration partielle : les états présents", () => {
    expect(curable(["poisoned", "prone", "blinded"], ["blinded", "deafened", "paralyzed", "poisoned"])).toEqual(["blinded", "poisoned"]);
    expect(curable(["prone"], ["blinded"])).toEqual([]);
  });
  it("Charme-personne : avantage si on la combat", () => {
    expect(fightingAdvantage({ targetInCombat: true, hostile: true })).toBe(true);
    expect(fightingAdvantage({ targetInCombat: false, hostile: true })).toBe(false);
    expect(fightingAdvantage({ targetInCombat: true, hostile: false })).toBe(false);
  });
});

describe("§77 : une action ou une action Bonus, pas les deux", () => {
  const budget = (action, bonus, used=0) => ({ action, bonus, attacks: { granted: used ? 2 : 0, used } });
  it("l'action déjà prise : plus d'action Bonus", () => {
    expect(conditionUseIssues({ statuses: [], cost: "bonus", actionOrBonus: true, budget: budget(0, 1) })).toEqual(["actionOrBonus"]);
    expect(conditionUseIssues({ statuses: [], cost: "bonus", actionOrBonus: true, budget: budget(0, 1, 1) })).toEqual(["actionOrBonus"]);
  });
  it("l'action Bonus déjà prise : plus d'action", () => {
    expect(conditionUseIssues({ statuses: [], cost: "action", actionOrBonus: true, budget: budget(1, 0) })).toEqual(["actionOrBonus"]);
  });
  it("rien de pris, ou sans l'effet : libre", () => {
    expect(conditionUseIssues({ statuses: [], cost: "action", actionOrBonus: true, budget: budget(1, 1) })).toEqual([]);
    expect(conditionUseIssues({ statuses: [], cost: "bonus", budget: budget(0, 1) })).toEqual([]);
  });
});
