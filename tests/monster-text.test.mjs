import { describe, expect, it } from "vitest";
import { conditionsIn, monsterEndings, plainText, readEndings } from "../module/scripts/core/monster-text.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// Exemples synthétiques, réduits aux tournures que le lecteur reconnaît (aucun texte de livre).
const repeat = "Failure: The target has the Stunned condition and repeats the save at the end of each of its turns, ending the effect on itself on a success.";
const twoStep = "First Failure: The target has the Restrained condition and repeats the save at the end of its next turn if it is still Restrained. Second Failure: The target has the Petrified condition instead of the Restrained condition.";
const twoStepAlt = "Failure: The target has the Incapacitated condition until the end of its next turn, at which point it repeats the save. Second Failure: The target has the Unconscious condition for 10 minutes. This effect ends for the target if it takes damage.";
const damageEnds = "Failure: The target has the Charmed condition for 1 hour or until it takes damage.";

describe("K1 : fin des états d'une capacité de monstre, lue dans son texte", () => {
  it("rend le texte lisible (références d'état, enrichers)", () => {
    expect(plainText("<p>has the &amp;Reference[Paralyzed apply=false] condition [[/damage 2d6]]</p>")).toBe("has the Paralyzed condition …");
    expect(conditionsIn("the Paralyzed and Poisoned conditions")).toEqual(["paralyzed", "poisoned"]);
  });

  it("sauvegarde répétée à la fin de chacun de ses tours", () => {
    expect(readEndings(repeat)).toEqual({ resave: { on: "endOfTurn" }, endsOnDamage: false, resaveOnDamage: false });
    expect(readEndings("At the end of each of its turns, the target repeats the save, ending the effect on a success.").resave).toEqual({ on: "endOfTurn" });
    expect(readEndings("It repeats the Wisdom save at the start of each of its turns.").resave).toEqual({ on: "startOfTurn" });
  });

  it("premier puis second échec : compteur, l'état du second échec", () => {
    expect(readEndings(twoStep).resave).toEqual({ on: "endOfTurn", tally: { successes: 1, failures: 1, status: "petrified" } });
    const alt = readEndings(twoStepAlt);
    expect(alt.resave).toEqual({ on: "endOfTurn", tally: { successes: 1, failures: 1, status: "unconscious" } });
    expect(alt.endsOnDamage).toBe(true);
  });

  it("fin sur dégâts, et sauvegarde rejouée sur dégâts", () => {
    expect(readEndings(damageEnds).endsOnDamage).toBe(true);
    expect(readEndings("The condition ends if the target takes damage.").endsOnDamage).toBe(true);
    expect(readEndings("The target succeeds automatically after 10 minutes or if it takes damage.").endsOnDamage).toBe(true);
    // Seul l'état second tombe : pas l'effet entier.
    expect(readEndings("While Poisoned, it also has the Unconscious condition, which ends early if the target takes damage.").endsOnDamage).toBe(false);
    const r = readEndings("The target repeats the save whenever it takes damage, ending the effect on a success.");
    expect(r.resaveOnDamage).toBe(true);
  });

  it("déclarations valides du contenu, pour tout effet de l'item quand il n'a qu'une issue", () => {
    const t = monsterEndings(`<p>${twoStepAlt}</p>`, [{ id: "a".repeat(16), statuses: ["incapacitated"] }]);
    expect(t).toEqual([
      { on: "endOfTurn", via: "effect", do: [{ type: "resave", tally: { successes: 1, failures: 1, status: "unconscious" } }] },
      { on: "isDamaged", via: "effect", do: [{ type: "remove" }] }
    ]);
    expect(validateEntry({ triggers: t })).toEqual([]);
    expect(monsterEndings("Hit: 7 damage.")).toEqual([]);
  });

  it("plusieurs issues : chaque règle ne vaut que pour l'effet dont l'état est nommé dans son segment", () => {
    const html = `Rays. 1: Charm Ray. ${damageEnds} 2: Stunning Ray. ${repeat} 3: Fear Ray. Failure: The target has the Frightened condition for 1 minute.`;
    const effects = [{ id: "c".repeat(16), statuses: ["charmed"] }, { id: "s".repeat(16), statuses: ["stunned"] }, { id: "f".repeat(16), statuses: ["frightened"] }];
    expect(monsterEndings(html, effects)).toEqual([
      { on: "isDamaged", via: "effect", fromEffect: "c".repeat(16), do: [{ type: "remove" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "s".repeat(16), do: [{ type: "resave" }] }
    ]);
    // « First Roar. … Second Roar. » se coupe aussi ; « First Failure: » non.
    const roars = `First Roar. Failure: The target has the Frightened condition for 1 minute. Second Roar. ${repeat}`;
    expect(monsterEndings(roars, effects)).toEqual([{ on: "endOfTurn", via: "effect", fromEffect: "s".repeat(16), do: [{ type: "resave" }] }]);
  });
});

describe("K2 : la mort que promet le texte d'une capacité de monstre", () => {
  it("mort à 0 PV, réservée à un type ou à une taille", async () => {
    const { monsterDeaths } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterDeaths("Hit: 9 damage. If this damage reduces the target to 0 Hit Points, it dies.")).toEqual({ killsAtZero: true });
    expect(monsterDeaths("Failure or Success: A Humanoid reduced to 0 Hit Points by this damage dies.")).toEqual({ killsAtZero: { types: ["humanoid"] } });
    expect(monsterDeaths("If this damage reduces a Medium or smaller creature to 0 Hit Points, the creature dies.")).toEqual({ killsAtZero: { sizeAtMost: "med" } });
    // Ni le porteur, ni une stabilisation, ni un objet.
    expect(monsterDeaths("The beast dies only if it starts its turn with 0 Hit Points.")).toEqual({});
    expect(monsterDeaths("If this damage reduces the target to 0 Hit Points, the target becomes Stable.")).toEqual({});
    expect(monsterDeaths("The tome turns to dust if reduced to 0 Hit Points.")).toEqual({});
  });

  it("paliers de PV : mort ou chute à 0 PV, dégâts au-dessus", async () => {
    const { monsterDeaths } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterDeaths("Failure: If the target has 20 Hit Points or fewer, it drops to 0 Hit Points. Otherwise, it takes 9 damage."))
      .toEqual({ hpTiers: [{ atMost: 20, damage: false, zero: true }, {}] });
    // L'effet « Mort » que la donnée pose d'office ne vaut que sous le palier.
    const dead = "d".repeat(16);
    expect(monsterDeaths("If the creature has 80 Hit Points or fewer, it dies. Otherwise, it takes 40 damage.", { effects: [{ id: dead, statuses: ["dead"] }] }))
      .toEqual({ hpTiers: [{ atMost: 80, damage: false, statuses: ["dead"] }, { effects: [] }] });
  });

  it("un rayon numéroté : la règle ne vaut que pour son activité", async () => {
    const { monsterDeaths } = await import("../module/scripts/core/monster-text.mjs");
    const a = "a".repeat(16), b = "b".repeat(16);
    const html = "Rays. 1: Weak Ray. Failure: 9 damage. 2: Dust Ray. Failure: 20 damage. If the target is a creature and this damage reduces it to 0 Hit Points, it disintegrates into dust.";
    const r = monsterDeaths(html, { activities: [{ id: a, name: "1: Weak Ray" }, { id: b, name: "2 : Dust Ray" }] });
    expect(r).toEqual({ killsAtZero: { activities: [b] } });
    expect(validateEntry(r)).toEqual([]);
    expect(validateEntry({ hpTiers: [{ atMost: 20, damage: false, zero: true, activities: [b] }, { activities: [b] }] })).toEqual([]);
  });
});

