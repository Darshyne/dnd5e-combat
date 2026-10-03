import { describe, it, expect } from "vitest";
import {
  open, advance, STEPS, RESOLUTION_VERSION, current, affectedTargets, pendingSaves, wantsDamageRoll,
  isCriticalHit, applicationPlan, undoPlan, pendingAllocation, allocateDarts
} from "../module/scripts/core/action.mjs";

const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
const base = { id: "r", carrier: "M", origin: "M", activity: "Act", source: "Src" };
const roll = (total, extra={}) => ({ total, isCritical: false, isFumble: false, ...extra });
const types = commands => commands.map(c => c.type === "echo" ? `echo:${c.on}` : c.type);
const FIRE = [{ type: "fire", value: 8, properties: [] }];

/** Enchaîne des évènements et rend la résolution finale et toutes les commandes émises. */
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

const hp = (before, after, temp=[0, 0]) => ({ before: { value: before, temp: temp[0] }, after: { value: after, temp: temp[1] } });

describe("schéma", () => {
  it("écrit sa version, et ignore une résolution d'un autre schéma", () => {
    const { resolution } = open({ ...base, plan: { attack: true }, targets: [T(1)] });
    expect(resolution.v).toBe(RESOLUTION_VERSION);
    expect(current(resolution)).toBe(resolution);
    expect(current({ kind: "attack", step: "done" })).toBe(null);
    expect(current(undefined)).toBe(null);
  });
});

describe("attaque", () => {
  const plan = { attack: true, damage: "author" };

  it("attend le jet d'attaque, sans rien demander", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1)] });
    expect(resolution.step).toBe(STEPS.AWAITING_ATTACK);
    expect(commands).toEqual([]);
    expect(wantsDamageRoll(resolution)).toBe(false);
  });

  it("prend les cibles du jet, pas celles de l'utilisation", () => {
    const { resolution } = play(open({ ...base, plan, targets: [T(1)] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(2), T(3, { ac: 18 })] });
    expect(resolution.targets.map(t => [t.token, t.hit])).toEqual([["T2", true], ["T3", false]]);
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(wantsDamageRoll(resolution)).toBe(true);
  });

  it("se clôt en « raté » si personne n'est touché, et le dit sur le message d'attaque", () => {
    const { resolution, commands } = play(open({ ...base, plan, targets: [T(1)] }),
      { type: "attackRolled", roll: roll(5), messageId: "Atk", targets: [T(1)] });
    expect(resolution.step).toBe(STEPS.MISSED);
    expect(types(commands)).toEqual(["echo:attack"]);
  });

  it("une cible sans défense à 5 ft subit un coup critique d'office", () => {
    const { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(13), messageId: "Atk", targets: [T(1, { defenceless: true }), T(2)] });
    expect(resolution.targets.map(t => [t.critical, t.reason])).toEqual([[true, "autoCritical"], [false, "ac"]]);
    expect(isCriticalHit(resolution)).toBe(true);
  });

  it("applique aux seules cibles touchées, puis ouvre la fenêtre « blessé » et nettoie", () => {
    const opened = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1), T(2, { ac: 18 })] },
      { type: "damageRolled", messageId: "Dmg", damages: FIRE });
    expect(types(opened.commands)).toEqual(["echo:attack", "apply"]);
    expect(opened.commands.at(-1).entries).toEqual([{ token: "T1", actor: "A1", multiplier: 1, effects: [], steps: [] }]);
    const done = advance(opened.resolution, { type: "applied", entries: [{ token: "T1", actor: "A1", ...hp(20, 12), effects: [] }] });
    expect(done.resolution.step).toBe(STEPS.DONE);
    expect(done.resolution.targets[0].damage).toEqual({ applied: 8 });
    expect(done.commands).toEqual([
      { type: "echo", on: "damage" }, { type: "window", window: "isDamaged", tokens: ["T1"] }, { type: "cleanup" }
    ]);
  });

  it("porteur = message d'attaque (jet hors carte) : jugé dès l'ouverture", () => {
    const { resolution } = open({ ...base, carrier: "Atk", origin: null, plan, targets: [],
      attack: { roll: roll(15), messageId: "Atk", targets: [T(1)] } });
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(resolution.attack.messageId).toBe("Atk");
  });

  it("un effet au toucher (Contact glacial, Empoignade) ne va qu'à ceux qui sont touchés", () => {
    const withEffect = { attack: true, damage: null, effects: [{ id: "E", activity: "Act", when: "always" }] };
    const { commands } = play(open({ ...base, plan: withEffect, targets: [] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1), T(2, { ac: 18 })] });
    expect(commands.at(-1)).toEqual({ type: "apply", entries: [
      { token: "T1", actor: "A1", multiplier: 0, effects: [{ id: "E", activity: "Act" }], steps: [] }
    ] });
  });

  it("M3 : la condition de taille voyage avec l'effet jusqu'à l'application (Morsure du Loup)", () => {
    const gate = JSON.stringify({ "target.sizeAtMost": "med" });
    const plan = { attack: true, damage: null, effects: [{ id: "P", activity: "Act", when: "always", if: gate }] };
    const { commands } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1)] });
    expect(commands.at(-1).entries[0].effects).toEqual([{ id: "P", activity: "Act", if: gate }]);
  });
});

