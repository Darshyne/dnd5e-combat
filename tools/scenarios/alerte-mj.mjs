/**
 * §364 : alerte MJ. Arène de test (Guerrier).
 *  1. Le Bouffon (Jeu des merveilles) tiré : une carte chuchotée aux MJ, marquée `gmAlert`, et le texte dans le bandeau du MJ.
 *  2. Une autre activité de l'objet n'alerte pas (le filtre `activities`).
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "alerte MJ — bandeau et carte chuchotée (Le Bouffon)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Guerrier") ) { ctx.log("Guerrier absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    ctx.restore(() => ctx.removeEffectsNamed(fighter, /Jester/i).catch(() => {}));
    const banner = await ctx.engine("setting", { key: "gmAlertBanner" }).catch(() => null);
    if ( banner ) ctx.restore(() => ctx.engine("setting", { key: "gmAlertBanner", value: banner.before }));
    await ctx.engine("setting", { key: "gmAlertBanner", value: true }).catch(() => null);
    const jester = await ctx.ensureItem(fighter, `${DMG}dmgDmtJester0000`);

    const used = await ctx.use({ tokenId: fighter.id, itemId: jester, activityId: "6WJ08JWazu3OZign", consume: false, targetTokenIds: [] });
    await pause(2500);
    const cards = (await ctx.messagesSince(used.usageMessageId)).filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    ctx.expect(cards.length === 1, `une carte d'alerte (${cards.map(c => c.flags[MODULE_ID].gmAlert.text).join(" / ") || "aucune"})`);
    ctx.expect(cards[0]?.whisper === true || (Array.isArray(cards[0]?.whisper) && cards[0].whisper.length > 0) || !!cards[0]?.whisperTo,
      `chuchotée aux MJ (${JSON.stringify(cards[0]?.whisper ?? cards[0]?.whisperTo ?? null)})`);
    const shown = await ctx.engine("gmAlerts", {});
    ctx.expect((shown ?? []).some(t => /72/.test(t)), `dans le bandeau du MJ (${(shown ?? []).join(" / ") || "rien"})`);

    const acts = (await ctx.engine("itemData", { tokenId: fighter.id, itemId: jester, paths: ["system.activities"] }))?.["system.activities"] ?? {};
    const other = Object.values(acts).find(a => a._id !== "6WJ08JWazu3OZign")?._id;
    if ( other ) {
      const again = await ctx.use({ tokenId: fighter.id, itemId: jester, activityId: other, consume: false, targetTokenIds: [] });
      await pause(2500);
      const none = (await ctx.messagesSince(again.usageMessageId)).filter(m => m.flags?.[MODULE_ID]?.gmAlert);
      ctx.expect(!none.length, "une autre activité de l'objet n'alerte pas");
    }

    // §365 : un sort de la table des alertes (Amitié, lancée par le Magicien sur le Zombi).
    if ( tokens.some(t => t.name === "Magicien") && tokens.some(t => t.name === "Zombi") ) {
      const mage = await ctx.token("Magicien");
      const zombi = await ctx.token("Zombi");
      const friends = await ctx.ensureItem(mage, `${PHB}phbsplFriends000`, { system: { method: "atwill" } });
      const cast = await ctx.use({ tokenId: mage.id, itemId: friends, targetTokenIds: [zombi.id], consume: false });
      await pause(2500);
      const spellCards = (await ctx.messagesSince(cast.usageMessageId)).filter(m => m.flags?.[MODULE_ID]?.gmAlert);
      ctx.expect(spellCards.length === 1, `Amitié : une alerte (${spellCards.map(c => c.flags[MODULE_ID].gmAlert.text).join(" / ") || "aucune"})`);
      ctx.restore(() => ctx.removeEffectsNamed(zombi, /Friends|Amitié/i).catch(() => {}));
    }

    // §365 : réglage de monde « Alertes MJ » éteint — plus aucune carte.
    const on = await ctx.engine("setting", { key: "gmAlerts", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "gmAlerts", value: on.before }));
    const off = await ctx.use({ tokenId: fighter.id, itemId: jester, activityId: "6WJ08JWazu3OZign", consume: false, targetTokenIds: [] });
    await pause(2500);
    const silent = (await ctx.messagesSince(off.usageMessageId)).filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    ctx.expect(!silent.length, `alertes éteintes : aucune carte (${silent.length})`);
    await ctx.engine("setting", { key: "gmAlerts", value: on.before });
  }
};
