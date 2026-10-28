/**
 * §267 : Lenteur — « elle ne peut faire qu'une attaque si elle prend l'action Attaquer ». Le Paladin (niveau 8, Attaque
 * supplémentaire) attaque le Zombi : l'action Attaquer ouvre deux attaques ; ralenti par le Magicien, une seule.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Lenteur — une seule attaque par action Attaquer",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Paladin");   // niveau 8 : Attaque supplémentaire
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    for ( const t of [guerrier, zombi] ) {
      const p = await ctx.position(t); const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const concentrations = async () => (await ctx.effects(mage)).filter(e => (e.statuses ?? []).includes("concentrating"));
    const drop = async () => { for ( const e of await concentrations() ) await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {}); };
    ctx.restore(drop);
    ctx.restore(() => ctx.removeEffectsFrom(guerrier, "slow"));
    await ctx.setHp(zombi, 200);
    const g = await ctx.position(guerrier);
    await ctx.call("move-token", { tokenId: zombi.id, x: g.x + grid, y: g.y, elevation: 0 });
    await pause(800);
    const weapon = ((await ctx.call("get-actor", { actorId: guerrier.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && i.system?.equipped && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack") && !i.flags?.[MODULE_ID]?.basicAction);
    if ( !ctx.expect(!!weapon, `une arme équipée (${weapon?.name ?? "aucune"})`) ) return;

    const granted = async () => {
      await ctx.startCombat([guerrier, zombi, mage]);
      const s = await ctx.combat(); const combat = s.combat ?? s.combats?.[0] ?? s;
      for ( const [t, v] of [[guerrier, 20], [zombi, 10], [mage, 5]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; i < 3; i++ ) {
        const c = (await ctx.combat()); const cc = c.combat ?? c.combats?.[0] ?? c;
        if ( cc.combatants?.find(x => x.id === cc.currentCombatantId)?.tokenId === guerrier.id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500);
      }
      await ctx.use({ tokenId: guerrier.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [zombi.id] });
      await pause(3000);
      const b = await ctx.engine("budget", { tokenId: guerrier.id });
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null;
      await pause(1000);
      return b?.attacks?.granted ?? null;
    };

    const before = await granted();
    ctx.expect(before >= 2, `sans Lenteur : l'action Attaquer ouvre ${before} attaques`);

    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplSlow000000", { system: { method: "atwill" } });
    let slowed = false;
    for ( let i = 0; (i < 20) && !slowed; i++ ) {
      await drop(); await pause(500);
      const b = await ctx.box(guerrier);
      const used = await ctx.use({ tokenId: mage.id, identifier: "slow", activityType: "save", targetTokenIds: [guerrier.id],
        area: { shape: "rectangle", x: b.x, y: b.y, width: grid, height: grid } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1500);
      slowed = (await ctx.effectsFrom(guerrier, "slow")).length > 0;
    }
    if ( !ctx.expect(slowed, "le Paladin est ralenti (20 essais au plus)") ) return;
    const after = await granted();
    ctx.expect(after === 1, `ralenti : une seule attaque (${after})`);
  }
};
