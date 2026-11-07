import { describe, it, expect } from "vitest";
import { initiativeAfter } from "../module/scripts/core/turn.mjs";
import { summonOwnership, summonChoices, asksSummonForm, profilesAtLevel, countChoices, mmActorId, srdMonsterId, asksProfile, actorIdOf } from "../module/scripts/core/summon.mjs";

describe("initiative d'une créature invoquée (§16.13)", () => {
  it("juste sous l'invocateur, au-dessus du suivant", () => {
    expect(initiativeAfter(15, [18, 12, 15])).toBe(14.99);
    expect(initiativeAfter(15, [18])).toBe(14.99);
  });
  it("un suivant très proche : la moitié de l'écart", () => {
    expect(initiativeAfter(15, [14.99])).toBe(14.995);
  });
});

import { planCommand, castCommand, currentCommand, nextPlayableTurn } from "../module/scripts/core/pilot.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("objet piloté (§16.15, B19) : commandes", () => {
  const T = "c.2.0";
  it("le premier geste du tour ouvre une commande et la paie", () => {
    expect(planCommand(null, "move", "bonus", T)).toEqual({ pay: "bonus", next: { turn: T, paid: true, move: true, used: 0 } });
    expect(planCommand(null, "use", "bonus", T)).toEqual({ pay: "bonus", next: { turn: T, paid: true, move: false, used: 1 } });
  });
  it("déplacer puis attaquer : une seule action Bonus ; l'attaque clôt le déplacement", () => {
    const { next } = planCommand(null, "move", "bonus", T);
    const second = planCommand(next, "move", "bonus", T);
    expect(second.pay).toBeNull();
    const attack = planCommand(second.next, "use", "bonus", T);
    expect(attack).toEqual({ pay: null, next: { turn: T, paid: true, move: false, used: 1 } });
    expect(planCommand(attack.next, "move", "bonus", T).pay).toBe("bonus");   // « déplacer… puis agir » : la Sphère s'arrête
  });
  it("une seconde attaque demande une nouvelle commande", () => {
    const { next } = planCommand(null, "use", "bonus", T);
    expect(planCommand(next, "use", "bonus", T).pay).toBe("bonus");
  });
  it("l'état d'un autre tour ne compte pas", () => {
    const old = { turn: "c.1.0", paid: true, move: true, used: 0 };
    expect(currentCommand(old, T)).toBeNull();
    expect(planCommand(old, "move", "bonus", T).pay).toBe("bonus");
  });
  it("au lancement : l'Arme spirituelle attaque sans bouger, la Main bouge et agit", () => {
    const weapon = castCommand("use", T);
    expect(planCommand(weapon, "use", "bonus", T).pay).toBeNull();
    expect(planCommand(weapon, "move", "bonus", T).pay).toBe("bonus");
    const hand = castCommand("command", T);
    expect(planCommand(hand, "move", "bonus", T).pay).toBeNull();
    expect(castCommand(undefined, T)).toBeNull();
  });
});

describe("objet piloté : tour sauté", () => {
  it("avance au suivant, recule au précédent", () => {
    expect(nextPlayableTurn([false, true, false], 1, 1)).toBe(2);
    expect(nextPlayableTurn([false, true, false], 1, -1)).toBe(0);
    expect(nextPlayableTurn([false, true, true, false], 1, 1)).toBe(3);
    expect(nextPlayableTurn([false, false], 1, 1)).toBe(1);
  });
  it("au bord du round, sort des bornes", () => {
    expect(nextPlayableTurn([false, true], 1, 1)).toBe(2);
  });
});

describe("objet piloté : schéma", () => {
  it("accepte pilot et endsSpell", () => {
    expect(validateEntry({ summon: { initiative: "after", endsSpell: true, pilot: { cost: "bonus", distance: 20, units: "ft", onCast: "use" } } })).toEqual([]);
  });
  it("refuse ce qui cloche", () => {
    expect(validateEntry({ summon: { initiative: "after", endsSpell: 1, pilot: { cost: "reaction", distance: -1, units: "", onCast: "x", speed: 3 } } })).toEqual([
      "summon.endsSpell: true or absent", "summon.pilot.cost: action, bonus, free", "summon.pilot.distance: non-negative number",
      "summon.pilot.units: unit required", "summon.pilot.onCast: use, command", "summon.pilot.speed: unknown key"
    ]);
  });
});

describe("Sphère de feu et Main de Bigby (§16.15) : schéma", () => {
  it("pulse, endsAtZero, occupies", () => {
    expect(validateEntry({ summon: { initiative: "after", endsAtZero: true, pulse: { item: "flames", radius: 5, units: "ft" }, pilot: { cost: "bonus", distance: 60, units: "ft", occupies: false } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "after", endsAtZero: 1, pulse: { item: "", radius: 0, units: "", at: 1 }, pilot: { cost: "bonus", distance: 60, units: "ft", occupies: true } } })).toEqual([
      "summon.endsAtZero: true or absent", "summon.pulse.item: item identifier required", "summon.pulse.radius: positive number",
      "summon.pulse.units: unit required", "summon.pulse.at: unknown key", "summon.pilot.occupies: false or absent"
    ]);
  });
  it("poussée : distance en formule, la source qui suit", () => {
    const push = d => validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", units: "ft", ...d }] }] });
    expect(push({ distance: "5 + 5 * @flags.dnd5e.summon.mod", follow: true })).toEqual([]);
    expect(push({ distance: " ", follow: "oui" })).toEqual(["triggers[0].do[0].distance: positive number or formula", "triggers[0].do[0].follow: boolean"]);
  });
});

