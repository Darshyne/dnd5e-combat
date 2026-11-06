/** §381 (issue #35) : qui la table attend — ce qui se calcule sans Foundry. */
import { describe, it, expect } from "vitest";
import { AWAITING_STALE_MS, applyAwaiting, awaitingAlive, awaitingEntry, awaitingLeft, awaitingPlacement, pruneAwaiting }
  from "../module/scripts/core/awaiting.mjs";

const base = { id: "a1", userId: "u1", userName: "Alice", token: "Scene.s.Token.t", actor: "Actor.x", kind: "reaction", since: 1000 };

describe("attente diffusée", () => {
  it("ne garde que sa forme publique : jamais le nom de la réaction ni l'invite", () => {
    const e = awaitingEntry({ ...base, label: "Bouclier", prompt: "Utiliser Bouclier ?", item: "Bouclier", options: [{ id: "x" }] });
    expect(Object.keys(e).sort()).toEqual(["actor", "gm", "id", "kind", "player", "refreshed", "seconds", "since", "token", "userId", "userName"]);
    expect(JSON.stringify(e)).not.toMatch(/Bouclier/);
  });
  it("une sorte inconnue devient un choix ; sans id ni utilisateur, rien", () => {
    expect(awaitingEntry({ ...base, kind: "shield" }).kind).toBe("choice");
    expect(awaitingEntry({ ...base, id: "" })).toBeNull();
    expect(awaitingEntry({ ...base, userId: null })).toBeNull();
  });
});

describe("expiration", () => {
  it("une attente sans nouvelles depuis trop longtemps est oubliée (onglet figé)", () => {
    const e = awaitingEntry(base);
    expect(awaitingAlive(e, 1000 + AWAITING_STALE_MS)).toBe(true);
    expect(awaitingAlive(e, 1001 + AWAITING_STALE_MS)).toBe(false);
    expect(awaitingAlive({ ...e, refreshed: 50000 }, 1001 + AWAITING_STALE_MS)).toBe(true);
  });
  it("une fenêtre à délai tombe après son délai et une marge", () => {
    const e = awaitingEntry({ ...base, seconds: 10 });
    expect(awaitingAlive(e, 1000 + 14000)).toBe(true);
    expect(awaitingAlive(e, 1000 + 16000)).toBe(false);
  });
  it("le reste du délai, pour la jauge ; rien sans délai", () => {
    expect(awaitingLeft(awaitingEntry({ ...base, seconds: 10 }), 6000)).toBe(0.5);
    expect(awaitingLeft(awaitingEntry({ ...base, seconds: 10 }), 99000)).toBe(0);
    expect(awaitingLeft(awaitingEntry(base), 6000)).toBeNull();
  });
  it("pruneAwaiting retire ce qui a expiré", () => {
    const list = [awaitingEntry(base), awaitingEntry({ ...base, id: "a2", seconds: 1 })];
    expect(pruneAwaiting(list, 10000).map(e => e.id)).toEqual(["a1"]);
  });
});

describe("où le montrer", () => {
  const player = awaitingEntry({ ...base, player: true });
  const gmNpc = awaitingEntry({ ...base, id: "g", userId: "gm", gm: true, player: false });
  const gmForPc = awaitingEntry({ ...base, id: "h", userId: "gm", gm: true, player: true });
  const viewer = { userId: "u2", isGM: false };
  it("au-dessus du token pour les autres, rien pour celui qui répond", () => {
    expect(awaitingPlacement(player, viewer)).toBe("token");
    expect(awaitingPlacement(player, { userId: "u1", isGM: false })).toBe("none");
  });
  it("éteint par la table ou masqué chez soi : rien", () => {
    expect(awaitingPlacement(player, { ...viewer, enabled: false })).toBe("none");
    expect(awaitingPlacement(player, { ...viewer, hidden: true })).toBe("none");
  });
  it("une fenêtre du MJ pour un monstre : bandeau discret par défaut, ou token, ou rien ; le MJ voit tout", () => {
    expect(awaitingPlacement(gmNpc, viewer)).toBe("banner");
    expect(awaitingPlacement(gmNpc, { ...viewer, gmMode: "token" })).toBe("token");
    expect(awaitingPlacement(gmNpc, { ...viewer, gmMode: "hidden" })).toBe("none");
    expect(awaitingPlacement(gmNpc, { userId: "gm2", isGM: true, gmMode: "hidden" })).toBe("token");
  });
  it("le MJ qui répond pour un personnage joueur absent : sur le token, ce n'est pas un secret", () => {
    expect(awaitingPlacement(gmForPc, viewer)).toBe("token");
  });
  it("sans token sur la scène : rien (ou le bandeau pour un secret du MJ)", () => {
    expect(awaitingPlacement({ ...player, token: null }, viewer)).toBe("none");
    expect(awaitingPlacement({ ...gmNpc, token: null }, { ...viewer, gmMode: "token" })).toBe("banner");
  });
});

describe("tableau des attentes", () => {
  it("arrivée, départ, remplacement par utilisateur, déconnexion", () => {
    let list = applyAwaiting([], { type: "add", entry: base });
    list = applyAwaiting(list, { type: "add", entry: { ...base, id: "b", userId: "u2", since: 500 } });
    expect(list.map(e => e.id)).toEqual(["b", "a1"]);
    list = applyAwaiting(list, { type: "add", entry: { ...base, kind: "roll" } });
    expect(list.filter(e => e.id === "a1").map(e => e.kind)).toEqual(["roll"]);
    list = applyAwaiting(list, { type: "replace", userId: "u1", list: [{ ...base, id: "c" }, { ...base, id: "intrus", userId: "u2" }] });
    expect(list.map(e => e.id)).toEqual(["b", "c"]);
    list = applyAwaiting(list, { type: "drop", userId: "u2" });
    expect(list.map(e => e.id)).toEqual(["c"]);
    expect(applyAwaiting(list, { type: "remove", id: "c" })).toEqual([]);
  });
});
