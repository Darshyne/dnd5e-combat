/**
 * §364–§366 : alerte MJ. Arène de test (Magicien, Zombi).
 *  1. Télékinésie (table des alertes, §365) lancée par le Magicien : une carte chuchotée aux MJ, marquée `gmAlert`, et le texte dans
 *     le bandeau du MJ.
 *  2. Bâton du thaumaturge : « Spell Absorption » alerte, une autre activité (l'attaque) non (le filtre `activities`).
 *  3. Réglage de monde « Alertes MJ » éteint : « Spell Absorption » ne poste plus aucune carte.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "alerte MJ — bandeau, carte chuchotée, filtre d'activité, réglage",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(async () => { for ( const s of ["restrained"] ) await ctx.removeStatusEffects(zombi, s).catch(() => {}); });
    const banner = await ctx.engine("setting", { key: "gmAlertBanner" }).catch(() => null);
    if ( banner ) ctx.restore(() => ctx.engine("setting", { key: "gmAlertBanner", value: banner.before }));
    await ctx.engine("setting", { key: "gmAlertBanner", value: true }).catch(() => null);
    const alertsSince = async id => (await ctx.messagesSince(id)).filter(m => m.flags?.[MODULE_ID]?.gmAlert);

    // 1. Télékinésie
    const tk = await ctx.ensureItem(mage, `${PHB}phbsplTelekinesi`, { system: { method: "atwill" } });
    const cast = await ctx.use({ tokenId: mage.id, itemId: tk, targetTokenIds: [zombi.id], consume: false });
    await pause(2500);
    const cards = await alertsSince(cast.usageMessageId);
    ctx.expect(cards.length === 1, `Télékinésie : une carte d'alerte (${cards.map(c => c.flags[MODULE_ID].gmAlert.text).join(" / ") || "aucune"})`);
    ctx.expect(cards[0]?.whisper === true || (Array.isArray(cards[0]?.whisper) && cards[0].whisper.length > 0) || !!cards[0]?.whisperTo,
      `chuchotée aux MJ (${JSON.stringify(cards[0]?.whisper ?? cards[0]?.whisperTo ?? null)})`);
    const shown = await ctx.engine("gmAlerts", {});
    ctx.expect((shown ?? []).some(t => /9 m|30 ft/.test(t)), `dans le bandeau du MJ (${(shown ?? []).join(" / ") || "rien"})`);

    // 2. Bâton du thaumaturge : le filtre d'activité
    if ( JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      const staff = await ctx.ensureItem(mage, `${DMG}dmgStaffOfTheMag`);
      const absorb = await ctx.use({ tokenId: mage.id, itemId: staff, activityId: "QcfPhLX9LBvOnShu", consume: false, targetTokenIds: [] });
      await pause(2500);
      ctx.expect((await alertsSince(absorb.usageMessageId)).length === 1, "Bâton : « Spell Absorption » alerte");
      const strike = await ctx.use({ tokenId: mage.id, itemId: staff, activityId: "RddG208UbA6B1flD", consume: false, targetTokenIds: [zombi.id] });
      await ctx.settle(strike.usageMessageId).catch(() => {});
      await pause(1500);
      ctx.expect(!(await alertsSince(strike.usageMessageId)).length, "Bâton : son attaque n'alerte pas");
    }

    // 3. Réglage éteint (Bâton : « Spell Absorption »)
    const on = await ctx.engine("setting", { key: "gmAlerts", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "gmAlerts", value: on.before }));
    const staff = await ctx.ensureItem(mage, `${DMG}dmgStaffOfTheMag`);
    const off = await ctx.use({ tokenId: mage.id, itemId: staff, activityId: "QcfPhLX9LBvOnShu", consume: false, targetTokenIds: [] });
    await pause(2500);
    const silent = await alertsSince(off.usageMessageId);
    ctx.expect(!silent.length, `alertes éteintes : aucune carte (${silent.length})`);
    await ctx.engine("setting", { key: "gmAlerts", value: on.before });
  }
};
