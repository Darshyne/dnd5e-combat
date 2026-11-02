/**
 * §337, lot O3 de la repasse des objets : fins d'effet, sauvegardes répétées, réveils. Arène de test (Clerc, Guerrier, Zombi).
 *  1. Baguette de paralysie sur le Zombi : Paralysé pour une minute (la donnée n'avait pas de durée) ; en combat, à la fin du tour du
 *     Zombi, la sauvegarde est rejouée (message « resave », moment endOfTurn).
 *  2. Huile de taggit sur le Guerrier : Inconscient et Empoisonné en deux effets ; blessé, il se réveille et reste Empoisonné.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o3 — Baguette de paralysie (durée, sauvegarde répétée), Huile de taggit (réveil)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(fighter);
    const clear = async () => {
      for ( const t of [zombi, fighter] ) {
        await ctx.removeEffectsFrom(t, "wand-of-paralysis", "oil-of-taggit");
        await ctx.removeEffectsNamed(t, /Paraly|Poisoned|Empoisonn|Unconscious|Inconscient/i);
        for ( const s of ["paralyzed", "poisoned", "unconscious", "prone"] ) await ctx.removeStatusEffects(t, s);
      }
    };
    ctx.restore(clear);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    const wand = await ctx.ensureItem(cleric, `${DMG}dmgWandOfParalys`);
    const oil = await ctx.ensureItem(cleric, `${DMG}dmgOilOfTaggit00`);

    /** L'activité de sauvegarde de l'objet sur la cible jusqu'à un échec ; rend la résolution ou null. */
    const until = async (itemId, target) => {
      for ( let i = 0; i < 20; i++ ) {
        await clear();
        await pause(500);
        const used = await ctx.use({ tokenId: cleric.id, itemId, activityType: "save", consume: false, targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( r?.targets?.find(t => t.name === target.name)?.save?.success === false ) { await pause(1200); return r; }
      }
      return null;
    };

    // 1. Baguette de paralysie.
    const para = await until(wand, zombi);
    if ( ctx.expect(!!para, "Baguette de paralysie : le Zombi rate sa sauvegarde (20 essais au plus)") ) {
      const effect = (await ctx.effects(zombi)).find(e => (e.statuses ?? []).includes("paralyzed"));
      ctx.expect(effect?.duration?.seconds === 60 || effect?.duration?.value === 60, `Paralysé pour une minute (${JSON.stringify(effect?.duration ?? null)})`);
      await ctx.startCombat([cleric, zombi]);
      let resave = null;
      for ( let i = 0; (i < 4) && !resave; i++ ) {
        const since = await ctx.lastMessageId();
        await ctx.nextTurn().catch(() => null);
        await pause(2500);
        resave = (await ctx.messagesSince(since)).find(m => (m.flags?.[MODULE_ID]?.resave?.moment === "endOfTurn"));
      }
      ctx.expect(!!resave, "à la fin du tour du Zombi, la sauvegarde contre la paralysie est rejouée");
      if ( resave ) await ctx.settle(resave.id).catch(() => null);
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => null); ctx.ownCombat = null; }
    }
    await clear();

    // 2. Huile de taggit.
    const sleep = await until(oil, fighter);
    if ( ctx.expect(!!sleep, "Huile de taggit : le Guerrier rate sa sauvegarde (20 essais au plus)") ) {
      const effects = await ctx.effects(fighter);
      const asleep = effects.find(e => (e.statuses ?? []).includes("unconscious"));
      const poisoned = effects.find(e => (e.statuses ?? []).includes("poisoned"));
      ctx.expect(!!asleep && !!poisoned && (asleep !== poisoned) && !(asleep.statuses ?? []).includes("poisoned"),
        `Inconscient et Empoisonné en deux effets (${effects.map(e => `${e.name}:${(e.statuses ?? []).join("+")}`).join(", ")})`);
      await ctx.engine("hurt", { tokenId: fighter.id, amount: 1 });
      await pause(2500);
      const after = await ctx.effects(fighter);
      ctx.expect(!after.some(e => (e.statuses ?? []).includes("unconscious")), "blessé, le Guerrier se réveille");
      ctx.expect(after.some(e => (e.statuses ?? []).includes("poisoned")), "et reste Empoisonné");
    }
  }
};
