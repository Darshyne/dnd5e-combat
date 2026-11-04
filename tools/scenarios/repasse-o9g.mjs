/**
 * §360, lot O9g de la repasse des objets. Arène de test (Guerrier).
 *  1. Anneau d'invisibilité (créé depuis le Guide : la correction de donnée lui ajoute son activité et son effet) porté et harmonisé :
 *     « Turn Invisible » rend le Guerrier Invisible.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9g — Anneau d'invisibilité",

  async run(ctx) {
    const fighter = await ctx.token("Guerrier").catch(() => null);
    if ( !fighter ) { ctx.log("Guerrier absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fixes = await ctx.engine("setting", { key: "dataFixes" });
    ctx.restore(() => ctx.engine("setting", { key: "dataFixes", value: fixes.before }));
    await ctx.engine("setting", { key: "dataFixes", value: true });
    ctx.restore(async () => { await ctx.removeStatusEffects(fighter, "invisible").catch(() => {}); await ctx.removeEffectsNamed(fighter, /Invisib/i).catch(() => {}); });
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const ring = await ctx.ensureItem(fighter, `${DMG}dmgRingOfInvisib`);
    await pause(1500);
    await ctx.call("upsert-actor-item", { actorId: ftok.actorId, itemData: { system: { equipped: true, attuned: true } }, match: { path: "_id", value: ring } });
    const acts = Object.keys((await ctx.engine("itemData", { tokenId: fighter.id, itemId: ring, paths: ["system.activities"] }))?.["system.activities"] ?? {});
    ctx.expect(acts.includes("dasRingInvisible"), `l'anneau a reçu son activité (${acts.join(", ") || "aucune"})`);
    const used = await ctx.use({ tokenId: fighter.id, itemId: ring, activityId: "dasRingInvisible", consume: false,
      usageConfig: { [MODULE_ID]: { confirmed: true } } }).catch(err => ({ error: err.message }));
    if ( used.usageMessageId ) await ctx.settle(used.usageMessageId).catch(() => null);
    await pause(1500);
    const st = (await ctx.engine("stats", { tokenId: fighter.id }))?.statuses ?? [];
    ctx.expect(st.includes("invisible"), `« Turn Invisible » : le Guerrier est Invisible (${st.join(", ") || "rien"} ${used.error ?? ""})`);
  }
};
