import { describe, it, expect } from "vitest";
import { activityToUse } from "../module/scripts/core/activity-choice.mjs";

const act = (id, timed, slot = false) => ({ id, timed, slot });

describe("choix d'activité répondu (§42.1)", () => {
  it("un item que le moteur ne connaît pas : la question reste", () => {
    expect(activityToUse({ activities: [act("cast", true, true), act("lethargy", false)], level: 3, known: false })).toBe(null);
  });
  it("une seule activité se lance, les autres sont des suites : c'est elle (Armure d'Agathys, Sanctuaire)", () => {
    expect(activityToUse({ activities: [act("cast", true, true), act("frost", false)], level: 1, known: true })).toBe("cast");
    // Même en cours : il n'y a rien d'autre à lancer.
    expect(activityToUse({ activities: [act("cast", true, true), act("frost", false)], level: 1, known: true, running: true })).toBe("cast");
  });
  it("sort à emplacements pas encore lancé : l'incantation, seule à dépenser l'emplacement (Maléfice, Chauffer le métal)", () => {
    const hex = [act("bonus", false), act("place", true, true), act("move", true, false)];
    expect(activityToUse({ activities: hex, level: 1, known: true })).toBe("place");
  });
  it("le même sort en cours : relancer ou jouer la suite est un vrai choix", () => {
    const hex = [act("bonus", false), act("place", true, true), act("move", true, false)];
    expect(activityToUse({ activities: hex, level: 1, known: true, running: true })).toBe(null);
  });
  it("plusieurs incantations possibles : un vrai choix (Malédiction, Mur de feu, Châtiment divin)", () => {
    const curse = [act("a", true, true), act("b", true, true), act("c", true, true)];
    expect(activityToUse({ activities: curse, level: 3, known: true })).toBe(null);
  });
  it("tour de magie à deux activités qui se lancent : on demande (Lumières dansantes, Flammes)", () => {
    expect(activityToUse({ activities: [act("create", true, true), act("move", true, true)], level: 0, known: true })).toBe(null);
  });
  it("Glas : l'activité selon les PV de la cible, même sans autre règle", () => {
    const acts = [act("healthy", true, true), act("wounded", true, true)];
    const byWounds = { healthy: "healthy", wounded: "wounded" };
    expect(activityToUse({ activities: acts, byWounds, wounded: true })).toBe("wounded");
    expect(activityToUse({ activities: acts, byWounds, wounded: false })).toBe("healthy");
    expect(activityToUse({ activities: [act("healthy", true, true)], byWounds, wounded: true })).toBe("healthy");
  });
});

describe("choix d'activité — l'activité que l'item désigne (§45)", () => {
  const toad = [{ id: "damage", timed: true, slot: true }, { id: "corpse", timed: true, slot: true }, { id: "expend", timed: true, slot: true }];
  it("Engloutissement du Crapaud géant : l'action qui avale, pas les dégâts ni la sortie du cadavre", () => {
    expect(activityToUse({ activities: toad, known: true, entry: "expend" })).toBe("expend");
    expect(activityToUse({ activities: toad, known: true })).toBeNull();
  });
  it("une activité désignée qui n'est pas proposée ne décide rien", () => {
    expect(activityToUse({ activities: toad, known: true, entry: "absente" })).toBeNull();
  });
});

describe("choix d'activité — une attaque et ses suites (§46)", () => {
  const a = (id, type, cost) => ({ id, type, cost, timed: cost, slot: true });
  it("Griffe de la Goule : l'attaque, la sauvegarde est enchaînée par le moteur", () => {
    expect(activityToUse({ activities: [a("attack", "attack", true), a("save", "save", false)] })).toBe("attack");
  });
  it("Morsure de la Grenouille géante : l'attaque, pas le test d'évasion (activation spéciale)", () => {
    expect(activityToUse({ activities: [a("attack", "attack", true), { id: "check", type: "check", cost: false, timed: true, slot: true }] })).toBe("attack");
  });
  it("deux activités qui coûtent une action : la question reste", () => {
    expect(activityToUse({ activities: [a("attack", "attack", true), a("bolt", "save", true)] })).toBeNull();
  });
  it("une seule activité coûteuse qui n'est pas une attaque : la règle des items connus décide", () => {
    const list = [a("cast", "save", true), a("after", "damage", false)];
    expect(activityToUse({ activities: list, known: false })).toBeNull();
  });
});
