import { describe, it, expect } from "vitest";
import { open, advance, STEPS } from "../module/scripts/core/action.mjs";
import { nearMiss, nearMissTargets, atCostMarginFor, holdSeconds, cleanCost, rowAtCost, AT_COST_HOLD } from "../module/scripts/core/success-at-cost.mjs";
import { tally } from "../module/scripts/core/group-roll.mjs";
import { RESOLUTION_BASE } from "./helpers.mjs";

/** Issue #32 : « Succès à un prix », aide optionnelle du Guide du maître 2024. */

const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 15, ...extra });
const roll = (total, extra={}) => ({ total, isCritical: false, isFumble: false, ...extra });
const types = commands => commands.map(c => c.type === "echo" ? `echo:${c.on}` : c.type);
const FIRE = [{ type: "fire", value: 8, properties: [] }];

function play(first, ...events) {
  let { resolution, commands } = first;
  const all = [...commands];
  for ( const event of events ) {
    const step = advance(resolution, event);
    resolution = step.resolution;
    all.push(...step.commands);
  }
  return { resolution, commands: all };
}

describe("règles pures", () => {
  it("rate de 1 ou 2, seuil connu", () => {
    expect(nearMiss(14, 15)).toBe(1);
    expect(nearMiss(13, 15)).toBe(2);
    expect(nearMiss(12, 15)).toBe(0);
    expect(nearMiss(15, 15)).toBe(0);
    expect(nearMiss(16, 15)).toBe(0);
    expect(nearMiss(14, null)).toBe(0);
    expect(nearMiss(14, 15, 0)).toBe(0);
  });

  it("les personnages joueurs seulement, sauf réglage ; rien quand l'aide est éteinte", () => {
    expect(atCostMarginFor({ enabled: false, isCharacter: true })).toBe(0);
    expect(atCostMarginFor({ enabled: true, isCharacter: true })).toBe(2);
    expect(atCostMarginFor({ enabled: true, isCharacter: false })).toBe(0);
    expect(atCostMarginFor({ enabled: true, isCharacter: false, npc: true })).toBe(2);
  });

  it("pause bornée, prix nettoyé", () => {
    expect(holdSeconds("x")).toBe(AT_COST_HOLD.byDefault);
    expect(holdSeconds(-3)).toBe(0);
    expect(holdSeconds(99)).toBe(AT_COST_HOLD.max);
    expect(cleanCost("  Vous \n tombez  ")).toBe("Vous tombez");
    expect(cleanCost("   ")).toBe(null);
    expect(cleanCost("x".repeat(400))).toHaveLength(300);
  });

  it("une ligne déjà acceptée ne se repropose pas", () => {
    expect(rowAtCost({ total: 13, dc: 15 })).toBe(2);
    expect(rowAtCost({ total: 13, dc: 15, atCost: { cost: null } })).toBe(0);
    expect(rowAtCost({ total: 10, dc: 15 })).toBe(0);
  });

  it("cibles : ratées sur le total seulement — pas le 1 naturel, pas l'abri total, pas une cible épargnée", () => {
    const targets = [
      { token: "a", hit: false, reason: "miss", ac: 15 },
      { token: "b", hit: false, reason: "miss", ac: 18 },
      { token: "c", hit: false, reason: "fumble", ac: 14 },
      { token: "d", hit: false, reason: "cover", ac: null },
      { token: "e", hit: true, reason: "ac", ac: 12 },
      { token: "f", hit: false, reason: "miss", ac: 14, unaffected: "plane" },
      { token: "g", hit: false, reason: "reaction", ac: 14 }
    ];
    expect(nearMissTargets(roll(13), targets, 2)).toEqual([{ token: "a", by: 2 }]);
    expect(nearMissTargets(roll(13), targets, 0)).toEqual([]);
  });
});

