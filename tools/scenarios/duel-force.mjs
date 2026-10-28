/**
 * §270 : Duel forcé — « le sort prend fin si vous effectuez un jet d'attaque contre une créature autre que la cible […] si un de vos
 * alliés inflige des dégâts à la cible ». Le Paladin défie le Zombi ; il attaque le Bandit : le duel tombe. Défié de nouveau, le Guerrier
 * (allié du Paladin) blesse le Zombi : le duel tombe.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Duel forcé — fin quand le lanceur attaque un autre, ou qu'un allié blesse la cible",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Paladin", "Guerrier", "Zombi", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Paladin, Guerrier, Zombi, Bandit requis : non applicable"); return; }
    const [pal, guerrier, zombi, bandit] = await Promise.all(["Paladin", "Guerrier", "Zombi", "Bandit"].map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    for ( const t of [guerrier, zombi, bandit] ) {
      const p = await ctx.position(t); const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const concentrations = async () => (await ctx.effects(pal)).filter(e => (e.statuses ?? []).includes("concentrating"));
    const drop = async () => { for ( const e of await concentrations() ) await ctx.call("remove-embedded-effect", { uuid: `Actor.${pal.actorId}`, effectId: e._id ?? e.id }).catch(() => {}); };
    ctx.restore(drop);
    ctx.restore(() => ctx.removeEffectsFrom(zombi, "compelled-duel"));
    await ctx.setHp(zombi, 200); await ctx.setHp(bandit, 200);
    const p = await ctx.position(pal);
    await ctx.call("move-token", { tokenId: zombi.id, x: p.x + grid, y: p.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: p.x, y: p.y + grid, elevation: 0 });
    await ctx.call("move-token", { tokenId: guerrier.id, x: p.x + 2 * grid, y: p.y, elevation: 0 });
    await pause(1000);
    await ctx.ensureItem(pal, "Compendium.dnd-players-handbook.spells.Item.phbsplCompelledD", { system: { method: "atwill" } });
    const sword = await ctx.itemId(pal.id, "longsword");
    const gweapon = ((await ctx.call("get-actor", { actorId: guerrier.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && i.system?.equipped && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack") && !i.flags?.[MODULE_ID]?.basicAction);

    const duel = async () => {
      for ( let i = 0; i < 20; i++ ) {
        await drop(); await ctx.removeEffectsFrom(zombi, "compelled-duel"); await pause(500);
        const used = await ctx.use({ tokenId: pal.id, identifier: "compelled-duel", activityType: "save", targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Zombi")?.save?.success === false ) { await pause(1500); return (await ctx.effectsFrom(zombi, "compelled-duel")).length > 0; }
      }
      return false;
    };
    const held = async () => (await ctx.effectsFrom(zombi, "compelled-duel")).length > 0 && (await concentrations()).length > 0;

    if ( !ctx.expect(await duel(), "le Zombi est défié (20 essais au plus)") ) return;
    const z = await ctx.use({ tokenId: pal.id, itemId: sword, activityType: "attack", targetTokenIds: [zombi.id] });
    await ctx.settle(z.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    ctx.expect(await held(), "le Paladin attaque le Zombi, sa cible : le duel tient");
    const a =await ctx.use({ tokenId: pal.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
    await ctx.settle(a.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    ctx.expect(!(await held()), "le Paladin attaque le Bandit : le duel prend fin");

    if ( !ctx.expect(await duel(), "le Zombi est défié de nouveau") ) return;
    if ( !ctx.expect(!!gweapon, `le Guerrier a une arme (${gweapon?.name ?? "aucune"})`) ) return;
    let hurt = false;
    for ( let i = 0; (i < 10) && !hurt; i++ ) {
      const before = await ctx.hp(zombi);
      const g = await ctx.use({ tokenId: guerrier.id, itemId: gweapon._id, activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(g.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(2000);
      hurt = (await ctx.hp(zombi)) < before;
    }
    if ( !ctx.expect(hurt, "le Guerrier blesse le Zombi (10 essais au plus)") ) return;
    await pause(1500);
    ctx.expect(!(await held()), "un allié du Paladin a blessé la cible : le duel prend fin");
  }
};
