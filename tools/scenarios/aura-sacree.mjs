/**
 * §86 — Aura sacrée (Manuel des joueurs, prêtée sans emplacement au Clerc, qui la lance et en profite lui-même).
 *  - l'aura est posée sur le Clerc : avantage à ses jets de sauvegarde ;
 *  - le Zombi (Mort-vivant) au contact attaque le Clerc avec le Désavantage ;
 *  - quand il le touche au corps à corps, il fait la sauvegarde de Constitution de « Fiend/Undead Save » ; ratée, il est Aveuglé.
 * Les jets sont aléatoires : on rejoue jusqu'à toucher (et, pour l'Aveuglé, jusqu'à une sauvegarde ratée).
 */
const SPELL = "Compendium.dnd-players-handbook.spells.Item.phbsplHolyAura00";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Aura sacrée — aura, Désavantage des attaquants, un Mort-vivant qui touche au corps à corps est Aveuglé s'il rate",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Zombi absent : non applicable"); return; }
    const clerc = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const [c0, z0] = [await ctx.position(clerc), await ctx.position(zombi)];
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: z0.x, y: z0.y, elevation: 0 }));
    const hp = await ctx.hp(clerc);
    ctx.restore(() => ctx.setHp(clerc, hp));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Blind|Aveugl/i));
    ctx.restore(() => ctx.removeEffectsNamed(clerc, /Concentr|Holy|sacrée/i));
    await ctx.call("move-token", { tokenId: zombi.id, x: c0.x - grid, y: c0.y, elevation: 0 });   // au contact, à gauche
    await sleep(800);
    const itemId = await ctx.ensureItem(clerc, SPELL, { system: { method: "atwill" } });

    const used = await ctx.use({ tokenId: clerc.id, itemId, activityType: "utility" });
    ctx.expect(used.used, "Aura sacrée lancée");
    await sleep(3000);
    const aura = (await ctx.effects(clerc)).find(e => /Holy|sacrée/i.test(e.name ?? "") && (e.system?.changes ?? e.changes ?? []).some(c => /save\.roll\.mode/.test(c.key)));   // V14 : `system.changes`
    ctx.expect(!!aura, `l'aura est sur le Clerc, avec l'avantage aux sauvegardes (${(await ctx.effects(clerc)).map(e => e.name).join(", ")})`);

    const slam = await ctx.itemId(zombi.id, "slam");
    const reasons = await ctx.engine("attackReasons", { attackerId: zombi.id, targetId: clerc.id, itemId: slam });
    ctx.expect((reasons?.disadvantage ?? []).some(r => /holy-aura|Aura sacrée|content/i.test(r)), `le Zombi attaque avec le Désavantage (${JSON.stringify(reasons?.disadvantage)})`);

    let checked = false, failedSeen = false;
    for ( let i = 0; (i < 30) && !(checked && failedSeen); i++ ) {
      await ctx.setHp(clerc, hp);
      await ctx.removeEffectsNamed(zombi, /Blind|Aveugl/i);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: zombi.id, itemId: slam, activityType: "attack", targetTokenIds: [clerc.id] });
      const r = await ctx.settle(u.usageMessageId).catch(() => null);
      if ( !r?.targets?.[0]?.hit ) continue;
      let asked = null;
      for ( const stop = Date.now() + 10000; !asked && (Date.now() < stop); await sleep(700) ) {
        asked = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.event === "retaliation"));
      }
      if ( !ctx.expect(!!asked, "le Zombi touche le Clerc : la sauvegarde de l'Aura sacrée lui est imposée") ) return;
      const s = await ctx.settle(asked.id).catch(() => null);
      const t = s?.targets?.find(x => x.name === "Zombi");
      await sleep(1200);
      const blinded = (await ctx.effects(zombi)).some(e => !e.disabled && (e.statuses ?? []).includes("blinded"));
      if ( !checked ) ctx.expect(s?.plan?.save?.ability === "con" && !!t?.save, `sauvegarde de Constitution du Zombi : ${t?.save?.total} contre DD ${s?.plan?.save?.dc}`);
      ctx.expect(blinded === (t?.save?.success === false), `Aveuglé ${blinded ? "posé" : "absent"}, cohérent avec la sauvegarde (${t?.save?.success ? "réussie" : "ratée"})`);
      checked = true;
      if ( t?.save?.success === false ) failedSeen = true;
    }
    ctx.expect(checked, "le Zombi a touché le Clerc (30 essais au plus)");
    if ( checked && !failedSeen ) ctx.log("aucune sauvegarde ratée vue (l'Aveuglé n'a pas été observé)");
  }
};