describe("fenêtre de réaction « touché »", () => {
  const plan = { attack: true, damage: "author" };
  const attacked = () => play(open({ ...base, plan, targets: [] }),
    { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1, { canReact: true }), T(2, { canReact: true, ac: 18 }), T(3)] });

  it("s'écrit AVANT d'attendre : étape et demandes en cours sont dans la résolution", () => {
    const { resolution, commands } = attacked();
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    expect(resolution.pending).toEqual([{ kind: "reaction", window: "isHit", token: "T1" }]);   // T2 n'est pas touché
    expect(commands).toEqual([{ type: "askReactions", window: "isHit", tokens: ["T1"] }]);
    expect(wantsDamageRoll(resolution)).toBe(false);
  });

  it("Bouclier : rejugé contre la nouvelle CA, le coup devient un raté", () => {
    const { resolution } = play(attacked(), { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 17 });
    expect(resolution.targets[0]).toMatchObject({ hit: false, reaction: "Bouclier", ac: 17 });
    expect(resolution.pending).toEqual([]);
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);   // T3 reste touché
  });

  it("un critique touche malgré le Bouclier", () => {
    const { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25, { isCritical: true }), messageId: "Atk", targets: [T(1, { canReact: true })] },
      { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 30 });
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: true });
  });

  it("sans réaction, le verdict ne bouge pas", () => {
    const { resolution, commands } = play(attacked(), { type: "reactionResolved", token: "T1", used: null, ac: 12 });
    expect(resolution.targets[0].hit).toBe(true);
    expect(types(commands)).toEqual(["askReactions", "echo:attack"]);
  });

  it("ignore une réponse qu'on n'attend pas", () => {
    const { resolution } = attacked();
    expect(advance(resolution, { type: "reactionResolved", token: "T3", used: "Bouclier", ac: 30 }).resolution).toBe(resolution);
  });
});

describe("répliques (Image miroir, §16.25)", () => {
  const plan = { attack: true, damage: "author" };
  const attacked = targets => play(open({ ...base, plan, targets: [] }),
    { type: "attackRolled", roll: roll(15), messageId: "Atk", targets });

  it("une cible touchée qui a des répliques les fait jouer ; ratée ou sans répliques, rien", () => {
    const { resolution, commands } = attacked([T(1, { duplicates: 3 }), T(2, { duplicates: 3, ac: 18 }), T(3)]);
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    expect(resolution.pending).toEqual([{ kind: "duplicates", token: "T1" }]);
    expect(commands).toEqual([{ type: "rollDuplicates", tokens: ["T1"] }]);
  });

  it("un 3 ou plus : une réplique prend le coup, la cible est ratée", () => {
    const { resolution } = play(attacked([T(1, { duplicates: 2 }), T(3)]), { type: "duplicatesRolled", token: "T1", dice: [1, 4] });
    expect(resolution.targets[0]).toMatchObject({ hit: false, critical: false, reason: "duplicate", duplicate: { dice: [1, 4], taken: true } });
    expect(affectedTargets(resolution).map(t => t.token)).toEqual(["T3"]);
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
  });

  it("que des 1 et des 2 : le coup porte ; seule, la cible ratée clôt l'action", () => {
    const kept = play(attacked([T(1, { duplicates: 3 })]), { type: "duplicatesRolled", token: "T1", dice: [1, 2, 2] });
    expect(kept.resolution.targets[0]).toMatchObject({ hit: true, duplicate: { taken: false } });
    const lost = play(attacked([T(1, { duplicates: 1 })]), { type: "duplicatesRolled", token: "T1", dice: [6] });
    expect(lost.resolution.step).toBe(STEPS.MISSED);
  });

  it("Bouclier d'abord : un coup qu'il fait rater n'atteint pas les répliques", () => {
    const shielded = play(attacked([T(1, { canReact: true, duplicates: 3 })]), { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 17 });
    expect(shielded.resolution.step).toBe(STEPS.MISSED);
    expect(types(shielded.commands)).not.toContain("rollDuplicates");
    const through = play(attacked([T(1, { canReact: true, duplicates: 3 })]), { type: "reactionResolved", token: "T1", used: null, ac: 12 });
    expect(through.commands.at(-1)).toEqual({ type: "rollDuplicates", tokens: ["T1"] });
  });

  it("ignore des dés qu'on n'attend pas", () => {
    const { resolution } = attacked([T(1, { duplicates: 3 })]);
    expect(advance(resolution, { type: "duplicatesRolled", token: "T9", dice: [6] }).resolution).toBe(resolution);
    expect(advance(resolution, { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 30 }).resolution).toBe(resolution);
  });
});

