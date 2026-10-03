/**
 * Scénarios complets, hors de Foundry : le cœur et le répartiteur, avec de faux ports à la place
 * des messages de chat et des adaptateurs. Ce que ces tests tiennent : l'ordre (écrire AVANT
 * d'exécuter), la file par porteur, et le chemin entier d'une action.
 */
import { describe, it, expect } from "vitest";
import { createDispatcher } from "../module/scripts/runtime/dispatcher.mjs";
import { STEPS } from "../module/scripts/core/action.mjs";

function world({ reaction=null, coalesce=false, flushMs=250, think=5 }={}) {
  const flags = new Map();
  const journal = [];
  const published = [];
  const queues = new Map();
  const enqueue = (key, task) => {
    const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
    queues.set(key, next.catch(() => {}));
    return next;
  };
  const execute = async (command, carrier, resolution) => {
    journal.push(`${command.type}${command.on ? `:${command.on}` : ""} @${flags.get(carrier).step}`);
    if ( command.type === "askReactions" ) {
      await new Promise(resolve => setTimeout(resolve, think));   // quelqu'un réfléchit
      return command.tokens.map(token => ({ type: "reactionResolved", token, ...(reaction ?? { used: null, ac: 12 }) }));
    }
    if ( command.type === "apply" ) return [{ type: "applied", entries: command.entries.map(e => ({
      token: e.token, actor: e.actor, effects: e.effects.map(x => `fx:${x.id}`),
      before: e.multiplier ? { value: 20, temp: 0 } : null,
      after: e.multiplier ? { value: 20 - (8 * e.multiplier), temp: 0 } : null
    })) }];
  };
  const dispatcher = createDispatcher({
    read: id => flags.get(id) ?? null,
    write: async (id, resolution) => { flags.set(id, resolution); journal.push(`écrit ${resolution.step}`); },
    execute, enqueue, coalesce: () => coalesce, flushMs,
    publish: (resolution, event) => published.push(`${event.type}→${resolution.step}`)
  });
  return { flags, journal, published, dispatcher };
}

const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
const opening = (plan, targets) => async () => ({ id: "r", origin: "U", activity: "Act", source: "Src", plan, targets });
const FIRE = [{ type: "fire", value: 8, properties: [] }];