describe("Œil magique et Lumières dansantes (§16.17) : schéma", () => {
  it("initiative « none », commande partagée, grappe, laisse", () => {
    expect(validateEntry({ summon: { initiative: "none", pilot: { cost: "bonus", distance: 60, units: "ft", shared: true, cluster: { distance: 20, units: "ft" }, leash: true } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", pilot: { cost: "bonus", distance: 60, units: "ft", shared: 1, cluster: { distance: 0 }, leash: "oui" } } })).toEqual([
      "summon.pilot.shared: true or absent", "summon.pilot.leash: true or absent", "summon.pilot.cluster: { distance, units }"
    ]);
  });
});

describe("Invocation d'animaux (§16.22) : schéma", () => {
  it("pilot free, pulse on/affects", () => {
    expect(validateEntry({ summon: { initiative: "none", pilot: { cost: "free", distance: 30, units: "ft" }, pulse: { item: "pack-damage", radius: 10, units: "ft", on: ["turnEnd", "enter", "moves"], affects: "enemy" } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", pulse: { item: "x", radius: 10, units: "ft", on: ["start"], affects: "ally" } } })).toEqual([
      "summon.pulse.on: turnEnd, enter, moves, turnStart, casterTurnStart", "summon.pulse.affects: any, enemy"
    ]);
  });

  it("pulse seenBy (§368)", () => {
    expect(validateEntry({ summon: { initiative: "none", pulse: { item: "pack-damage", radius: 10, units: "ft", seenBy: "caster" } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", pulse: { item: "x", radius: 10, units: "ft", seenBy: true } } })).toEqual([
      "summon.pulse.seenBy: caster"
    ]);
    expect(CONTENT["conjure-animals"].summon.pulse.seenBy).toBe("caster");
  });
});

describe("propriétaires d'une créature invoquée par le MJ (§197)", () => {
  const isGM = id => id === "gm";
  it("les joueurs propriétaires du lanceur deviennent propriétaires de la créature", () => {
    expect(summonOwnership({ default: 0, gm: 3, alice: 3, bob: 2 }, { default: 0, gm: 3 }, isGM)).toEqual({ default: 0, gm: 3, alice: 3 });
  });
  it("rien à changer : déjà propriétaire, ou aucun joueur propriétaire", () => {
    expect(summonOwnership({ default: 0, gm: 3, alice: 3 }, { default: 0, alice: 3 }, isGM)).toBe(null);
    expect(summonOwnership({ default: 3, gm: 3 }, { default: 0, gm: 3 }, isGM)).toBe(null);
  });
  it("un niveau inférieur à Propriétaire sur la créature est relevé", () => {
    expect(summonOwnership({ alice: 3 }, { alice: 2 }, isGM)).toEqual({ alice: 3 });
  });
});

import { validateEntry } from "../module/scripts/core/content.mjs";

describe("O8f (§349) : invocations hostiles", () => {
  it("summon.hostile : true ou absent", () => {
    expect(validateEntry({ summon: { initiative: "own", hostile: true, vanishesAtZero: true } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "own", hostile: "yes" } }).length).toBe(1);
  });
});

describe("§383 : choisir la forme d'une invocation (issue #38)", () => {
  it("plusieurs profils, tailles ou types : un choix", () => {
    expect(summonChoices({ profiles: 2 })).toEqual({ profile: true, size: false, type: false, any: true });
    expect(summonChoices({ profiles: 1, types: 3 })).toMatchObject({ profile: false, type: true, any: true });
    expect(summonChoices({ profiles: 3, sizes: 5 })).toMatchObject({ profile: true, size: true });
  });
  it("une seule forme, ou aucune : rien à choisir", () => {
    expect(summonChoices({ profiles: 1, sizes: 1, types: 1 }).any).toBe(false);
    expect(summonChoices({ profiles: 0, sizes: 4 }).any).toBe(false);
    expect(summonChoices().any).toBe(false);
  });
  const two = summonChoices({ profiles: 2 });
  it("demandée quand la fenêtre de dnd5e est sautée (barre d'actions) et que quelque chose sera invoqué", () => {
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true })).toBe(true);
  });
  it("pas quand dnd5e montre sa fenêtre : son choix « Profil » suffit", () => {
    expect(asksSummonForm({ configure: true, choices: two, willSummon: true })).toBe(false);
    expect(asksSummonForm({ configure: undefined, choices: two, willSummon: true })).toBe(false);
  });
  it("pas quand rien ne sera invoqué, déjà choisi, confirmé d'office ou choisi ailleurs", () => {
    expect(asksSummonForm({ configure: false, choices: two, willSummon: false })).toBe(false);
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true, chosen: true })).toBe(false);
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true, confirmed: true })).toBe(false);
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true, otherChoice: true })).toBe(false);
  });
  it("une seule forme : jamais", () => {
    expect(asksSummonForm({ configure: false, choices: summonChoices({ profiles: 1 }), willSummon: true })).toBe(false);
  });
});

