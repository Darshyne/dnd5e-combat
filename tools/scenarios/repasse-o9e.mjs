/**
 * §358, lot O9e de la repasse des objets : défenses et réactions d'objets. Arène de test (Guerrier, Zombi, Ensorceleur).
 *  1. Bouclier gardesort tenu et harmonisé : le Trait de feu de l'Ensorceleur contre le Guerrier a le Désavantage ; rangé : non.
 * Bottes de rapidité et Épée de réponse : laissées au MJ pour l'instant (§358).
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9e — Bouclier gardesort : Désavantage aux attaques de sort",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi", "Ensorceleur"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Zombi ou Ensorceleur absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + g, at.y] } });
    const sorc = await ctx.token("Ensorceleur");
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = ftok.actorId;
    const hpF = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hpF));
    const set = (itemId, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: itemId } });

    // 1. Bouclier gardesort.
    const shield = await ctx.ensureItem(fighter, `${DMG}dmgSpellguardShi`);
    const bolt = await ctx.itemId(sorc.id, "fire-bolt");
    const reasons = () => ctx.engine("attackReasons", { attackerId: sorc.id, targetId: fighter.id, itemId: bolt });
    await set(shield, { system: { equipped: true, attuned: true } });
    await pause(400);
    let r = await reasons();
    ctx.expect((r?.disadvantage ?? []).some(n => /Spellguard|gardesort/i.test(n)), `Bouclier tenu : Trait de feu avec le Désavantage (${(r?.disadvantage ?? []).join(", ") || "aucun"})`);
    await set(shield, { system: { equipped: false, attuned: false } });
    await pause(400);
    r = await reasons();
    ctx.expect(!(r?.disadvantage ?? []).some(n => /Spellguard|gardesort/i.test(n)), `Bouclier rangé : pas de Désavantage (${(r?.disadvantage ?? []).join(", ") || "aucun"})`);

  }
};
