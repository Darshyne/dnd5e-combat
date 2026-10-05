/** §80 : Faim de Hadar (une activité sœur par moment de zone) et Frappe piégeuse (dégâts au début du tour de l'entravée). */
import { describe, it, expect } from "vitest";
import { siblingFor, hitKey, siblingsByMoment, shouldTrigger, markHit, openArea, pulseFor, pulseTargets } from "../module/scripts/core/area.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("une activité sœur par moment", () => {
  it("siblingsByMoment : seulement quand elles diffèrent", () => {
    expect(siblingsByMoment([{ on: ["turnStart"], activity: "cold" }, { on: ["turnEnd"], activity: "acid" }])).toEqual({ turnStart: "cold", turnEnd: "acid" });
    expect(siblingsByMoment([{ on: ["enter", "turnEnd"], activity: "save" }])).toBeNull();   // Cordon de flèches
    expect(siblingsByMoment([{ on: ["enter", "turnEnd"], activity: null }])).toBeNull();     // Rayon de lune
  });
  it("siblingFor : celle du moment, sinon la seule", () => {
    const hadar = { activity: "acid", activities: { turnStart: "cold", turnEnd: "acid" } };
    expect(siblingFor(hadar, "turnStart")).toBe("cold");
    expect(siblingFor(hadar, "turnEnd")).toBe("acid");
    expect(siblingFor({ activity: "save" }, "enter")).toBe("save");
    expect(siblingFor({ activity: null }, "enter")).toBeNull();
  });
  it("le froid du début du tour n'empêche pas l'acide de la fin, chacun une fois par tour", () => {
    const area = { ...openArea(["turnStart", "turnEnd"], "1-0"), activities: { turnStart: "cold", turnEnd: "acid" } };
    const at = event => ({ event, token: hitKey(area, event, "T"), turnKey: "1-0" });
    const afterStart = { ...area, ...markHit(area, at("turnStart")) };
    expect(shouldTrigger(afterStart, at("turnEnd"))).toBe(true);
    expect(shouldTrigger(afterStart, at("turnStart"))).toBe(false);
  });
  it("une zone à une seule activité garde « une fois par tour » (Rayon de lune)", () => {
    const area = openArea(["enter", "turnEnd"], "1-0");
    const ctx = event => ({ event, token: hitKey(area, event, "T"), turnKey: "1-0" });
    const after = { ...area, ...markHit(area, ctx("enter")) };
    expect(shouldTrigger(after, ctx("turnEnd"))).toBe(false);
  });
});

describe("contenu", () => {
  it("Faim de Hadar", () => {
    expect(CONTENT["hunger-of-hadar"].triggers).toEqual([
      { on: "turnStart", do: [{ type: "replay", activity: "G6bH5mBR3kkEYjYe" }] },
      { on: "turnEnd", do: [{ type: "replay", activity: "FGDyvqQz5JQQc5mf" }] }
    ]);
    expect(validateEntry(CONTENT["hunger-of-hadar"])).toEqual([]);
  });
  it("Frappe piégeuse : dégâts au début du tour, et l'évasion par un autre reste", () => {
    expect(CONTENT["ensnaring-strike"].triggers).toEqual([{ on: "startOfTurn", via: "effect", fromEffect: "tFGMG3cjQTEeAhv2",
      do: [{ type: "damage", to: "bearer", activity: "ZWId9mbOE9zFnP6f" }] }]);
    expect(CONTENT["ensnaring-strike"].actionEnds).toEqual({ tFGMG3cjQTEeAhv2: { by: "other", roll: "check" } });
    expect(CONTENT["ensnaring-strike"].noDamage).toEqual(["dnd5eactivity000"]);   // §81 : pas de dégâts au lancement
    expect(validateEntry(CONTENT["ensnaring-strike"])).toEqual([]);
  });
});

describe("noDamage (§81)", () => {
  it("liste d'ids d'activité de 16 caractères", () => {
    expect(validateEntry({ noDamage: ["dnd5eactivity000"] })).toEqual([]);
    expect(validateEntry({ noDamage: [] }).length).toBeGreaterThan(0);
    expect(validateEntry({ noDamage: ["court"] }).length).toBeGreaterThan(0);
    expect(validateEntry({ noDamage: "dnd5eactivity000" }).length).toBeGreaterThan(0);
  });
});

