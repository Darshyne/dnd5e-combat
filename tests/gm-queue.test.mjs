import { describe, it, expect } from "vitest";
import { gmQueue, queueSignature } from "../module/scripts/core/gm-queue.mjs";

// §421 : la File du MJ — une ligne par fenêtre qui fait attendre la table, rangée pour le MJ.
describe("gmQueue", () => {
  const awaiting = [
    { id: "a1", userId: "gm", userName: "MJ", actor: "Actor.ogre", kind: "reaction", gm: true, player: false, since: 30, seconds: 10 },
    { id: "a2", userId: "u1", userName: "Alara", actor: "Actor.sylaene", kind: "roll", gm: false, player: true, since: 10, seconds: null },
    { id: "a3", userId: "u2", userName: "Bramo", actor: "Actor.bramo", kind: "reaction", gm: false, player: true, since: 20, seconds: 10 }
  ];

  it("range les fenêtres du MJ d'un côté, celles des joueurs de l'autre, les plus anciennes d'abord", () => {
    const q = gmQueue({ awaiting });
    expect(q.mine.map(l => l.id)).toEqual(["a1"]);
    expect(q.players.map(l => l.id)).toEqual(["a2", "a3"]);
    expect(q.count).toBe(3);
  });

  it("une fenêtre ouverte chez l'auteur (aucune question posée par le MJ) a quand même sa ligne, forçable par son joueur", () => {
    const q = gmQueue({ awaiting, waits: [] });
    expect(q.players[0]).toMatchObject({ id: "a2", userId: "u1", kind: "roll", label: "", waitIds: [] });
  });

  it("la question posée au joueur donne son libellé à la fenêtre, sans faire une seconde ligne", () => {
    const waits = [{ id: "w1", userId: "u2", userName: "Bramo", actor: "Actor.bramo", label: "Réaction", since: 19 }];
    const q = gmQueue({ awaiting, waits });
    expect(q.players.map(l => l.id)).toEqual(["a2", "a3"]);
    expect(q.players[1]).toMatchObject({ label: "Réaction", waitIds: ["w1"] });
  });

  it("une question sans fenêtre annoncée garde sa ligne", () => {
    const waits = [{ id: "w9", userId: "u3", userName: "Kaalisti", actor: "Actor.k", label: "Présage", since: 5 }];
    const q = gmQueue({ awaiting, waits });
    expect(q.players[0]).toMatchObject({ id: "wait:w9", source: "wait", label: "Présage", waitIds: ["w9"] });
  });

  it("les actions bloquées (auteur parti) ont leur part", () => {
    const q = gmQueue({ blocked: [{ messageId: "m1", userName: "Bramo", actorName: "Bramo", item: "Épée longue" }] });
    expect(q.blocked).toEqual([{ id: "blocked:m1", messageId: "m1", userName: "Bramo", actorName: "Bramo", item: "Épée longue" }]);
    expect(q.count).toBe(1);
  });

  it("l'empreinte ne change que quand une ligne arrive, part ou reçoit son libellé", () => {
    const a = queueSignature(gmQueue({ awaiting }));
    expect(queueSignature(gmQueue({ awaiting: awaiting.map(e => ({ ...e, since: e.since + 1000 })) }))).toBe(a);
    expect(queueSignature(gmQueue({ awaiting: awaiting.slice(1) }))).not.toBe(a);
    expect(queueSignature(gmQueue({ awaiting, waits: [{ id: "w1", userId: "u2", actor: "Actor.bramo", label: "Réaction" }] }))).not.toBe(a);
  });

  it("vide sans rien", () => {
    expect(gmQueue()).toEqual({ mine: [], players: [], blocked: [], count: 0 });
  });
});