describe("projectiles répartis (Projectile magique, §16.27)", () => {
  const plan = { attack: false, damage: "system", darts: 4 };
  const FORCE = [{ type: "force", value: 3, properties: [] }];

  it("une seule cible reçoit tous les projectiles, sans question", () => {
    const { resolution, commands } = play(open({ ...base, plan, targets: [T(1)] }), { type: "damageRolled", messageId: "Dmg", damages: FORCE });
    expect(pendingAllocation(resolution)).toBe(false);
    expect(commands.at(-1).entries[0]).toMatchObject({ token: "T1", multiplier: 4 });
  });

  it("plusieurs cibles : l'auteur répartit, chaque cible subit autant de fois les dégâts", () => {
    const opened = open({ ...base, plan, targets: [T(1), T(2)] });
    expect(opened.commands).toEqual([{ type: "askAllocation", count: 4, targets: [{ token: "T1", name: "Cible 1" }, { token: "T2", name: "Cible 2" }] }]);
    const { commands } = play(opened, { type: "damageRolled", messageId: "Dmg", damages: FORCE }, { type: "allocated", counts: { T1: 3, T2: 1 } });
    expect(commands.at(-1).entries.map(e => [e.token, e.multiplier])).toEqual([["T1", 3], ["T2", 1]]);
  });

  it("une répartition fausse est remise d'aplomb : un chacun, le reste au premier", () => {
    expect(allocateDarts(4, ["A", "B"], { A: 5, B: 2 })).toEqual({ A: 3, B: 1 });
    expect(allocateDarts(3, ["A", "B"], { A: 0, B: 3 })).toEqual({ A: 0, B: 3 });
    expect(allocateDarts(2, ["A", "B", "C"], {})).toEqual({ A: 1, B: 1, C: 0 });
  });

  it("n'applique rien tant que la répartition manque", () => {
    const { resolution, commands } = play(open({ ...base, plan, targets: [T(1), T(2)] }), { type: "damageRolled", messageId: "Dmg", damages: FORCE });
    expect(types(commands)).not.toContain("apply");
    expect(pendingAllocation(resolution)).toBe(true);
  });
});

