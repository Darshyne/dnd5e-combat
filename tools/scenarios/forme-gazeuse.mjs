/**
 * §269 : Forme gazeuse — « la cible ne peut ni attaquer ni lancer de sorts ». Le Magicien se la lance : Trait de feu devient un souci de
 * légalité ; avant, il n'y en avait pas.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Forme gazeuse — ni attaque ni sort",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    ctx.restore(() => ctx.removeEffectsFrom(mage, "gaseous-form"));
    ctx.restore(async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => (e.statuses ?? []).includes("concentrating")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    const bolt = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplFireBolt00");
    const gas = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplGaseousFor", { system: { method: "atwill" } });
    const lines = async () => (await ctx.engine("issues", { tokenId: mage.id, itemId: bolt, activityType: "attack" })) ?? [];
    const before = await lines();
    ctx.expect(!before.some(l => /gazeuse|Gaseous/i.test(l)), `avant : Trait de feu sans ce souci (${before.join(" | ") || "aucun"})`);
    await ctx.use({ tokenId: mage.id, itemId: gas, targetTokenIds: [mage.id] });
    await pause(2000);
    if ( !ctx.expect((await ctx.effectsFrom(mage, "gaseous-form")).length > 0, "le Magicien est en Forme gazeuse") ) return;
    const after = await lines();
    ctx.expect(after.some(l => /gazeuse|Gaseous/i.test(l)), `Trait de feu : « ${after.join(" | ")} »`);
  }
};