describe("Mur d'épines (§85)", () => {
  it("entrée et fin de tour : la sœur « Traversal Save », une fois par tour", () => {
    expect(CONTENT["wall-of-thorns"].triggers).toEqual([{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dMiM7Qec4keU3w7B" }] }]);
    expect(validateEntry(CONTENT["wall-of-thorns"])).toEqual([]);
  });
});

describe("Aura sacrée (§86)", () => {
  it("aura : avantage aux sauvegardes, alliés et soi, tant que le sort tient", () => {
    const aura = CONTENT["holy-aura"].aura;
    expect(aura).toMatchObject({ whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft" });
    expect(aura.changes.map(c => c.key)).toContain("system.abilities.con.save.roll.mode");
  });
  it("désavantage des attaquants, sauvegarde d'un Fiélon ou d'un Mort-vivant qui touche au corps à corps", () => {
    const [disadvantage, retaliation] = CONTENT["holy-aura"].triggers;
    expect(disadvantage).toMatchObject({ on: "preAttackRoll", via: "effect", do: [{ type: "disadvantage" }] });
    expect(retaliation).toEqual({ on: "isHit", via: "effect", if: { "activity.isMelee": true, "source.creatureType": ["fiend", "undead"] },
      do: [{ type: "save", to: "source", activity: "0kylpwRauH0WgW0G" }] });
    const facts = { "target.hasEffect": true, "activity.isMelee": true, "source.creatureType": true };
    expect(validateEntry(CONTENT["holy-aura"], { facts })).toEqual([]);
  });
  it("étape save : vers la source, une activité", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "save", to: "source", activity: "0kylpwRauH0WgW0G" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "save", to: "bearer", activity: "0kylpwRauH0WgW0G" }] }] }).length).toBeGreaterThan(0);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "save", to: "source" }] }] }).length).toBeGreaterThan(0);
  });
});