describe("sauvegarde", () => {
  const save = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
  const effects = [{ id: "E1", activity: "Act", when: "failedSave" }, { id: "E2", activity: "Act", when: "always" }];
  const plan = { save, damage: "author", effects };
  const opened = () => open({ ...base, plan, targets: [T(1), T(2)] });

  it("demande les sauvegardes dès l'ouverture, et signale à l'auteur de lancer ses dégâts", () => {
    const { resolution, commands } = opened();
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(commands).toEqual([{ type: "requestSaves", targets: [
      { token: "T1", actor: "A1", name: "Cible 1" }, { token: "T2", actor: "A2", name: "Cible 2" }
    ] }]);
    expect(wantsDamageRoll(resolution)).toBe(true);
  });

  it("réussit à partir du DD ; le premier jet fait foi ; un inconnu est ignoré", () => {
    let { resolution } = play(opened(), { type: "saveRolled", actor: "A1", total: 15, messageId: "s1" });
    expect(resolution.targets[0].save).toEqual({ total: 15, success: true, messageId: "s1" });
    expect(advance(resolution, { type: "saveRolled", actor: "A1", total: 2, messageId: "s2" }).resolution).toBe(resolution);
    expect(advance(resolution, { type: "saveRolled", actor: "A9", total: 2, messageId: "s3" }).resolution).toBe(resolution);
  });

  it("§18.9 : Résistance légendaire — l'échec compte comme une réussite, le total reste celui du jet", () => {
    const { commands, resolution } = play(opened(), { type: "damageRolled", messageId: "D", damages: FIRE },
      { type: "saveRolled", actor: "A1", total: 4, messageId: "s1", resisted: true }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(resolution.targets[0].save).toEqual({ total: 4, success: true, messageId: "s1", resisted: true });
    expect(commands.at(-1).entries.map(e => e.multiplier)).toEqual([0.5, 1]);
  });

  it("sert deux tokens du même acteur l'un après l'autre", () => {
    const twins = [T(1), { ...T(2), actor: "A1" }];
    const { resolution } = play(open({ ...base, plan, targets: twins }),
      { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A1", total: 3, messageId: "s2" });
    expect(resolution.targets.map(t => t.save.success)).toEqual([true, false]);
  });

  it("attend toutes les sauvegardes ET le jet de dégâts, dans n'importe quel ordre, et n'applique qu'une fois", () => {
    const a = play(opened(), { type: "damageRolled", messageId: "D", damages: FIRE }, { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" });
    expect(types(a.commands)).toEqual(["requestSaves"]);
    const b = play(a, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(types(b.commands)).toEqual(["requestSaves", "apply"]);
    expect(b.resolution.applying).toBe(true);
    expect(advance(b.resolution, { type: "damageRolled", messageId: "D2", damages: FIRE }).resolution).toBe(b.resolution);
  });

  it("moitié des dégâts sur réussite, tout sur échec ; l'effet « failedSave » épargne qui réussit", () => {
    const { commands } = play(opened(), { type: "damageRolled", messageId: "D", damages: FIRE },
      { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(commands.at(-1).entries).toEqual([
      { token: "T1", actor: "A1", multiplier: 0.5, effects: [{ id: "E2", activity: "Act" }], steps: [] },
      { token: "T2", actor: "A2", multiplier: 1, effects: [{ id: "E1", activity: "Act" }, { id: "E2", activity: "Act" }], steps: [] }
    ]);
  });

  it("§19 : un effet « saved » ne va qu'à qui réussit (Rayon affaiblissant) ; une étape à onSave sait si la cible a réussi", () => {
    const withSaved = { save, damage: null, effects: [{ id: "EF", activity: "Act", when: "failedSave" }, { id: "ES", activity: "Act", when: "saved" }],
      steps: [{ when: "always", type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half" }, { when: "failedSave", type: "status", status: "prone" }] };
    const { commands } = play(open({ ...base, plan: withSaved, targets: [T(1), T(2)] }),
      { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(commands.at(-1).entries).toEqual([
      { token: "T1", actor: "A1", multiplier: 0, effects: [{ id: "ES", activity: "Act" }],
        steps: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half", saved: true }] },
      { token: "T2", actor: "A2", multiplier: 0, effects: [{ id: "EF", activity: "Act" }],
        steps: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half", saved: false }, { type: "status", status: "prone" }] }
    ]);
  });

  it("onSave none et full", () => {
    for ( const [onSave, expected] of [["none", 0], ["full", 1]] ) {
      const { resolution } = play(open({ ...base, plan: { save: { ...save, onSave }, damage: "author" }, targets: [T(1)] }),
        { type: "saveRolled", actor: "A1", total: 20, messageId: "s" });
      expect(applicationPlan(resolution)[0].multiplier).toBe(expected);
    }
  });

  it("échec d'office : aucun jet demandé, dégâts entiers ; un jet arrivé ensuite est ignoré", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1, { autoFail: "paralyzed" }), T(2)] });
    expect(resolution.targets[0].save).toEqual({ total: null, success: false, messageId: null, auto: "paralyzed" });
    expect(commands[0].targets.map(t => t.token)).toEqual(["T2"]);
    expect(pendingSaves(resolution).map(t => t.token)).toEqual(["T2"]);
    expect(advance(resolution, { type: "saveRolled", actor: "A1", total: 20, messageId: "s" }).resolution).toBe(resolution);
  });

  it("cible non affectée (§16.8 : pas un humanoïde) : ni sauvegarde, ni effet ; seule elle, l'action est close", () => {
    const off = { reason: "type", detail: "humanoid" };
    const { resolution, commands } = open({ ...base, plan: { save, effects }, targets: [T(1, { unaffected: off }), T(2)] });
    expect(resolution.targets[0].unaffected).toEqual(off);
    expect(commands[0].targets.map(t => t.token)).toEqual(["T2"]);
    expect(affectedTargets(resolution).map(t => t.token)).toEqual(["T2"]);
    const done = play({ resolution, commands: [] }, { type: "saveRolled", actor: "A2", total: 1, messageId: "s" });
    expect(applicationPlan(done.resolution).map(e => e.token)).toEqual(["T2"]);
    const alone = open({ ...base, plan: { save, effects }, targets: [T(1, { unaffected: off })] });
    expect(alone.resolution.step).toBe(STEPS.DONE);
    expect(alone.commands).toEqual([]);
  });

  it("Esquive instinctive (§16.11) : la réaction divise les dégâts de l'attaque par deux, la cible reste touchée", () => {
    const plan = { attack: true, damage: "author" };
    let { resolution, commands } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { canReact: true }), T(2)] });
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Esquive instinctive", ac: 12, halve: true }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, halved: true, reaction: "Esquive instinctive" });
    ({ resolution, commands } = advance(resolution, { type: "damageRolled", messageId: "d", damages: FIRE }));
    const entries = commands.find(c => c.type === "apply").entries;
    expect(entries.map(e => e.multiplier)).toEqual([0.5, 1]);
  });

  it("Sentinelle au seuil de la mort (§19.9) : moitié des dégâts, et le coup critique n'est plus qu'un coup", () => {
    const plan = { attack: true, damage: "author" };
    let { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25, { isCritical: true }), messageId: "a", targets: [T(1, { canReact: true })] });
    expect(resolution.targets[0].critical).toBe(true);
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Sentinelle", ac: 12, halve: true, uncrit: true }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: false, halved: true, uncritted: true });
    expect(isCriticalHit(resolution)).toBe(false);
  });

  it("une réaction qui ne change rien au critique d'office (Paralysée à 5 ft) le laisse critique", () => {
    const plan = { attack: true, damage: "author" };
    let { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { canReact: true, defenceless: true })] });
    expect(resolution.targets[0]).toMatchObject({ critical: true, reason: "autoCritical" });
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Esquive instinctive", ac: 12, halve: true }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: true, halved: true });
  });

  it("riposte (§16.9) : les dégâts subis par l'attaquant sont journalisés, et défaits avec l'action", () => {
    let { resolution } = play(open({ ...base, plan: { attack: true, damage: "author" }, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1)] },
      { type: "damageRolled", messageId: "d", damages: FIRE });
    ({ resolution } = advance(resolution, { type: "applied", entries: [{ token: "T1", actor: "A1", ...hp(20, 12), effects: [] }],
      extra: [{ token: "Src", actor: "ASrc", name: "Bouclier de feu", ...hp(30, 21) }] }));
    expect(resolution.step).toBe(STEPS.DONE);
    expect(undoPlan(resolution).hp).toEqual([
      { actor: "ASrc", restore: { value: 30, temp: 0 } },
      { actor: "A1", restore: { value: 20, temp: 0 } }
    ]);
    expect(resolution.targets[0].damage.applied).toBe(8);
  });

  it("attaque sur une cible non affectée : le jet a lieu, mais rien ne l'atteint", () => {
    const { resolution } = play(open({ ...base, plan: { attack: true, damage: "author" }, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { unaffected: { reason: "immune", detail: "charmed" } })] });
    expect(resolution.targets[0].hit).toBe(true);
    expect(affectedTargets(resolution)).toEqual([]);
    expect(resolution.step).toBe(STEPS.MISSED);
  });

  it("sans dégâts et tout le monde en échec d'office : appliqué dès l'ouverture", () => {
    const { commands } = open({ ...base, plan: { save, effects }, targets: [T(1, { autoFail: "stunned" })] });
    expect(types(commands)).toEqual(["apply"]);
    expect(commands[0].entries[0].multiplier).toBe(0);
  });
});

