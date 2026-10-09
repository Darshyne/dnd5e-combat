import { describe, it, expect } from "vitest";
import { initiativeAfter } from "../module/scripts/core/turn.mjs";

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
      "summon.pulse.on: turnEnd, enter, moves", "summon.pulse.affects: any, enemy"
    ]);
  });
});
