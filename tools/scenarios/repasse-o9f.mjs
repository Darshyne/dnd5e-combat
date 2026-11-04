/**
 * §359, lot O9f de la repasse des objets : consommables. Arène de test (Guerrier, Zombi au contact).
 *  1. Huile éthérée appliquée sans cible désignée : c'est le Guerrier qui devient Éthéré.
 *  2. Menottes : l'effet « Manacled » posé sur le Zombi (le test « Bind » est celui de la cible, la pose reste à la carte de dnd5e) — lié,
 *     il attaque avec le Désavantage, et peut tenter de s'en libérer.
 *  3. Corde d'enchevêtrement (« Entangle » raté par le Zombi) : Entravé, il peut tenter de s'en libérer.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9f — Huile éthérée sans cible, Menottes, Corde d'enchevêtrement",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + g, at.y] } });
    const zombi = await ctx.token("Zombi");
    const clean = async () => {
      await ctx.removeStatusEffects(fighter, "ethereal").catch(() => {});
      await ctx.removeStatusEffects(zombi, "restrained").catch(() => {});
      await ctx.removeEffectsNamed(fighter, /Ether/i).catch(() => {});
      await ctx.removeEffectsNamed(zombi, /Manacled|Entangled|Menott|Entrav/i).catch(() => {});
    };
    ctx.restore(clean);
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];
    const play = async (itemId, activityId, targets) => {
      const used = await ctx.use({ tokenId: fighter.id, itemId, activityId, consume: false, targetTokenIds: targets,
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } }).catch(err => ({ error: err.message }));
      const r = used.usageMessageId ? await ctx.settle(used.usageMessageId).catch(() => null) : null;
      await pause(1500);
      return r;
    };

    // 1. Huile éthérée.
    const oil = await ctx.ensureItem(fighter, `${DMG}dmgOilOfEthereal`);
    await play(oil, "CEUD70b6Aouaqs6Z", []);
    ctx.expect((await statuses(fighter)).includes("ethereal"), `Huile éthérée sans cible : le Guerrier est Éthéré (${(await statuses(fighter)).join(", ") || "rien"})`);
    await clean();

    // 2. Menottes.
    const cuffs = await ctx.ensureItem(fighter, `${PHB}phbagManacles000`);
    await ctx.engine("placeItemEffect", { tokenId: zombi.id, casterId: fighter.id, itemId: cuffs, effectId: "hKJK8c3uwhFNdn5m" });
    await pause(800);
    const bound = (await ctx.effects(zombi)).some(e => /Manacled|Menott/i.test(e.name ?? ""));
    if ( ctx.expect(bound, "Menottes : le Zombi est lié") ) {
      const slam = await ctx.itemId(zombi.id, "slam");
      const r = await ctx.engine("attackReasons", { attackerId: zombi.id, targetId: fighter.id, itemId: slam });
      ctx.expect((r?.disadvantage ?? []).some(n => /Manacles|Menottes/i.test(n)), `le Zombi lié attaque avec le Désavantage (${(r?.disadvantage ?? []).join(", ") || "aucun"})`);
      const e = await ctx.engine("endings", { tokenId: zombi.id });
      ctx.expect((e?.own ?? []).some(x => /Manacles|Menottes/i.test(x.item) && (x.roll === "check")), `il peut tenter de s'en libérer (${JSON.stringify(e?.own ?? [])})`);
    }
    await clean();

    // 3. Corde d'enchevêtrement.
    const rope = await ctx.ensureItem(fighter, `${DMG}dmgRopeOfEntangl`);
    let caught = false;
    for ( let i = 0; (i < 12) && !caught; i++ ) {
      await play(rope, "oY5qoF7eii3fFuzY", [zombi.id]);
      caught = (await statuses(zombi)).includes("restrained");
    }
    if ( ctx.expect(caught, "Corde : le Zombi est Entravé") ) {
      const e = await ctx.engine("endings", { tokenId: zombi.id });
      ctx.expect((e?.own ?? []).some(x => /Rope|Corde/i.test(x.item) && (x.roll === "check")), `il peut tenter de s'en libérer (${JSON.stringify(e?.own ?? [])})`);
    }
  }
};
