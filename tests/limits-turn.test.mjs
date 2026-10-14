import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * « Une fois par tour » (§16.40 `usageLimits.oncePerTurn`, §16.46 `damageShield.oncePerTurn`) : la marque posée sur l'acteur ou
 * l'effet portait seulement `round-turn`, jamais effacée. Dans un combat suivant, au même round et au même rang, l'activité était
 * jugée déjà utilisée. La clé porte maintenant l'id du combat (`currentTurnKey` d'adapter/turn.mjs).
 */
vi.mock("../module/scripts/adapter/content.mjs", async importOriginal => ({
  ...(await importOriginal()),
  contentOf: item => ({ entry: item?.rule ?? null }),
  identifierOf: item => ({ id: item?.identifier ?? null })
}));
const { usageLimitProblems, markUsedThisTurn } = await import("../module/scripts/adapter/limits.mjs");
const { applyDamageShields } = await import("../module/scripts/adapter/defenses.mjs");

/** Un document qui garde ses flags : getFlag / setFlag. */
function withFlags(doc) {
  const flags = {};
  return Object.assign(doc, {
    getFlag: (scope, key) => flags[`${scope}.${key}`],
    setFlag: async (scope, key, value) => { flags[`${scope}.${key}`] = value; }
  });
}

const combat = id => ({ id, started: true, round: 1, turn: 0, getCombatantsByActor: () => [] });

afterEach(() => { delete globalThis.game; delete globalThis.Roll; });

describe("« une fois par tour » ne passe pas d'un combat à l'autre", () => {
  it("usageLimits : la marque d'un combat précédent, même round et même rang, ne bloque pas", async () => {
    const actor = withFlags({ isOwner: true, items: [] });
    const item = { rule: { usageLimits: { act1: { oncePerTurn: true } } } };
    const activity = { id: "act1", item, actor };
    const used = () => usageLimitProblems(activity, { inCombat: true, ownTurn: true }).issues.length > 0;

    globalThis.game = { combat: combat("combatAAAAAAAAAA") };
    expect(used()).toBe(false);
    await expect(markUsedThisTurn(activity)).resolves.toBe(true);
    expect(used()).toBe(true);

    globalThis.game = { combat: combat("combatBBBBBBBBBB") };
    expect(used()).toBe(false);
  });

  it("damageShield : la marque de l'effet d'un combat précédent ne l'empêche pas de protéger", async () => {
    globalThis.Roll = class { constructor() {} async evaluate() { this.total = 3; return this; } };
    const item = { rule: { damageShield: { worn: "fire", formula: "1d4", oncePerTurn: true } }, system: { equipped: true } };
    const shield = withFlags(Object.assign(item, { name: "Bouclier" }));
    const actor = { items: [shield], effects: [] };
    const hit = () => applyDamageShields(actor, [{ type: "fire", value: 10 }]);

    globalThis.game = { combat: combat("combatAAAAAAAAAA") };
    expect((await hit()).done).toHaveLength(1);
    expect((await hit()).done).toHaveLength(0);      // même tour : déjà servi

    globalThis.game = { combat: combat("combatBBBBBBBBBB") };
    expect((await hit()).done).toHaveLength(1);
  });
});