describe("K3 : un seul des effets, tiré au dé ou au choix", () => {
  const ids = ["c", "f", "p", "i"].map(c => c.repeat(16));
  const effects = [{ id: ids[3], statuses: ["incapacitated"] }, { id: ids[0], statuses: ["charmed"] }, { id: ids[2], statuses: ["poisoned"] }, { id: ids[1], statuses: ["frightened"] }];
  it("tiré au dé, dans l'ordre du texte", async () => {
    const { monsterChoice } = await import("../module/scripts/core/monster-text.mjs");
    const r = monsterChoice("Hit: 9 damage. The target has a condition determined by rolling 1d4: on a 1, Charmed; on a 2, Frightened; on a 3, Poisoned; or on a 4, Incapacitated.", effects);
    expect(r).toEqual({ effects: "one", roll: true, order: ids });
    expect(validateEntry({ choice: r })).toEqual([]);
  });
  it("au choix de la créature", async () => {
    const { monsterChoice } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterChoice("Failure: the target has the Charmed or Frightened condition (the bard's choice).", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("Hit: 9 damage, and the target suffers one of the following effects of the captain's choice: Awe. … Poison. …", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("The fiend chooses a damage type. Failure: the target is cursed.", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("Hit: 9 damage, and the target has the monk's choice of (A) the Charmed condition or (B) the Prone condition.", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("It shape-shifts to resemble a cat (Speed 30 ft.), a crow (20 ft., Fly 60 ft.), or a snake (20 ft.), or returns to its true form.", effects)).toEqual({ effects: "one" });
    // Un seul effet, ou des rayons numérotés : rien à choisir ici.
    expect(monsterChoice("the Charmed or Frightened condition (its choice)", [effects[0]])).toBe(null);
    expect(monsterChoice("Rays (roll 1d10). 1: Weak Ray. … 2: Slow Ray. …", effects)).toBe(null);
  });
});

describe("K6 : Réactions lues dans le texte d'une capacité de monstre", () => {
  it("parade : +N CA contre l'attaque, avec ou sans effet dans la donnée", async () => {
    const { monsterReactions } = await import("../module/scripts/core/monster-text.mjs");
    const text = "Trigger: The guard is hit by a melee attack roll. Response: The guard adds 4 to its AC against that attack, possibly causing it to miss.";
    expect(monsterReactions(text, { reaction: true })).toEqual({ triggers: [{ on: "isHit", if: { "activity.isMelee": true }, do: [{ type: "use" }, { type: "penalty", formula: "4" }] }] });
    expect(monsterReactions(text, { reaction: true, acEffect: 4 })).toEqual({ triggers: [{ on: "isHit", if: { "hit.stoppableBy": 4, "activity.isMelee": true }, do: [{ type: "use" }] }] });
    expect(monsterReactions(text, { reaction: false })).toEqual({});
  });
  it("Réactions perdues, action ou action Bonus", async () => {
    const { monsterReactions } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterReactions("Failure: until the end of its next turn, the target can't take Reactions and can take either an action or a Bonus Action on its turn, not both."))
      .toEqual({ noReactions: true, actionOrBonus: true });
    expect(monsterReactions("Rays. 1: Slow Ray. The target can't take Reactions. 2: Fear Ray. …")).toEqual({});
  });
});

describe("K7 : dégâts récurrents, soins bloqués, absorption", () => {
  const p = "p".repeat(16), g = "g".repeat(16), a = "a".repeat(16);
  it("dégâts au porteur, rattachés à l'effet dont l'état est nommé", async () => {
    const { monsterRecurring } = await import("../module/scripts/core/monster-text.mjs");
    const html = `<p>Failure: The target has the Poisoned condition. While Poisoned, the target takes [[/damage average activity=${a}]] damage at the start of each of its turns.</p>`;
    const r = monsterRecurring(html, [{ id: p, statuses: ["poisoned"] }, { id: g, statuses: ["grappled"] }]);
    expect(r).toEqual({ triggers: [{ on: "startOfTurn", via: "effect", fromEffect: p, do: [{ type: "damage", to: "bearer", activity: a }] }] });
    expect(validateEntry(r)).toEqual([]);
    // Une créature avalée : la brique Avaler s'en charge.
    expect(monsterRecurring(`A swallowed creature takes [[/damage average activity=${a}]] damage at the start of each of its turns.`)).toEqual({});
  });
  it("soins bloqués et absorption", async () => {
    const { monsterRecurring } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterRecurring("While Poisoned, the target can't regain Hit Points.")).toEqual({ blocksHealing: true });
    expect(monsterRecurring("Whenever the golem is subjected to Fire damage, it regains a number of Hit Points equal to the Fire damage dealt.")).toEqual({ absorbsDamage: ["fire"] });
    expect(validateEntry({ absorbsDamage: ["fire"] })).toEqual([]);
  });
});

describe("K8 : poussées et tractions lues dans le texte", () => {
  it("échec de sauvegarde ou toucher, porte de taille", async () => {
    const { monsterPushes } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterPushes("Failure: 9 damage, and the target is pushed up to 30 feet straight away from the dragon.", { save: true }))
      .toEqual([{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 30, units: "ft" }] }]);
    expect(monsterPushes("Hit: 9 damage. If the target is a Huge or smaller creature, it is pushed up to 20 feet straight away from the demon.", { attack: true }))
      .toEqual([{ on: "hit", if: { "target.sizeAtMost": "huge" }, do: [{ type: "move", mode: "push", distance: 20, units: "ft" }] }]);
    expect(monsterPushes("Failure: the target is pulled up to 10 feet straight toward the knight.", { save: true })[0].do[0].mode).toBe("pull");
    expect(monsterPushes("Failure: the target is pushed or pulled up to 10 feet.", { save: true })).toEqual([]);
  });
});

