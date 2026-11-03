/**
 * §345, lot O8b de la repasse des objets : sauvegarde de la cible au toucher. Arène de test (Guerrier, Zombi).
 *  1. Dague venimeuse non enduite : un coup qui touche n'impose aucune sauvegarde.
 *  2. Enduite (enchantement « Poison Coat ») : le coup qui touche impose la sauvegarde de Constitution DD 15, et le poison est retiré.
 *  3. Tueuse de géants posée sur une Épée longue, le Zombi devenu Géant le temps du test : touché, sauvegarde de Force DD 15, À terre
 *     ⇔ ratée (rejoué jusqu'à un échec).
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o8b — Dague venimeuse enduite et Tueuse de géants : sauvegarde de la cible au toucher",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const clearProne = async () => {
      await ctx.removeStatusEffects(zombi, "prone");
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "prone", active: false }).catch(() => {});
    };
    ctx.restore(clearProne);

    /** Attaque jusqu'au toucher (20 essais au plus) ; rend la cible de la résolution, ou null. */
    const hit = async itemId => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(zombi, hp0);
        await clearProne();
        const used = await ctx.use({ tokenId: fighter.id, itemId, activityType: "attack", consume: false, targetTokenIds: [zombi.id],
          usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Zombi");
        if ( t?.hit === true ) { await pause(1500); return t; }
      }
      return null;
    };
    const coated = async dagger => {
      const data = await ctx.engine("itemData", { tokenId: fighter.id, itemId: dagger, paths: ["effects"] });
      return (data?.effects ?? []).filter(e => e?.flags?.dnd5e?.enchantmentProfile === "f0WvHHwmTfdkF3OP").length;
    };

    // 1. Dague non enduite.
    const dagger = await ctx.ensureItem(fighter, `${DMG}dmgDaggerOfVenom`);
    let t = await hit(dagger);
    ctx.expect(!!t && !t.save, `Dague non enduite : touché, aucune sauvegarde (${JSON.stringify(t?.save ?? null)})`);

    // 2. Enduite.
    const { effectId } = await ctx.engine("enchant", { tokenId: fighter.id, itemId: dagger, activityId: "mvBETzTSBwNrYq2T", targetItemId: dagger })
      .catch(err => ({ error: err.message }));
    ctx.expect(!!effectId && ((await coated(dagger)) > 0), "la lame est enduite (enchantement « Poison Coat »)");
    t = await hit(dagger);
    ctx.expect(!!t?.save, `Dague enduite : touché, sauvegarde imposée (${t?.save?.ability ?? "-"} ${t?.save?.total ?? "?"} contre DD ${t?.save?.dc ?? "?"})`);
    ctx.expect((await coated(dagger)) === 0, "le coup qui touche retire le poison");

    // 3. Tueuse de géants, le Zombi Géant.
    const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const type0 = data.delta?.system?.details?.type?.value ?? null;
    await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.details.type.value": "giant" } });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
      data: type0 === null ? { "delta.system.details.type.-=value": null } : { "delta.system.details.type.value": type0 } }).catch(() => {}));
    const sword = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);
    const slayer = await ctx.ensureItem(fighter, `${DMG}dmgGiantSlayer00`);
    const enchanted = await ctx.engine("enchant", { tokenId: fighter.id, itemId: slayer, activityId: "9zzccmgorGRVKuZi", targetItemId: sword })
      .catch(err => ({ error: err.message }));
    if ( !ctx.expect(!!enchanted?.effectId, "la Tueuse de géants enchante l'Épée longue") ) return;
    let prone = null;
    for ( let i = 0; (i < 8) && !prone; i++ ) {
      t = await hit(sword);
      if ( !t ) break;
      prone = (await ctx.engine("stats", { tokenId: zombi.id }))?.statuses?.includes("prone") ?? false;
    }
    ctx.expect(prone === true, `Tueuse de géants : un Géant touché qui rate sa sauvegarde de Force tombe À terre (${prone})`);
  }
};
