/**
 * §348, lot O8e de la repasse des objets : Désavantage avec les autres armes. Arène de test (Guerrier, Zombi).
 *  1. Hache du berserker posée sur une Hache d'armes, harmonisée : l'Épée longue du Guerrier attaque avec le Désavantage, la Hache
 *     sans ; non harmonisée : rien.
 *  2. Arc du serment posé sur un Arc long, harmonisé : rien sans ennemi juré ; « Swear Oath » sur le Zombi → l'Épée longue a le
 *     Désavantage, l'Arc non ;
 *     le Zombi à 0 PV → plus de Désavantage.
 */
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o8e — Hache du berserker et Arc du serment : Désavantage avec les autres armes",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = tok.actorId;
    const hpZ = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hpZ));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Sworn Enemy|Ennemi juré/i));
    const set = (itemId, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: itemId } });
    const reasons = async itemId => (await ctx.engine("attackReasons", { attackerId: fighter.id, targetId: zombi.id, itemId }))?.disadvantage ?? [];
    const sword = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);
    const enchant = async (source, activityId, base) => {
      const itemId = await ctx.ensureItem(fighter, `${DMG}${source}`);
      const target = await ctx.ensureItem(fighter, `${PHB}${base}`);
      const done = await ctx.engine("enchant", { tokenId: fighter.id, itemId, activityId, targetItemId: target }).catch(err => ({ error: err.message }));
      ctx.expect(!!done?.effectId, `${source} enchante ${base} (${done?.error ?? "ok"})`);
      return target;
    };
    const axe = await enchant("dmgBerserkerAxe0", "rWBvAvfPodSbiiLg", "phbwepBattleaxe0");
    const bow = await enchant("dmgOathbow000000", "hQyhQEtRT1J0ks2q", "phbwepLongbow000");
    await set(bow, { system: { attuned: false } });

    // 1. Hache du berserker.
    await set(axe, { system: { equipped: true, attuned: true } });
    await pause(400);
    let r = await reasons(sword);
    ctx.expect(r.some(n => /Berserker/i.test(n)), `Hache harmonisée : l'Épée longue a le Désavantage (${r.join(", ") || "aucun"})`);
    r = await reasons(axe);
    ctx.expect(!r.some(n => /Berserker/i.test(n)), `la Hache elle-même : pas de Désavantage (${r.join(", ") || "aucun"})`);
    await set(axe, { system: { equipped: false, attuned: false } });
    await pause(400);
    r = await reasons(sword);
    ctx.expect(!r.some(n => /Berserker/i.test(n)), `Hache non harmonisée : rien (${r.join(", ") || "aucun"})`);

    // 2. Arc du serment.
    await set(bow, { system: { equipped: true, attuned: true } });
    await pause(400);
    r = await reasons(sword);
    ctx.expect(!r.some(n => /Oathbow|serment/i.test(n)), `Arc sans ennemi juré : rien (${r.join(", ") || "aucun"})`);
    const oath = await ctx.use({ tokenId: fighter.id, itemId: bow, activityType: "utility", targetTokenIds: [zombi.id] });
    if ( oath.usageMessageId ) await ctx.settle(oath.usageMessageId).catch(() => null);
    await pause(1500);
    const sworn = (await ctx.effects(zombi)).filter(e => /Sworn Enemy|Ennemi juré/i.test(e.name ?? ""));
    ctx.expect(sworn.length > 0, `« Swear Oath » : le Zombi est l'ennemi juré (${sworn.map(e => e.name).join(", ") || "aucun effet"})`);
    r = await reasons(sword);
    ctx.expect(r.some(n => /Oathbow|serment/i.test(n)), `ennemi juré vivant : l'Épée longue a le Désavantage (${r.join(", ") || "aucun"})`);
    r = await reasons(bow);
    ctx.expect(!r.some(n => /Oathbow|serment/i.test(n)), `l'Arc lui-même : pas de Désavantage (${r.join(", ") || "aucun"})`);
    await ctx.setHp(zombi, 0);
    await pause(1500);
    r = await reasons(sword);
    ctx.expect(!r.some(n => /Oathbow|serment/i.test(n)), `ennemi juré à 0 PV : plus de Désavantage (${r.join(", ") || "aucun"})`);
    await ctx.setHp(zombi, hpZ);
    await set(bow, { system: { equipped: false, attuned: false } });
  }
};