describe("K9 : porte de type lue dans le texte", () => {
  it("« succeed automatically »", async () => {
    const { monsterTypeGate } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterTypeGate("Wisdom Saving Throw: DC 12, one creature (Constructs and Undead succeed automatically). Failure: Unconscious."))
      .toEqual({ unaffectedIf: { any: [{ "target.creatureType": "construct" }, { "target.creatureType": "undead" }] } });
    expect(monsterTypeGate("If the target is a creature that isn't a Construct or an Undead, the beast gains temporary hit points.")).toBe(null);
  });
});

describe("K10 : Avantage conditionnel lu dans le texte", () => {
  it("cible blessée, porteur En sang, cible Effrayée", async () => {
    const { monsterAdvantage } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterAdvantage("The shark has Advantage on attack rolls against any creature that doesn't have all its Hit Points."))
      .toEqual([{ on: "preAttackRoll", if: { "target.wounded": true }, do: [{ type: "advantage" }] }]);
    expect(monsterAdvantage("While Bloodied, the boar has Advantage on attack rolls.")[0].if).toEqual({ "source.hasStatus": "bloodied" });
    expect(monsterAdvantage("The knight has Advantage on attack rolls against targets that have the Frightened condition.")[0].if).toEqual({ "target.hasStatus": "frightened" });
    expect(monsterAdvantage("The wolf has Advantage on Wisdom (Perception) checks.")).toEqual([]);
  });
});