describe("gabarit fourni par le contenu : Yolande, êtres sylvestres (§86)", () => {
  it("selfZone et zoneAffects, validés", () => {
    const facts = {};
    for ( const id of ["yolandes-regal-presence", "conjure-woodland-beings"] ) {
      expect(CONTENT[id].zoneAffects).toBe("enemy");
      expect(Object.values(CONTENT[id].selfZone)[0]).toEqual({ type: "radius", size: 10, units: "ft" });
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
    expect(CONTENT["yolandes-regal-presence"].triggers[1]).toEqual({ on: "failedSave", do: [{ type: "status", status: "prone" }] });
  });
  it("refus", () => {
    expect(validateEntry({ selfZone: { court: { type: "radius", size: 10, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ selfZone: { dnd5eactivity000: { type: "cone", size: 10, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ selfZone: { dnd5eactivity000: { type: "radius", size: 0, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ zoneAffects: "everyone" }).length).toBeGreaterThan(0);
  });
});

describe("manœuvres au toucher (§87)", () => {
  const facts = { "target.hasEffect": true, "target.hasEffectFrom": true, "source.hasEffect": true, "source.hasEffectFromTarget": true };
  for ( const id of ["disarming-attack", "distracting-strike", "goading-attack", "menacing-attack", "pushing-attack", "trip-attack", "maneuvering-attack"] ) {
    it(id, () => {
      expect(CONTENT[id].hitRider).toMatchObject({ pays: "combat-superiority", weaponDamage: true });
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    });
  }
  it("repoussante et croc-en-jambe : taille G au plus ; provocante : la sauvegarde sans dégâts", () => {
    expect(CONTENT["pushing-attack"].hitRider.sizeAtMost).toBe("lg");
    expect(CONTENT["trip-attack"].triggers).toEqual([{ on: "failedSave", do: [{ type: "status", status: "prone" }] }]);
    expect(CONTENT["goading-attack"].noDamage).toEqual(["YZDchvLnuCD6xMkF"]);
  });
  it("pays : une chaîne, pas avec slot", () => {
    expect(validateEntry({ hitRider: { pays: "combat-superiority", damage: "mlUC7IiS8ZyTvDpZ" } })).toEqual([]);
    expect(validateEntry({ hitRider: { pays: "combat-superiority", slot: "pact" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ hitRider: { pays: "" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ hitRider: { weaponDamage: "oui" } }).length).toBeGreaterThan(0);
  });
});

describe("Parade et Riposte du Maître de guerre (§88)", () => {
  it("la Parade du PHB a son propre identifiant ; celle du Monster Manual ne change pas", async () => {
    const { SOURCE_IDENTIFIERS } = await import("../module/scripts/content/sources.mjs");
    expect(SOURCE_IDENTIFIERS.phbmnvParry00000).toBe("parry-maneuver");
    expect(CONTENT["parry-maneuver"].triggers[0].do).toEqual([{ type: "use", activity: "F4UxiihGgkdv4orJ" }, { type: "reduce" }]);
    expect(CONTENT.parry.triggers[0].do).toEqual([{ type: "use" }, { type: "penalty", formula: "@prof" }]);
  });
  it("Riposte : use vers la source, avec l'arme", () => {
    expect(CONTENT.riposte.triggers).toEqual([{ on: "isMissed", if: { "activity.isMelee": true },
      do: [{ type: "use", target: "source", activity: "QhxT9ZuZXmHGlrnT", weapon: true }] }]);
    expect(validateEntry(CONTENT.riposte, { facts: { "activity.isMelee": true } })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isMissed", do: [{ type: "use", weapon: true }] }] }).length).toBeGreaterThan(0);
  });
});

describe("manœuvres à l'action Bonus (§89)", () => {
  it("Fente, Feinte, Jeu de jambes évasif", () => {
    expect(CONTENT["lunging-attack"]).toMatchObject({ basicActions: { aoTn3UKohm5VAuIT: "dash" }, noDamage: ["aoTn3UKohm5VAuIT"], pendingDie: { activity: "aoTn3UKohm5VAuIT", against: "melee" } });
    expect(CONTENT["feinting-attack"].pendingDie).toEqual({ activity: "Utu8uaZOMepShbyw", against: "target" });
    expect(CONTENT["evasive-footwork"]).toMatchObject({ basicActions: { d3RqzIKzhqX82OwP: "disengage" }, rolledAc: { activity: "d3RqzIKzhqX82OwP", effect: "rGEvj6OHUjHan8pq" } });
    for ( const id of ["lunging-attack", "feinting-attack", "evasive-footwork"] ) expect(validateEntry(CONTENT[id], { facts: { "target.hasEffectFrom": true } })).toEqual([]);
  });
  it("refus", () => {
    expect(validateEntry({ pendingDie: { activity: "aoTn3UKohm5VAuIT", against: "ranged" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ pendingDie: { activity: "court", against: "melee" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ rolledAc: { activity: "d3RqzIKzhqX82OwP" } }).length).toBeGreaterThan(0);
  });
});

describe("le reste des manœuvres (§90)", () => {
  it("Attaque précise, Embuscade, Autorité naturelle, Évaluation tactique : rollBonus", () => {
    expect(CONTENT["precision-attack"].rollBonus).toEqual({ activity: "WrckriM4bPU6NS38", on: ["attack"] });
    expect(CONTENT.ambush.rollBonus).toEqual({ activity: "HiargkiZgN4q8kg6", on: ["check", "initiative"], skills: ["ste"] });
    expect(CONTENT["commanding-presence"].rollBonus.skills).toEqual(["itm", "prf", "per"]);
    expect(CONTENT["tactical-assessment"].rollBonus.skills).toEqual(["his", "inv", "ins"]);
  });
  it("Balayage, Chassé-croisé, Frappe commandée", () => {
    expect(CONTENT["sweeping-attack"]).toEqual({ sweep: { activity: "P9XWzKIH1sEvsOtC" } });
    expect(CONTENT["bait-and-switch"]).toEqual({ swapPlaces: { activity: "nYe2l7Rml0qyFbf6" }, rolledAc: { activity: "nYe2l7Rml0qyFbf6", effect: "8HUDgkIN8xvG2BAm", to: "choose" } });
    expect(CONTENT["commanders-strike"]).toEqual({ replacesAttack: true, noDamage: ["spcp6PQ8947Ds4Qg"], commandStrike: { activity: "spcp6PQ8947Ds4Qg" } });
    for ( const id of ["precision-attack", "ambush", "commanding-presence", "tactical-assessment", "sweeping-attack", "bait-and-switch", "commanders-strike"] ) {
      expect(validateEntry(CONTENT[id])).toEqual([]);
    }
  });
  it("refus", () => {
    expect(validateEntry({ sweep: { activity: "court" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ swapPlaces: { activity: "nYe2l7Rml0qyFbf6", distance: 5 } }).length).toBeGreaterThan(0);
    expect(validateEntry({ commandStrike: true }).length).toBeGreaterThan(0);
    expect(validateEntry({ rolledAc: { activity: "nYe2l7Rml0qyFbf6", effect: "8HUDgkIN8xvG2BAm", to: "other" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ rollBonus: { activity: "WrckriM4bPU6NS38", on: ["attack"], skills: "ste" } }).length).toBeGreaterThan(0);
  });
});

describe("sorts au tour du lanceur (§91)", () => {
  it("pulseFor : l'entrée qui couvre le numéro du rejeu", () => {
    const rule = CONTENT["storm-of-vengeance"].casterPulse;
    expect(pulseFor(rule, 1).activity).toBe("WOo8u0FLAzNMpMJN");
    expect(pulseFor(rule, 2)).toMatchObject({ activity: "Fd8ZGgmDyNmJJuj3", max: 6 });
    expect(pulseFor(rule, 3).activity).toBe("H4uCtCkANBkttnov");
    expect(pulseFor(rule, 4).activity).toBe("yt2oWWelZl1zV4CB");
    expect(pulseFor(rule, 9).activity).toBe("yt2oWWelZl1zV4CB");
    expect(pulseFor(rule, 10)).toBeNull();
  });
  it("pulseTargets : les ennemis du lanceur d'abord, plafonnés", () => {
    const t = [{ n: "a", disposition: 1 }, { n: "b", disposition: -1 }, { n: "c", disposition: -1 }, { n: "d", disposition: 1 }];
    expect(pulseTargets(t, 1, 2).map(x => x.n)).toEqual(["b", "c"]);
    expect(pulseTargets(t, 1, 3).map(x => x.n)).toEqual(["b", "c", "a"]);
    expect(pulseTargets(t, 1).map(x => x.n)).toEqual(["b", "c", "a", "d"]);
  });
  it("le contenu des six sorts est valide", () => {
    for ( const id of ["storm-of-vengeance", "earthquake", "delayed-blast-fireball", "tsunami", "symbol", "forbiddance"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "activity.id": true, "source.hasEffect": true } }), id).toEqual([]);
    }
    expect(CONTENT.earthquake.triggers[0].do).toEqual([{ type: "status", status: "prone" }, { type: "breakConcentration" }]);
    expect(CONTENT["delayed-blast-fireball"].zoneEnd).toEqual({ activity: "M15GlfjeWy7Cdiqn" });
    expect(CONTENT.forbiddance.selfZone.T2XK004SAb09LvvP.type).toBe("cube");
  });
  it("refus", () => {
    const by = [{ from: 1, activity: "WOo8u0FLAzNMpMJN" }];
    expect(validateEntry({ casterPulse: { at: "turnEnd", by } })).toEqual([]);
    expect(validateEntry({ casterPulse: { at: "round", by } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by: [] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by: [{ from: 0, activity: "WOo8u0FLAzNMpMJN" }] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by: [{ from: 3, to: 2, activity: "WOo8u0FLAzNMpMJN" }] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by, away: { distance: -5, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ zoneEnd: { activity: "court" } }).length).toBeGreaterThan(0);
  });
});
