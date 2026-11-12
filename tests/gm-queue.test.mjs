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

// §422 : les boutons des demandes faites au MJ, les jets demandés.
describe("gmQueue — fenêtres de ce poste et jets demandés", () => {
  const awaiting = [
    { id: "a1", userId: "gm", userName: "MJ", actor: "Actor.ogre", kind: "reaction", gm: true, since: 30 },
    { id: "a2", userId: "u1", userName: "Alara", actor: "Actor.sylaene", kind: "roll", gm: false, since: 10 },
    { id: "a3", userId: "u2", userName: "Bramo", actor: "Actor.bramo", kind: "choice", gm: false, since: 20 }
  ];
  const prompts = [{ id: "a1", awaitingId: "a1", title: "Réaction — Ogre", text: "Le Guerrier quitte votre allonge.", buttons: [{ action: "use0", label: "Gourdin" }, { action: "none", label: "Ne pas réagir" }] }];

  it("la fenêtre ouverte sur ce poste donne à la ligne du MJ son texte et ses boutons", () => {
    const q = gmQueue({ awaiting, prompts });
    expect(q.mine[0].prompt).toEqual({ id: "a1", text: "Le Guerrier quitte votre allonge.", buttons: prompts[0].buttons });
    expect(q.mine[0].label).toBe("Réaction — Ogre");
    expect(q.players.every(l => l.prompt === null)).toBe(true);
  });

  it("sans fenêtre connue de ce poste (un autre MJ), la ligne reste sans boutons", () => {
    expect(gmQueue({ awaiting }).mine[0].prompt).toBeNull();
  });

  it("un jet demandé encore attendu marque la ligne du joueur : son forçage est « Lancer pour lui »", () => {
    const q = gmQueue({ awaiting, groupRolls: [{ messageId: "m7", actor: "Actor.sylaene", label: "Test de Perception" }] });
    expect(q.players.find(l => l.id === "a2")).toMatchObject({ groupRoll: "m7", label: "Test de Perception" });
  });

  it("seul un jet (pas un choix) du même personnage est rattaché à la demande", () => {
    const q = gmQueue({ awaiting, groupRolls: [{ messageId: "m7", actor: "Actor.bramo", label: "Test" }] });
    expect(q.players.find(l => l.id === "a3").groupRoll).toBeNull();
  });

  it("l'empreinte change quand la fenêtre arrive", () => {
    expect(queueSignature(gmQueue({ awaiting, prompts }))).not.toBe(queueSignature(gmQueue({ awaiting })));
  });
});
