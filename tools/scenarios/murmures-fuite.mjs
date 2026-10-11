/**
 * Murmures dissonants, la fuite (SPEC §147, §152) : en combat, le Barde vise le Zombi à une case de lui (hors d'allonge : pas
 * d'attaque d'opportunité) ; sauvegarde de Sagesse rejouée jusqu'à l'échec. La cible dépense sa Réaction et s'éloigne de toute sa
 * Vitesse (Zombi : 20 ft, quatre cases) par `walkToGap`, avec le plafond que lui donne la Réaction (`maxCost`, §152 : il était ignoré).
 * Coin libre de l'arène (x = 2100), loin de la distribution. Remet positions, PV, effets et combat.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "murmures-fuite — Murmures dissonants : la fuite par la Réaction",

  async run(ctx) {
    const bard = await ctx.token("Barde").catch(() => null);
    const zombi = await ctx.token("Zombi").catch(() => null);
    if ( !bard || !zombi ) { ctx.log("Barde ou Zombi absent : non applicable"); return; }
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [bard, zombi] ) homes.set(t.id, { ...(await ctx.position(t)), hp: await ctx.hp(t) });
    const effects0 = new Set((await ctx.effects(zombi)).map(e => e._id ?? e.id));
    ctx.restore(async () => {
      for ( const t of [bard, zombi] ) {
        const h = homes.get(t.id);
        const now = await ctx.position(t);
        if ( (now.x !== h.x) || (now.y !== h.y) ) await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp).catch(() => {});
      }
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${zombi.id}.Actor.${data.actorId}` };
      for ( const e of (await ctx.effects(zombi)).filter(e => !effects0.has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    const spot = { bard: { x: 2100, y: 4200, elevation: 0 }, zombi: { x: 2100, y: 4200 - (2 * grid), elevation: 0 } };
    const gap = async () => {
      const a = await ctx.position(bard);
      const b = await ctx.position(zombi);
      return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / grid - 1;   // tokens d'une case
    };
    await ctx.call("move-token", { tokenId: bard.id, ...spot.bard });
    await ctx.call("move-token", { tokenId: zombi.id, ...spot.zombi });
    await pause(1000);

    // Un combat, au tour du Barde : la Réaction du Zombi se lit dans son budget.
    await ctx.startCombat([bard, zombi]);
    const c = await ctx.combat();
    for ( const [t, value] of [[bard, 20], [zombi, 10]] ) {
      const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
      if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
    }
    if ( ((await ctx.combat()).combatants ?? []).find(x => x.isCurrent || x.current)?.name !== bard.name ) await ctx.nextTurn();
    await pause(1000);

    const from = await gap();
    ctx.expect(from === 1, `départ : le Zombi à une case du Barde (écart ${from})`);
    let fled = false;
    for ( let n = 1; (n <= 20) && !fled; n++ ) {
      await ctx.setHp(zombi, homes.get(zombi.id).hp);
      const u = await ctx.use({ tokenId: bard.id, identifier: "dissonant-whispers", activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const t = r?.targets?.find(x => x.name === zombi.name);
      if ( !t?.save || t.save.success ) continue;   // réussie : ni Réaction ni fuite, on relance
      // La fuite suit la résolution close (MJ actif) : on attend que le Zombi ait fini de marcher.
      let last = null;
      for ( let w = 0; w < 30; w++ ) {
        await pause(500);
        const now = await ctx.position(zombi);
        if ( last && (now.x === last.x) && (now.y === last.y) && (w > 4) ) break;
        last = now;
      }
      const to = await gap();
      const budget = await ctx.engine("budget", { tokenId: zombi.id });
      ctx.expect(to === from + 4, `sauvegarde ratée (${t.save.total}) : le Zombi s'éloigne de toute sa Vitesse, ${from} → ${to} cases`);
      ctx.expect(budget?.reaction === 0, `sa Réaction est dépensée (${budget?.reaction})`);
      fled = true;
    }
    ctx.expect(fled, "une sauvegarde ratée du Zombi (20 essais au plus)");
  }
};