describe("§385 : « jusqu'à N » créatures (Création de morts-vivants)", () => {
  it("la fenêtre s'ouvre toujours, même depuis la fiche, sauf déjà choisi ou confirmé", () => {
    const one = summonChoices({ profiles: 1 });
    expect(asksSummonForm({ configure: true, choices: one, willSummon: true, always: true })).toBe(true);
    expect(asksSummonForm({ configure: true, choices: one, willSummon: true, always: true, chosen: true })).toBe(false);
    expect(asksSummonForm({ configure: true, choices: one, willSummon: true, always: true, confirmed: true })).toBe(false);
    expect(asksSummonForm({ configure: true, choices: one, willSummon: false, always: true })).toBe(false);
  });
  const profiles = [{ _id: "goule", level: { min: null, max: null } }, { _id: "blême", level: { min: 8, max: null } },
    { _id: "momie", level: { min: 9, max: null } }];
  it("les formes permises suivent le niveau", () => {
    expect(profilesAtLevel(profiles, 6).map(p => p._id)).toEqual(["goule"]);
    expect(profilesAtLevel(profiles, 8).map(p => p._id)).toEqual(["goule", "blême"]);
    expect(profilesAtLevel(profiles, 9).map(p => p._id)).toEqual(["goule", "blême", "momie"]);
    expect(profilesAtLevel([{ _id: "x", level: { min: 3, max: 5 } }], 6)).toEqual([]);
  });
  it("de 1 à N ; rien à choisir sous 2", () => {
    expect(countChoices(3)).toEqual([1, 2, 3]);
    expect(countChoices(1)).toEqual([]);
    expect(countChoices(0)).toEqual([]);
    expect(countChoices(null)).toEqual([]);
  });
});

describe("§386 : créatures du Monster Manual 2024 plutôt que du SRD 2014", () => {
  it("l'identifiant du Monster Manual d'après le nom anglais", () => {
    expect(mmActorId("Ghoul")).toBe("mmGhoul000000000");
    expect(mmActorId("Wight")).toBe("mmWight000000000");
    expect(mmActorId("Ogre Zombie")).toBe("mmOgreZombie0000");
    expect(mmActorId("Ghast Gravecaller")).toBe("mmGhastGravecall");
    expect(mmActorId("")).toBeNull();
  });
  it("ne reconnaît que le compendium des monstres du SRD 2014 de dnd5e", () => {
    expect(srdMonsterId("Compendium.dnd5e.monsters.Actor.OBujQLLPSmlJiZnL")).toBe("OBujQLLPSmlJiZnL");
    expect(srdMonsterId("Compendium.dnd5e.monsters.OBujQLLPSmlJiZnL")).toBe("OBujQLLPSmlJiZnL");
    expect(srdMonsterId("Compendium.dnd5e.actors24.Actor.OBujQLLPSmlJiZnL")).toBeNull();
    expect(srdMonsterId("Compendium.dnd-players-handbook.actors.Actor.phbcesAngelSpiri")).toBeNull();
    expect(srdMonsterId(null)).toBeNull();
  });
});

describe("§391 : profil d'enchantement ou de transformation sans la fenêtre de dnd5e", () => {
  it("demandé quand la fenêtre est sautée et qu'il y a plusieurs profils", () => {
    expect(asksProfile({ configure: false, profiles: 3 })).toBe(true);
  });
  it("pas avec la fenêtre de dnd5e, un seul profil, déjà choisi, confirmé ou la Forme sauvage", () => {
    expect(asksProfile({ configure: true, profiles: 3 })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 1 })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 3, chosen: true })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 3, confirmed: true })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 3, own: true })).toBe(false);
  });
});

describe("§392 : l'id d'un acteur au bout d'un lien (liens cassés du DMG)", () => {
  it("formes longue et courte", () => {
    expect(actorIdOf("Compendium.dnd-dungeon-masters-guide.actors.Actor.sApYLZj9PTZ40wJr")).toBe("sApYLZj9PTZ40wJr");
    expect(actorIdOf("Compendium.dnd5e.actors24.phbmobWeasel0000")).toBe("phbmobWeasel0000");
    expect(actorIdOf("Actor.sApYLZj9PTZ40wJr")).toBeNull();
    expect(actorIdOf(null)).toBeNull();
  });
});

describe("§394 : invocations visées", () => {
  it("seul Doigt de mort se vise d'un clic ; les autres invocations non", async () => {
    const { CONTENT } = await import("../module/scripts/content/index.mjs");
    expect(CONTENT["finger-of-death"]?.targetedSummon).toBe(true);
    for ( const id of ["create-undead", "animate-dead", "animate-objects", "summon-celestial"] ) expect(CONTENT[id]?.targetedSummon).toBeUndefined();
  });
});
