import { describe, it, expect } from "vitest";
import { freshBudget, checkUse, spendUse } from "../module/scripts/core/turn.mjs";
import { attackModifiers } from "../module/scripts/core/conditions.mjs";
import { rangedFeatsFor } from "../module/scripts/core/feats.mjs";

const crossbow = { cost: "action", weaponAttack: true, loading: true };
const sword = { cost: "action", weaponAttack: true };
const ctx = { isOwnTurn: true, attacksPerAction: 2 };

describe("O5a (§339) : propriété Chargement", () => {
  it("une arme à Chargement ne tire qu'une fois par action Attaquer, même avec Attaque supplémentaire", () => {
    let b = freshBudget();
    expect(checkUse(b, crossbow, ctx)).toEqual([]);
    b = spendUse(b, crossbow, ctx);
    expect(b.loadedFired).toBe(true);
    expect(checkUse(b, crossbow, ctx)).toContain("loading");
    // La seconde attaque avec une autre arme reste permise.
    expect(checkUse(b, sword, ctx)).toEqual([]);
  });

  it("une épée puis l'arbalète : un seul tir, permis", () => {
    let b = spendUse(freshBudget(), sword, ctx);
    expect(b.loadedFired).toBe(false);
    expect(checkUse(b, crossbow, ctx)).toEqual([]);
    b = spendUse(b, crossbow, ctx);
    expect(b.attacks.used).toBe(2);
  });

  it("sans Chargement (Expert des arbalètes), deux tirs", () => {
    const free = { ...crossbow, loading: false };
    const b = spendUse(freshBudget(), free, ctx);
    expect(checkUse(b, free, ctx)).toEqual([]);
  });

  it("l'Expert des arbalètes lève le Chargement des arbalètes seulement", () => {
    const rules = [{ kind: "crossbow", loading: true }];
    expect(rangedFeatsFor(rules, { weapon: true, ranged: true, crossbow: true, spell: false }).loading).toBe(true);
    expect(rangedFeatsFor(rules, { weapon: true, ranged: true, crossbow: false, spell: false }).loading).toBe(false);
  });
});

describe("O5a (§339) : propriété Lourde", () => {
  it("Désavantage quand la valeur est sous 13", () => {
    const base = { attacker: [], target: [], adjacent: true, ranged: false };
    expect(attackModifiers({ ...base, heavyTooWeak: true }).disadvantage.map(r => r.key)).toContain("heavyWeapon");
    expect(attackModifiers({ ...base, heavyTooWeak: false }).disadvantage).toEqual([]);
  });
});

describe("O5b (§340) : l'objet qui enchante une arme", () => {
  it("est reconnu par l'id de l'effet d'enchantement, et pas s'il est désactivé ou d'un autre type", async () => {
    const { enchantmentSourcesOf } = await import("../module/scripts/adapter/content.mjs");
    const ench = (id, extra={}) => ({ id, type: "enchantment", disabled: false, ...extra });
    expect(enchantmentSourcesOf({ effects: [ench("ZveR6kPKafjcwQdY")] })).toEqual(["dragon-slayer"]);
    expect(enchantmentSourcesOf({ effects: [ench("ZveR6kPKafjcwQdY", { disabled: true })] })).toEqual([]);
    expect(enchantmentSourcesOf({ effects: [{ id: "ZveR6kPKafjcwQdY", type: "base", disabled: false }] })).toEqual([]);
    expect(enchantmentSourcesOf({ effects: {} })).toEqual([]);
  });

  it("chaque règle « -enchanted » a son objet dans la table des enchantements", async () => {
    const { CONTENT } = await import("../module/scripts/content/index.mjs");
    const { ENCHANTMENT_SOURCES } = await import("../module/scripts/content/sources.mjs");
    const sources = new Set(Object.values(ENCHANTMENT_SOURCES));
    for ( const key of Object.keys(CONTENT).filter(k => k.endsWith("-enchanted")) ) expect(sources.has(key.replace(/-enchanted$/, "")), key).toBe(true);
  });
});

describe("O7 (§343) : condition « ni armure ni bouclier »", () => {
  it("tient sans armure ni bouclier, tombe avec l'un ou l'autre", async () => {
    const { effectHolds } = await import("../module/scripts/core/feats.mjs");
    expect(effectHolds({ unarmored: true }, { armor: null, shield: false })).toBe(true);
    expect(effectHolds({ unarmored: true }, { armor: "light", shield: false })).toBe(false);
    expect(effectHolds({ unarmored: true }, { armor: null, shield: true })).toBe(false);
  });
});