describe("attaque qui impose une sauvegarde (morsure empoisonnée)", () => {
  const plan = {
    attack: true, damage: "author",
    save: { ability: "con", dc: 13, onSave: "none", activity: "Poison", chained: true },
    effects: [{ id: "Empoisonne", activity: "Poison", when: "failedSave" }]
  };
  const bitten = () => play(open({ ...base, plan, targets: [] }),
    { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1), T(2), T(3, { ac: 18 })] });

  it("ne demande la sauvegarde qu'à ceux qui sont touchés, après le verdict", () => {
    const { commands } = bitten();
    expect(types(commands)).toEqual(["echo:attack", "requestSaves"]);
    expect(commands[1].targets.map(t => t.token)).toEqual(["T1", "T2"]);
  });

  it("la sauvegarde réussie évite le poison, pas les dégâts de la morsure", () => {
    const { commands } = play(bitten(), { type: "damageRolled", messageId: "D", damages: FIRE },
      { type: "saveRolled", actor: "A1", total: 18, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 4, messageId: "s2" });
    expect(commands.at(-1).entries).toEqual([
      { token: "T1", actor: "A1", multiplier: 1, effects: [], steps: [] },
      { token: "T2", actor: "A2", multiplier: 1, effects: [{ id: "Empoisonne", activity: "Poison" }], steps: [] }
    ]);
  });

  it("la cible ratée ne lance rien", () => {
    const { resolution } = bitten();
    expect(advance(resolution, { type: "saveRolled", actor: "A3", total: 1, messageId: "s" }).resolution).toBe(resolution);
    expect(affectedTargets(resolution).map(t => t.token)).toEqual(["T1", "T2"]);
  });
});

