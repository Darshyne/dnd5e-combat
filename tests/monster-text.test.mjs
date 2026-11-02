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
