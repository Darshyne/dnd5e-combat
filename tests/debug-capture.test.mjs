import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * §380 (issue #36) : la capture du débogueur, sur une console et une fenêtre factices. Les erreurs de la suite sont gardées,
 * pas les autres ; une erreur d'un inscrit du routeur n'est comptée qu'une fois, avec son libellé ; un joueur envoie ses
 * nouveautés au MJ actif et les garde si l'envoi échoue.
 */
const debug = await import("../module/scripts/runtime/debug.mjs");
const { debugApi, installCapture, uninstallCapture, noteRouterError, noteRefused, trail, flush, receive, collectSections,
  knownRepos, isSuitePackage } = debug;

const frame = id => `Error: x\n    at f (https://h.forge-vtt.com/modules/${id}/scripts/a.mjs:3:4)`;
const errorFrom = (id, message="boom") => {
  const err = new Error(message);
  err.stack = `Error: ${message}\n    at f (https://h.forge-vtt.com/modules/${id}/scripts/a.mjs:3:4)`;
  return err;
};

function fakeTarget() {
  const listeners = {};
  const seen = { error: [], warn: [], log: [] };
  return {
    seen, listeners,
    console: { error: (...a) => seen.error.push(a), warn: (...a) => seen.warn.push(a), log: (...a) => seen.log.push(a) },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: type => { delete listeners[type]; }
  };
}

function modules(list) {
  const arr = list.map(([id, title, url=null]) => ({ id, title, url, active: true }));
  return Object.assign(arr, { get: id => arr.find(m => m.id === id) });
}

let target;
beforeEach(() => {
  uninstallCapture();
  target = fakeTarget();
  installCapture(target);
  debugApi.clear();
  debugApi.verbose(false);
  debugApi.clear();
  globalThis.game = { user: { id: "u-gm" }, modules: modules([["dnd5e-combat", "DAS · Core", "https://github.com/Darshyne/dnd5e-combat"],
    ["darsh-loot", "DAS · Loot & Trade", "https://github.com/Darshyne/darsh-loot"], ["other-mod", "Other"]]) };
});

afterEach(() => {
  uninstallCapture();
  delete globalThis.game;
});

describe("capture (§380)", () => {
  it("garde les erreurs de la suite, appelle toujours la console d'origine", () => {
    target.console.error("dnd5e-combat |", errorFrom("darsh-loot"));
    target.console.error(errorFrom("other-mod"));
    target.console.warn("darsh-loot | no pile here");
    expect(target.seen.error).toHaveLength(2);
    expect(target.seen.warn).toHaveLength(1);
    const list = debugApi.errors();
    expect(list.map(g => [g.kind, g.module])).toEqual(expect.arrayContaining([["error", "darsh-loot"], ["warn", "darsh-loot"]]));
    expect(list).toHaveLength(2);
    expect(list.every(g => g.clients[0] === "u-gm")).toBe(true);
  });

  it("une erreur répétée se compte", () => {
    target.console.error(errorFrom("dnd5e-combat", "Token abcdefghij123456 missing"));
    target.console.error(errorFrom("dnd5e-combat", "Token ZZZZZZZZZZ999999 missing"));
    expect(debugApi.errors()).toHaveLength(1);
    expect(debugApi.total()).toBe(2);
  });

  it("l'erreur d'un inscrit du routeur : son libellé et son hook, comptée une fois", () => {
    const err = errorFrom("dnd5e-combat");
    noteRouterError({ label: "Brutal Strike", hook: "dnd5e.rollDamage", level: "error" }, err);
    target.console.error("dnd5e-combat | Brutal Strike", err);
    const [g] = debugApi.errors();
    expect(g).toMatchObject({ label: "Brutal Strike", hook: "dnd5e.rollDamage", count: 1, module: "dnd5e-combat" });
  });

  it("fige la piste dans la nouvelle erreur", () => {
    trail("use", "rage · utility");
    noteRefused({ hook: "preMoveToken", label: "turn budget" });
    target.console.error(errorFrom("dnd5e-combat"));
    const [g] = debugApi.errors();
    expect(g.trail.map(s => s.kind)).toEqual(["use", "refused"]);
    expect(g.trail[1].text).toBe("preMoveToken ← turn budget");
    expect(debugApi.trailList()).toHaveLength(2);
  });

  it("les erreurs non attrapées et les promesses rejetées", () => {
    target.listeners.error({ error: errorFrom("darsh-loot", "uncaught") });
    target.listeners.unhandledrejection({ reason: errorFrom("dnd5e-combat", "rejected") });
    target.listeners.unhandledrejection({ reason: "plain" });       // sans pile ni préfixe : hors de la suite
    expect(debugApi.errors().map(g => g.kind).sort()).toEqual(["error", "rejection"]);
  });

  it("désinstallée : la console d'origine rendue, plus rien de relevé", () => {
    const original = target.console.error;
    uninstallCapture();
    expect(target.console.error).not.toBe(original);
    expect(target.listeners.error).toBeUndefined();
    target.console.error(errorFrom("dnd5e-combat"));
    expect(debugApi.errors()).toHaveLength(0);
  });

  it("mode détaillé : les lignes de la suite seulement, et seulement allumé", () => {
    target.console.log("dnd5e-combat | resolved");
    expect(debugApi.logs()).toHaveLength(0);
    debugApi.verbose(true);
    target.console.log("dnd5e-combat | resolved");
    target.console.log("other-mod | hello");
    target.console.log("plain");
    expect(debugApi.logs().map(l => l.module)).toEqual(["dnd5e-combat"]);
    expect(target.seen.log).toHaveLength(4);
  });

  it("un paquet de la suite : titre « DAS · », inscrit, ou modules pas encore lus", () => {
    expect(isSuitePackage("darsh-loot")).toBe(true);
    expect(isSuitePackage("other-mod")).toBe(false);
    expect(isSuitePackage("system:dnd5e")).toBe(false);
    debugApi.register({ module: "other-mod", repo: "Someone/other", collect: () => ({ theme: "bg3" }) });
    expect(isSuitePackage("other-mod")).toBe(true);
    delete globalThis.game;
    expect(isSuitePackage("anything")).toBe(true);
  });
});

describe("voisins (§380)", () => {
  it("sections et dépôts", () => {
    debugApi.register({ module: "darsh-dnd-ui", collect: () => ({ theme: "bg3" }) });
    debugApi.register({ module: "broken", collect: () => { throw new Error("nope"); } });
    expect(debugApi.register({})).toBe(false);
    const sections = collectSections();
    expect(sections).toEqual(expect.arrayContaining([{ module: "darsh-dnd-ui", data: { theme: "bg3" } },
      { module: "broken", data: { error: "Error: nope" } }]));
    debugApi.trail("darsh-loot", "search", "pile · 3 items");
    expect(debugApi.trailList().at(-1)).toMatchObject({ module: "darsh-loot", kind: "search" });
    expect(knownRepos()).toMatchObject({ "dnd5e-combat": "https://github.com/Darshyne/dnd5e-combat",
      "darsh-loot": "https://github.com/Darshyne/darsh-loot", "other-mod": "Someone/other" });
  });
});

describe("remontée vers le MJ actif (§380)", () => {
  it("envoie ce qui est nouveau, le garde si l'envoi échoue, rien sans MJ", async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(true);
    globalThis.game.user = { id: "u-p1" };
    globalThis.game.users = { activeGM: null };
    target.console.error(errorFrom("dnd5e-combat"));
    expect(await flush()).toBe(false);                       // pas de MJ : gardé
    globalThis.game.users.activeGM = { isSelf: false, active: true, query };
    expect(await flush()).toBe(false);                       // échec : gardé
    expect(await flush()).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    const [name, payload] = query.mock.calls[1];
    expect(name).toBe("dnd5e-combat.debug");
    expect(payload.userId).toBe("u-p1");
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].added).toBe(1);
    expect(await flush()).toBe(false);                       // rien de nouveau
  });

  it("le MJ fusionne avec le client d'origine", () => {
    target.console.error(errorFrom("dnd5e-combat"));
    const [mine] = debugApi.errors();
    expect(receive({ userId: "u-p1", items: [{ ...mine, added: 3 }] })).toBe(true);
    expect(receive({})).toBe(false);
    const [g] = debugApi.errors();
    expect(g.count).toBe(4);
    expect(g.clients).toEqual(["u-gm", "u-p1"]);
  });

  it("chez le MJ actif lui-même, rien n'est envoyé", async () => {
    const query = vi.fn();
    globalThis.game.users = { activeGM: { isSelf: true, active: true, query } };
    target.console.error(errorFrom("dnd5e-combat"));
    await flush();
    expect(query).not.toHaveBeenCalled();
  });
});