describe("dégâts, soins et utilitaires sans jet pour toucher", () => {
  it("activité « damage » : le système lance, l'auteur n'a rien à faire, tout le monde encaisse", () => {
    const { resolution, commands } = play(open({ ...base, plan: { damage: "system" }, targets: [T(1)] }),
      { type: "damageRolled", messageId: "D", damages: FIRE });
    expect(wantsDamageRoll(resolution)).toBe(false);
    expect(commands.at(-1).entries).toEqual([{ token: "T1", actor: "A1", multiplier: 1, effects: [], steps: [] }]);
  });

  it("soin : des PV rendus s'écrivent comme une perte négative, et n'ouvrent pas la fenêtre « blessé »", () => {
    const healed = play(open({ ...base, plan: { damage: "system", heal: true }, targets: [T(1)] }),
      { type: "damageRolled", messageId: "D", damages: [{ type: "healing", value: 7, properties: [] }] });
    const { resolution, commands } = advance(healed.resolution, { type: "applied", entries: [{ token: "T1", actor: "A1", ...hp(5, 12), effects: [] }] });
    expect(resolution.targets[0].damage).toEqual({ applied: -7 });
    expect(types(commands)).toEqual(["echo:damage", "cleanup"]);
  });

  it("Bénédiction : des effets seuls sont posés dès l'ouverture", () => {
    const { commands } = open({ ...base, plan: { effects: [{ id: "Beni", activity: "Act", when: "always" }] }, targets: [T(1), T(2)] });
    expect(types(commands)).toEqual(["apply"]);
    expect(commands[0].entries.map(e => e.effects)).toEqual([[{ id: "Beni", activity: "Act" }], [{ id: "Beni", activity: "Act" }]]);
  });
});