describe("répartiteur", () => {
  it("attaque avec Bouclier : l'étape « réaction » est écrite avant qu'on attende la réponse", async () => {
    const { dispatcher, journal, flags } = world({ reaction: { used: "Bouclier", ac: 17 } });
    await dispatcher.open("U", opening({ attack: true, damage: "author" }, []));
    await dispatcher.send("U", { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
      targets: [T(1, { canReact: true })] });
    expect(journal).toEqual([
      "écrit awaitingAttack",
      "écrit awaitingReaction", "askReactions @awaitingReaction",
      "écrit missed", "echo:attack @missed"
    ]);
    expect(flags.get("U").targets[0]).toMatchObject({ hit: false, reaction: "Bouclier" });
  });

  it("sauvegarde de zone : jets simultanés mis en série, appliqué une seule fois, tout est publié", async () => {
    const { dispatcher, journal, flags, published } = world();
    const save = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
    await dispatcher.open("U", opening({ save, damage: "author", effects: [{ id: "E", activity: "Act", when: "failedSave" }] }, [T(1), T(2), T(3)]));
    const results = await Promise.all([
      dispatcher.send("U", { type: "saveRolled", actor: "A1", total: 18, messageId: "s1" }),
      dispatcher.send("U", { type: "saveRolled", actor: "A2", total: 4, messageId: "s2" }),
      dispatcher.send("U", { type: "damageRolled", messageId: "D", damages: FIRE }),
      dispatcher.send("U", { type: "saveRolled", actor: "A3", total: 9, messageId: "s3" }),
      dispatcher.send("U", { type: "saveRolled", actor: "A3", total: 20, messageId: "s4" })   // double clic : ignoré
    ]);
    expect(results).toEqual([true, true, true, true, false]);
    expect(journal.filter(l => l.startsWith("apply"))).toHaveLength(1);
    const done = flags.get("U");
    expect(done.step).toBe(STEPS.DONE);
    expect(done.targets.map(t => [t.save.success, t.damage.applied, t.effects])).toEqual([
      [true, 4, []], [false, 8, ["fx:E"]], [false, 8, ["fx:E"]]
    ]);
    expect(published.at(0)).toBe("opened→awaitingRolls");
    expect(published.at(-1)).toBe("applied→done");
  });

  it("un évènement calculé dans la file voit l'état du moment, et peut renoncer", async () => {
    const { dispatcher } = world();
    await dispatcher.open("U", opening({ attack: true }, []));
    const seen = [];
    const taken = await dispatcher.send("U", resolution => { seen.push(resolution.step); return null; });
    expect(seen).toEqual([STEPS.AWAITING_ATTACK]);
    expect(taken).toBe(false);
  });

  it("n'ouvre pas deux fois le même porteur, n'ouvre rien si le constructeur renonce, ignore un porteur sans résolution", async () => {
    const { dispatcher, journal } = world();
    expect(await dispatcher.open("X", async () => null)).toBe(null);
    await dispatcher.open("U", opening({ attack: true }, []));
    expect(await dispatcher.open("U", opening({ attack: true }, []))).toBe(null);
    expect(journal).toEqual(["écrit awaitingAttack"]);
    expect(await dispatcher.send("inconnu", { type: "undone" })).toBe(false);
  });

  it("drained attend la fin de ce qui est en file", async () => {
    const { dispatcher, flags } = world();
    dispatcher.open("U", opening({ effects: [{ id: "Bouclier", activity: "Act", when: "always" }] }, [T(1)]));
    await dispatcher.drained("U");
    expect(flags.get("U").step).toBe(STEPS.DONE);
  });

  describe("écritures regroupées (journal allégé)", () => {
    const attack = async dispatcher => {
      await dispatcher.open("U", opening({ attack: true, damage: "author", effects: [{ id: "E", activity: "Act", when: "hit" }] }, []));
      await dispatcher.send("U", { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1)] });
      await dispatcher.send("U", { type: "damageRolled", messageId: "D", damages: FIRE });
    };
    const writes = journal => journal.filter(l => l.startsWith("écrit"));

    it("une attaque touchée : une écriture par tâche au lieu d'une par étape, même état final", async () => {
      const off = world();
      await attack(off.dispatcher);
      const on = world({ coalesce: true });
      await attack(on.dispatcher);
      expect(writes(on.journal).length).toBeLessThan(writes(off.journal).length);
      expect(writes(on.journal)).toEqual(["écrit awaitingAttack", "écrit awaitingRolls", "écrit done"]);
      expect(on.flags.get("U")).toEqual(off.flags.get("U"));
      expect(on.published).toEqual(off.published);   // chaque étape reste publiée
    });

    it("peek rend l'état en mémoire avant qu'il soit écrit", async () => {
      const { dispatcher, flags } = world({ coalesce: true, flushMs: 1000 });
      const seen = [];
      await dispatcher.open("U", async () => {
        seen.push(dispatcher.peek("U"));
        return { id: "r", origin: "U", activity: "Act", source: "Src", plan: { attack: true }, targets: [] };
      });
      expect(seen).toEqual([null]);
      expect(flags.get("U").step).toBe(STEPS.AWAITING_ATTACK);   // écrit à la fin de la tâche, sans attendre le délai
      expect(dispatcher.peek("U").step).toBe(STEPS.AWAITING_ATTACK);
    });

    it("une commande qui attend quelqu'un : l'état d'attente est écrit au bout du délai, pas à la fin", async () => {
      const { dispatcher, journal } = world({ coalesce: true, flushMs: 10, think: 60, reaction: { used: null, ac: 12 } });
      await dispatcher.open("U", opening({ attack: true, damage: "author" }, []));
      await dispatcher.send("U", { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1, { canReact: true })] });
      const i = journal.indexOf("écrit awaitingReaction");
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(journal.indexOf("echo:attack @awaitingReaction"));   // écrit pendant l'attente, avant la réponse
    });
  });
});
