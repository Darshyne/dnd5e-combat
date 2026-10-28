/**
 * §265 : Bannissement — la cible qui rate sa sauvegarde quitte la carte (token et combattant cachés) ; le sort fini, elle revient dans
 * l'espace quitté, ou au plus proche libre s'il est pris. Le Magicien bannit le Zombi ; pendant ce temps le Guerrier prend sa case ;
 * la concentration rompue, le Zombi réapparaît à côté.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Bannissement — la cible disparaît, puis revient (au plus proche si sa case est prise)",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    for ( const t of [zombi, guerrier] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
    }
    const concentrations = async () => (await ctx.effects(mage)).filter(e => (e.statuses ?? []).includes("concentrating"));
    const drop = async () => { for ( const e of await concentrations() ) await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {}); };
    ctx.restore(drop);
    ctx.restore(() => ctx.removeEffectsFrom(zombi, "banishment"));
    const tokenData = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id })).data;
    ctx.restore(async () => {
      const d = await tokenData();
      if ( d?.flags?.[MODULE_ID]?.banished ) await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { hidden: false, [`flags.${MODULE_ID}.-=banished`]: null } });
    });
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplBanishment", { system: { method: "atwill" } });
    const home = await ctx.position(zombi);

    let banished = false;
    for ( let i = 0; (i < 20) && !banished; i++ ) {
      await drop(); await pause(500);
      const used = await ctx.use({ tokenId: mage.id, identifier: "banishment", activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      banished = r?.targets?.find(t => t.name === "Zombi")?.save?.success === false;
    }
    if ( !ctx.expect(banished, "le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
    await pause(2500);
    let d = await tokenData();
    ctx.expect(d.hidden === true && !!d.flags?.[MODULE_ID]?.banished, "banni : son token est caché");

    await ctx.call("move-token", { tokenId: guerrier.id, x: home.x, y: home.y, elevation: 0 });
    await pause(1000);
    await drop();
    await pause(3000);
    d = await tokenData();
    ctx.expect(d.hidden === false && !d.flags?.[MODULE_ID]?.banished, "le sort fini, il réapparaît");
    const moved = (d.x !== home.x) || (d.y !== home.y);
    const near = (Math.abs(d.x - home.x) <= grid) && (Math.abs(d.y - home.y) <= grid);
    ctx.expect(moved && near, `sa case prise par le Guerrier, il revient à côté (${(d.x - home.x) / grid}, ${(d.y - home.y) / grid})`);
  }
};