describe("journal et annulation", () => {
  const save = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
  const done = () => play(open({ ...base, plan: { save, damage: "author", effects: [{ id: "E", activity: "Act", when: "failedSave" }] }, targets: [T(1), T(2)] }),
    { type: "damageRolled", messageId: "D", damages: FIRE },
    { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" },
    { type: "applied", entries: [
      { token: "T1", actor: "A1", ...hp(20, 18, [3, 1]), effects: [] },
      { token: "T2", actor: "A2", ...hp(20, 12), effects: ["Actor.A2.ActiveEffect.x"] }
    ] });

  it("consigne PV perdus (temporaires compris) et effets créés, puis sait tout défaire, du plus récent au plus ancien", () => {
    const { resolution } = done();
    expect(resolution.targets.map(t => t.damage.applied)).toEqual([4, 8]);
    expect(undoPlan(resolution)).toEqual({
      hp: [{ actor: "A2", restore: { value: 20, temp: 0 } }, { actor: "A1", restore: { value: 20, temp: 3 } }],
      effects: ["Actor.A2.ActiveEffect.x"]
    });
  });

  it("une cible sans dégâts appliqués n'a pas d'entrée de PV au journal", () => {
    const { resolution } = play(open({ ...base, plan: { effects: [{ id: "E", activity: "Act", when: "always" }] }, targets: [T(1)] }),
      { type: "applied", entries: [{ token: "T1", actor: "A1", before: null, after: null, effects: ["fx"] }] });
    expect(resolution.log).toEqual([{ at: "applyEffect", token: "T1", actor: "A1", effect: "fx" }]);
  });

  it("n'accepte plus rien une fois close ; s'annule une fois, et le redit sur le message de dégâts", () => {
    const { resolution } = done();
    expect(advance(resolution, { type: "saveRolled", actor: "A1", total: 1, messageId: "z" }).resolution).toBe(resolution);
    const { resolution: cancelled, commands } = advance(resolution, { type: "undone" });
    expect(cancelled.step).toBe(STEPS.UNDONE);
    expect(commands).toEqual([{ type: "echo", on: "damage" }]);
    expect(advance(cancelled, { type: "undone" }).resolution).toBe(cancelled);
  });

  it("ne modifie jamais la résolution d'origine", () => {
    const { resolution } = open({ ...base, plan: { save, damage: "author" }, targets: [T(1)] });
    const frozen = JSON.stringify(resolution);
    advance(resolution, { type: "saveRolled", actor: "A1", total: 20, messageId: "s" });
    advance(resolution, { type: "damageRolled", messageId: "D", damages: FIRE });
    expect(JSON.stringify(resolution)).toBe(frozen);
  });

  it("un évènement inconnu ne change rien", () => {
    const { resolution } = open({ ...base, plan: { attack: true }, targets: [] });
    expect(advance(resolution, { type: "nimporte" }).resolution).toBe(resolution);
  });
});

describe("choix d'effet (effets exclusifs, Maléfice)", () => {
  const options = [{ id: "Str", label: "Force" }, { id: "Dex", label: "Dextérité" }, { id: "Con", label: "Constitution" }];
  const effects = [
    { id: "Str", activity: "Act", when: "always" }, { id: "Dex", activity: "Act", when: "always" },
    { id: "Con", activity: "Act", when: "always" }, { id: "Aut", activity: "Act", when: "always" }   // Aut : hors du choix
  ];
  const plan = { effects, choice: { prompt: null, options } };
  const cast = () => open({ ...base, plan, targets: [T(1)] });

  it("demande le choix à l'auteur avant d'appliquer, et l'écrit en attente", () => {
    const { resolution, commands } = cast();
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(resolution.choice).toBe(null);
    expect(resolution.pending).toEqual([{ kind: "choice" }]);
    expect(commands).toEqual([{ type: "askChoice", prompt: null, options }]);
  });

  it("applique le seul effet choisi, plus ceux qui ne sont pas au choix", () => {
    const { resolution, commands } = play(cast(), { type: "choiceMade", id: "Dex" });
    expect(resolution.choice).toBe("Dex");
    expect(resolution.pending).toEqual([]);
    expect(types(commands)).toEqual(["askChoice", "apply"]);
    expect(commands.at(-1).entries).toEqual([{ token: "T1", actor: "A1", multiplier: 0, effects: [
      { id: "Dex", activity: "Act" }, { id: "Aut", activity: "Act" }
    ], steps: [] }]);
  });

  it("choix fait d'avance (menu « Lutte ») : aucune question, l'effet choisi s'applique", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1)], choice: "Con" });
    expect(resolution.choice).toBe("Con");
    expect(types(commands)).toEqual(["apply"]);
    expect(commands.at(-1).entries[0].effects).toEqual([{ id: "Con", activity: "Act" }, { id: "Aut", activity: "Act" }]);
  });

  it("choix d'avance hors des options : ignoré, la question est posée", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1)], choice: "Cha" });
    expect(resolution.choice).toBe(null);
    expect(types(commands)).toEqual(["askChoice"]);
  });

  it("ignore un id hors des options, et une réponse qu'on n'attend pas", () => {
    const { resolution } = cast();
    expect(advance(resolution, { type: "choiceMade", id: "Cha" }).resolution).toBe(resolution);
    const { resolution: chosen } = play(cast(), { type: "choiceMade", id: "Str" });
    expect(advance(chosen, { type: "choiceMade", id: "Dex" }).resolution).toBe(chosen);
  });

  it("sans `choice` dans le plan, tous les effets s'appliquent comme avant", () => {
    const { resolution, commands } = open({ ...base, plan: { effects }, targets: [T(1)] });
    expect(resolution.plan.choice).toBe(null);
    expect(types(commands)).toEqual(["apply"]);
    expect(commands[0].entries[0].effects).toHaveLength(4);
  });

  it("avec une attaque : le choix n'est demandé qu'une fois le verdict rendu, et seulement si quelqu'un est touché", () => {
    const attackPlan = { attack: true, effects, choice: { prompt: "Laquelle ?", options } };
    const missed = play(open({ ...base, plan: attackPlan, targets: [T(1)] }), { type: "attackRolled", roll: roll(5), messageId: "R", targets: [T(1)] });
    expect(missed.resolution.step).toBe(STEPS.MISSED);
    expect(types(missed.commands)).toEqual(["echo:attack"]);
    const hit = play(open({ ...base, plan: attackPlan, targets: [T(1)] }), { type: "attackRolled", roll: roll(15), messageId: "R", targets: [T(1)] });
    expect(types(hit.commands)).toEqual(["echo:attack", "askChoice"]);
    expect(hit.commands[1].prompt).toBe("Laquelle ?");
  });
});

