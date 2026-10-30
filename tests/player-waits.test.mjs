import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * §290 : fenêtres du combat sans délai. Sans délai, une question posée à un joueur attend sa réponse et se note pour le suivi du MJ ;
 * « Forcer » fait résoudre ses fenêtres chez lui comme au bout du délai ; un joueur qui part compte comme une absence de réponse. Avec
 * délai (réglage par défaut), rien ne change : la requête du cœur, telle quelle.
 */
const { expireLater, forceOpenWindows, windowsUnlimited } = await import("../module/scripts/adapter/dialogs.mjs");
const { queryPlayer, playerWaits, forcePlayerWait, FORCE_WINDOWS_QUERY, PLAYER_WAITS_HOOK } = await import("../module/scripts/adapter/player-wait.mjs");

let unlimited = true;
let hookCalls = 0;
const users = new Map();

beforeEach(() => {
  unlimited = true;
  hookCalls = 0;
  users.clear();
  globalThis.game = { settings: { get: (scope, key) => (key === "combatWindowUnlimited" ? unlimited : 10) }, users: { get: id => users.get(id) } };
  globalThis.Hooks = { callAll: hook => { if ( hook === PLAYER_WAITS_HOOK ) hookCalls += 1; } };
  globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 18) } };
});

afterEach(() => {
  vi.useRealTimers();
  forceOpenWindows();
  delete globalThis.game; delete globalThis.Hooks; delete globalThis.foundry;
});

/** Un joueur dont la réponse se donne à la main (`answer`), et qui reçoit les demandes « forcer ». */
function player(name="Alice") {
  const pending = [];
  const user = {
    id: `u-${name}`, name, active: true, forced: 0,
    query: vi.fn((query, payload, { timeout }) => {
      if ( query === FORCE_WINDOWS_QUERY ) {
        user.forced += 1;
        for ( const p of pending.splice(0) ) p.resolve("défaut");
        return Promise.resolve(1);
      }
      return new Promise((resolve, reject) => pending.push({ resolve, reject, timeout }));
    }),
    answer: value => pending.shift()?.resolve(value)
  };
  users.set(user.id, user);
  return user;
}

describe("§290 fenêtres sans délai : le MJ force", () => {
  it("le réglage se lit, faux par défaut quand il est illisible", () => {
    expect(windowsUnlimited()).toBe(true);
    delete globalThis.game;
    expect(windowsUnlimited()).toBe(false);
  });

  it("sans délai, une fenêtre attend ; forcer la résout comme le délai, une seule fois", () => {
    const expire = vi.fn();
    const disarm = expireLater(expire, 10, true);
    expect(expire).not.toHaveBeenCalled();
    expect(forceOpenWindows()).toBe(1);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(forceOpenWindows()).toBe(0);
    disarm();
  });

  it("une fenêtre désarmée (le joueur a répondu) n'est plus forcée", () => {
    const expire = vi.fn();
    expireLater(expire, 10, true)();
    expect(forceOpenWindows()).toBe(0);
    expect(expire).not.toHaveBeenCalled();
  });

  it("avec délai, le minuteur décide, pas le MJ", () => {
    vi.useFakeTimers();
    const expire = vi.fn();
    expireLater(expire, 1000, false);
    expect(forceOpenWindows()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("avec délai, la question part telle quelle et n'est pas suivie", async () => {
    unlimited = false;
    const user = player();
    const asked = queryPlayer(user, "dnd5e-combat.reaction", { a: 1 }, { timeout: 20000, label: "Réaction" });
    expect(user.query).toHaveBeenCalledWith("dnd5e-combat.reaction", { a: 1 }, { timeout: 20000 });
    expect(playerWaits()).toEqual([]);
    user.answer("ok");
    await expect(asked).resolves.toBe("ok");
  });

  it("sans délai, l'attente est notée (qui, pour qui, quoi), puis retirée à la réponse", async () => {
    const user = player();
    const actor = { uuid: "Actor.pal", name: "Paladin", img: "pal.webp" };
    const asked = queryPlayer(user, "dnd5e-combat.reaction", {}, { timeout: 20000, actor, label: "Réaction" });
    expect(user.query.mock.calls[0][2].timeout).toBeGreaterThan(60 * 60 * 1000);
    expect(playerWaits()).toMatchObject([{ userName: "Alice", actor: "Actor.pal", actorName: "Paladin", label: "Réaction" }]);
    expect(hookCalls).toBe(1);
    user.answer("bouclier");
    await expect(asked).resolves.toBe("bouclier");
    expect(playerWaits()).toEqual([]);
    expect(hookCalls).toBe(2);
  });

  it("forcer : le client du joueur résout ses fenêtres, la question revient avec la réponse par défaut", async () => {
    const user = player();
    const asked = queryPlayer(user, "dnd5e-combat.choice", {}, { timeout: 20000, label: "Choix" });
    const [wait] = playerWaits();
    await expect(forcePlayerWait(wait.id)).resolves.toBe(true);
    expect(user.forced).toBe(1);
    await expect(asked).resolves.toBe("défaut");
    expect(playerWaits()).toEqual([]);
    await expect(forcePlayerWait(wait.id)).resolves.toBe(false);
  });

  it("forcer sans fenêtre ouverte chez lui : la question est lâchée après un court délai", async () => {
    vi.useFakeTimers();
    const user = player();
    user.query.mockImplementation(query => (query === FORCE_WINDOWS_QUERY ? Promise.resolve(0) : new Promise(() => {})));
    const asked = queryPlayer(user, "dnd5e-combat.choice", {}, { timeout: 20000 });
    const outcome = asked.then(() => "réponse", err => err.message);
    await forcePlayerWait(playerWaits()[0].id);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(outcome).resolves.toMatch(/forced/);
    expect(playerWaits()).toEqual([]);
  });

  it("un joueur qui se déconnecte : la question échoue, comme sans réponse", async () => {
    vi.useFakeTimers();
    const user = player("Bob");
    const asked = queryPlayer(user, "dnd5e-combat.rollSave", {}, { timeout: 40000 });
    const outcome = asked.then(() => "réponse", err => err.message);
    user.active = false;
    await vi.advanceTimersByTimeAsync(1100);
    await expect(outcome).resolves.toMatch(/disconnected/);
    expect(playerWaits()).toEqual([]);
  });
});
