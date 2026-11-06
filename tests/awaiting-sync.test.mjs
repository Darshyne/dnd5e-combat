/** §381 (issue #35) : qui la table attend — diffusion entre clients (adapter/awaiting.mjs), sur des faux clients. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { AWAITING_HOOK, AWAITING_QUERY, awaitingList, changeAwaiting, markAwaiting, receiveAwaiting, syncAwaiting, whileAwaiting }
  = await import("../module/scripts/adapter/awaiting.mjs");

let published = [];
let sent = [];
const other = { id: "u2", name: "Bob", active: true, isSelf: false,
  query: vi.fn((name, payload) => { sent.push({ name, payload }); return Promise.resolve(payload.type === "sync" ? remote : true); }) };
let remote = [];
const actor = { uuid: "Actor.pal", hasPlayerOwner: true, token: null, getActiveTokens: () => [{ document: { uuid: "Scene.s.Token.t" } }] };

beforeEach(() => {
  published = []; sent = []; remote = [];
  other.query.mockClear();
  const self = { id: "u1", name: "Alice", isGM: false, active: true, isSelf: true };
  globalThis.game = { user: self, users: [self, other] };
  globalThis.Hooks = { callAll: (hook, list) => { if ( hook === AWAITING_HOOK ) published.push(list); } };
  globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 18) } };
});
afterEach(() => {
  changeAwaiting({ type: "drop", userId: "u1" });
  changeAwaiting({ type: "drop", userId: "u2" });
  delete globalThis.game; delete globalThis.Hooks; delete globalThis.foundry;
});

describe("diffusion des attentes", () => {
  it("une fenêtre ouverte : publiée ici et envoyée aux autres sans ce qu'elle demande ; sa fin la retire partout", () => {
    const release = markAwaiting(actor, "reaction", { seconds: 10 });
    expect(awaitingList()).toMatchObject([{ userId: "u1", userName: "Alice", token: "Scene.s.Token.t", actor: "Actor.pal", kind: "reaction", player: true, gm: false, seconds: 10 }]);
    expect(sent[0]).toMatchObject({ name: AWAITING_QUERY, payload: { type: "add" } });
    expect(published.at(-1)).toHaveLength(1);
    release();
    release();
    expect(awaitingList()).toEqual([]);
    expect(sent.filter(s => s.payload.type === "remove")).toHaveLength(1);
  });

  it("whileAwaiting retire l'attente même quand la fenêtre échoue", async () => {
    await expect(whileAwaiting(actor, "choice", async () => { expect(awaitingList()).toHaveLength(1); throw new Error("fermée"); })).rejects.toThrow("fermée");
    expect(awaitingList()).toEqual([]);
  });

  it("un autre client ne parle que de ses propres attentes", () => {
    const entry = { id: "x", userId: "u2", userName: "Bob", kind: "roll", since: Date.now() };
    expect(receiveAwaiting({ type: "add", entry: { ...entry, userId: "u3" } }, { user: other })).toBe(false);
    expect(receiveAwaiting({ type: "add", entry }, { user: other })).toBe(true);
    expect(awaitingList().map(e => e.id)).toEqual(["x"]);
    expect(receiveAwaiting({ type: "remove", id: "x" }, { user: { id: "u3" } })).toBe(false);
    expect(receiveAwaiting({ type: "remove", id: "x" }, { user: other })).toBe(true);
    expect(awaitingList()).toEqual([]);
  });

  it("une déconnexion retire toutes les attentes de ce client", () => {
    receiveAwaiting({ type: "add", entry: { id: "a", userId: "u2", since: Date.now() } }, { user: other });
    receiveAwaiting({ type: "add", entry: { id: "b", userId: "u2", since: Date.now() } }, { user: other });
    changeAwaiting({ type: "drop", userId: "u2" });
    expect(awaitingList()).toEqual([]);
  });

  it("un client qui arrive demande les attentes ouvertes ailleurs ; ici, on lui rend les siennes", async () => {
    remote = [{ id: "r", userId: "u2", userName: "Bob", kind: "choice", since: Date.now() }];
    await syncAwaiting();
    expect(awaitingList().map(e => e.id)).toEqual(["r"]);
    const release = markAwaiting(actor, "roll");
    expect(receiveAwaiting({ type: "sync" }, { user: other }).map(e => e.kind)).toEqual(["roll"]);
    release();
  });
});