describe("étapes d'issue du plan (SPEC §16 : move, status)", () => {
  const push = { when: "failedSave", type: "move", mode: "push", distance: 10, units: "ft" };
  const pull = { when: "always", type: "move", mode: "pull", distance: 10, units: "ft", if: { "target.sizeAtMost": "lg" } };

  it("une sauvegarde : l'étape « failedSave » ne va qu'à ceux qui ont raté, sans son « when »", () => {
    const first = open({ ...base, plan: { save: { ability: "con", dc: 13, onSave: "half" }, damage: "author", steps: [push] }, targets: [T(1), T(2)] });
    const { resolution, commands } = play(first,
      { type: "saveRolled", actor: "A1", total: 5, messageId: "s1" },
      { type: "saveRolled", actor: "A2", total: 18, messageId: "s2" },
      { type: "damageRolled", messageId: "d", damages: FIRE });
    const apply = commands.find(c => c.type === "apply");
    expect(apply.entries.find(e => e.token === "T1").steps).toEqual([{ type: "move", mode: "push", distance: 10, units: "ft" }]);
    expect(apply.entries.find(e => e.token === "T2").steps).toEqual([]);
    expect(resolution.plan.steps).toEqual([push]);
  });

  it("une attaque : l'étape « always » va à chaque cible touchée, avec sa condition", () => {
    const first = open({ ...base, plan: { attack: true, damage: "author", steps: [pull] }, targets: [T(1), T(2)] });
    const { commands } = play(first,
      { type: "attackRolled", roll: roll(15), messageId: "a", targets: [T(1, { ac: 10 }), T(2, { ac: 20 })] },
      { type: "damageRolled", messageId: "d", damages: FIRE });
    const apply = commands.find(c => c.type === "apply");
    expect(apply.entries.map(e => e.token)).toEqual(["T1"]);
    expect(apply.entries[0].steps).toEqual([{ type: "move", mode: "pull", distance: 10, units: "ft", if: { "target.sizeAtMost": "lg" } }]);
  });

  it("sans étapes : une liste vide, jamais absente", () => {
    const { resolution } = open({ ...base, plan: { attack: true }, targets: [T(1)] });
    expect(resolution.plan.steps).toEqual([]);
  });
});

describe("§19.6 : écart de sauvegarde (« si elle rate le jet de 5 ou plus »)", () => {
  const save = { ability: "con", dc: 19, onSave: "none", activity: "Act", chained: false };
  const plan = { save, damage: null, effects: [{ id: "EF", activity: "Act", when: "failedSave", margin: { min: 5 } }, { id: "EH", activity: "Act", when: "failedSave", margin: { max: 4 } }],
    steps: [{ when: "failedSave", type: "status", status: "prone", margin: { min: 5 } }] };
  it("raté de 5 : l'effet à 5 et l'étape ; raté de 2 : seulement l'effet à 4 au plus ; réussi : rien", () => {
    const { commands } = play(open({ ...base, plan, targets: [T(1), T(2), T(3)] }),
      { type: "saveRolled", actor: "A1", total: 14, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 17, messageId: "s2" },
      { type: "saveRolled", actor: "A3", total: 20, messageId: "s3" });
    const [a, b, c] = commands.at(-1).entries;
    expect(a.effects.map(e => e.id)).toEqual(["EF"]);
    expect(a.steps.map(s => s.status)).toEqual(["prone"]);
    expect(b.effects.map(e => e.id)).toEqual(["EH"]);
    expect(b.steps).toEqual([]);
    expect(c.effects).toEqual([]);
  });
});