describe("attaque résolue par le moteur", () => {
  const plan = { attack: true, damage: "author" };
  const rolled = (total, targets=[T(1)], extra={}) => play(open({ ...RESOLUTION_BASE, plan, targets: [] }),
    { type: "attackRolled", roll: roll(total, extra), messageId: "Atk", targets, atCost: 2 });

  it("ratée de 2 : la pause avant le verdict, rien d'appliqué", () => {
    const { resolution, commands } = rolled(13);
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    expect(resolution.pending).toEqual([{ kind: "atCost" }]);
    expect(commands).toEqual([{ type: "atCostPause", targets: [{ token: "T1", by: 2 }], total: 13 }]);
  });

  it("aide éteinte (écart 0) : le raté se clôt aussitôt", () => {
    const { resolution, commands } = play(open({ ...RESOLUTION_BASE, plan, targets: [] }),
      { type: "attackRolled", roll: roll(13), messageId: "Atk", targets: [T(1)] });
    expect(resolution.step).toBe(STEPS.MISSED);
    expect(types(commands)).toEqual(["echo:attack"]);
  });

  it("accepté : touché, jamais critique, prix noté ; les dégâts ne s'appliquent qu'une fois", () => {
    const accepted = play(rolled(14), { type: "atCostDecided", accepted: true, cost: "À terre" });
    expect(accepted.resolution.targets[0]).toMatchObject({ hit: true, critical: false, reason: "atCost" });
    expect(accepted.resolution.atCost).toMatchObject({ accepted: true, cost: "À terre" });
    expect(accepted.resolution.step).toBe(STEPS.AWAITING_ROLLS);
    // Une seconde réponse (double clic, F5) ne change rien.
    expect(advance(accepted.resolution, { type: "atCostDecided", accepted: true }).resolution).toBe(accepted.resolution);
    const damaged = play(accepted, { type: "damageRolled", messageId: "Dmg", damages: FIRE });
    expect(types(damaged.commands).filter(t => t === "apply")).toHaveLength(1);
    expect(advance(damaged.resolution, { type: "damageRolled", messageId: "Dmg2", damages: FIRE }).commands).toEqual([]);
  });

  it("refusé : l'échec reste, rien d'appliqué", () => {
    const { resolution, commands } = play(rolled(14), { type: "atCostDecided", accepted: false });
    expect(resolution.step).toBe(STEPS.MISSED);
    expect(resolution.targets[0].hit).toBe(false);
    expect(types(commands)).not.toContain("apply");
  });

  it("un 1 naturel n'est jamais proposé, un 20 naturel ne change pas", () => {
    expect(rolled(14, [T(1)], { isFumble: true }).resolution.step).toBe(STEPS.MISSED);
    const crit = rolled(14, [T(1)], { isCritical: true });
    expect(crit.resolution.targets[0]).toMatchObject({ hit: true, critical: true });
    expect(types(crit.commands)).not.toContain("atCostPause");
  });

  it("plusieurs cibles : seules les ratées de 1 ou 2 passent", () => {
    const { resolution } = play(rolled(13, [T(1), T(2, { ac: 18 }), T(3, { ac: 10 })]), { type: "atCostDecided", accepted: true });
    expect(resolution.targets.map(t => [t.token, t.hit, t.reason])).toEqual([["T1", true, "atCost"], ["T2", false, "miss"], ["T3", true, "ac"]]);
  });

  it("après Bouclier : jugé sur la CA finale", () => {
    const opened = rolled(16, [T(1, { canReact: true })]);
    expect(types(opened.commands)).toEqual(["askReactions"]);
    const shielded = play(opened, { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 17 });
    expect(shielded.resolution.pending).toEqual([{ kind: "atCost" }]);
    expect(shielded.commands.at(-1)).toEqual({ type: "atCostPause", targets: [{ token: "T1", by: 1 }], total: 16 });
    const far = play(rolled(16, [T(1, { canReact: true })]), { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 20 });
    expect(far.resolution.step).toBe(STEPS.MISSED);
  });

  it("la question n'est posée qu'une fois", () => {
    const declined = play(rolled(14), { type: "atCostDecided", accepted: false });
    expect(declined.commands.filter(c => c.type === "atCostPause")).toHaveLength(1);
  });
});

describe("sauvegarde demandée par une résolution", () => {
  const save = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
  const plan = { save, damage: "author", effects: [{ id: "E1", activity: "Act", when: "failedSave" }] };

  it("acceptée : réussie, total gardé, demi-dégâts et pas d'effet d'échec", () => {
    const { resolution, commands } = play(open({ ...RESOLUTION_BASE, plan, targets: [T(1)] }),
      { type: "damageRolled", messageId: "D", damages: FIRE },
      { type: "saveRolled", actor: "A1", total: 13, messageId: "s1", atCost: { cost: "Votre bouclier tombe" } });
    expect(resolution.targets[0].save).toEqual({ total: 13, success: true, messageId: "s1", atCost: { cost: "Votre bouclier tombe" } });
    const apply = commands.filter(c => c.type === "apply");
    expect(apply).toHaveLength(1);
    expect(apply[0].entries[0].multiplier).toBe(0.5);
    expect(apply[0].entries[0].effects ?? []).not.toContain("E1");
  });
});

describe("jet demandé par le MJ (§242)", () => {
  it("une ligne acceptée compte comme réussie dans le verdict", () => {
    const request = { dc: 15, group: false };
    expect(tally(request, [{ total: 13 }, { total: 16 }]).success).toBe(false);
    const after = tally(request, [{ total: 13, atCost: { cost: null } }, { total: 16 }]);
    expect(after.entries[0].success).toBe(true);
    expect(after.success).toBe(true);
    expect(tally({ dc: null, group: false }, [{ total: 13, atCost: {} }]).entries[0].success).toBe(null);
  });
});
