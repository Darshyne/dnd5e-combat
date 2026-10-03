/**
 * Bourrasque (SPEC §37.3), monde `dnd-6`. Le Clerc reçoit Bourrasque (Manuel des joueurs, à volonté) et souffle vers le sud, sur la
 * colonne libre de Restored Keep : Clerc 3080 × 4900, Zombi 3080 × 5040 ; la Ligne est approchée par un rectangle d'une case de large
 * qui couvre le Zombi et la case derrière lui. Vérifie :
 *  - pose : sauvegarde de Force du Zombi ; ratée → repoussé de 4,50 m (3 cases) loin du Clerc, le long de la colonne ;
 *  - zone qui dure : au combat, le Zombi remis dans la Ligne finit son tour dedans → le sort rejoue ; ratée ⇔ repoussé.
 * Remet positions, effets, zone et concentration.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "bourrasque — poussée à la pose, rejeu en fin de tour",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const gustId = await ctx.ensureItem(cleric, PHB + "phbsplGustofWind", { system: { method: "atwill" } });
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of [cleric, zombi] ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const regions = [];
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };
    const X = 3080, CLERIC_Y = 4900, ZOMBI_Y = 5040;
    const put = async (t, y) => { await ctx.call("move-token", { tokenId: t.id, x: X, y, elevation: 0 }); await pause(700); };
    const clearZone = async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await clearNew(cleric);   // la concentration du Clerc (elle tient la zone)
      await clearNew(zombi);
    };
    const reset = async () => {
      await endCombat();
      await clearZone();
      for ( const t of [cleric, zombi] ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(700);
    };
    ctx.restore(reset);

    /** Souffle la Bourrasque sur le Zombi posé en ZOMBI_Y ; rend la résolution et le déplacement du Zombi (px). */
    const blow = async () => {
      await clearZone();
      await put(cleric, CLERIC_Y); await put(zombi, ZOMBI_Y);
      const used = await ctx.use({ tokenId: cleric.id, itemId: gustId, activityType: "save", consume: false,
        area: { shape: "rectangle", x: X, y: ZOMBI_Y, width: grid, height: 2 * grid } });
      if ( used.regionId ) regions.push(used.regionId);
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const pos = await ctx.position(zombi);
      return { used, r, t: r?.targets?.find(x => x.name === "Zombi") ?? null, moved: { dx: pos.x - X, dy: pos.y - ZOMBI_Y } };
    };

    // 1. Pose : jusqu'à une sauvegarde ratée (20 essais au plus).
    let failedCast = null;
    for ( let n = 1; (n <= 20) && !failedCast; n++ ) {
      const cast = await blow();
      if ( !cast.t?.save ) { ctx.expect(false, `sauvegarde de Force du Zombi à la pose (${JSON.stringify(cast.r?.step)})`); break; }
      if ( cast.t.save.success === false ) failedCast = cast;
      else ctx.expect(cast.moved.dx === 0 && cast.moved.dy === 0, `réussie (${cast.t.save.total}) : le Zombi ne bouge pas (${cast.moved.dx}, ${cast.moved.dy})`);
    }
    if ( ctx.expect(!!failedCast, "une sauvegarde ratée à la pose (20 essais au plus)") ) {
      ctx.expect(failedCast.moved.dx === 0 && failedCast.moved.dy === 3 * grid,
        `ratée (${failedCast.t.save.total}) : repoussé de 3 cases loin du Clerc (${failedCast.moved.dx}, ${failedCast.moved.dy} px)`);
    }

    // 2. Zone qui dure : le Zombi remis dans la Ligne finit son tour dedans.
    if ( failedCast?.used?.regionId ) {
      await put(zombi, ZOMBI_Y);
      await ctx.startCombat([cleric, zombi]);
      const c = await ctx.combat();
      for ( const [t, value] of [[cleric, 20], [zombi, 10]] ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      let replayed = null;
      for ( let i = 0; (i < 6) && !replayed; i++ ) {
        const since = await ctx.lastMessageId();
        await ctx.nextTurn();
        await pause(2500);
        replayed = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.areaTick);
        if ( !replayed ) await put(zombi, ZOMBI_Y);   // repoussé par un rejeu manqué ou déplacé : remis dans la Ligne
      }
      if ( ctx.expect(!!replayed, "fin du tour du Zombi dans la Ligne : le sort rejoue (areaTick)") ) {
        const r = await ctx.settle(replayed.id, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        const t = r?.targets?.find(x => x.name === "Zombi");
        const pos = await ctx.position(zombi);
        const pushed = (pos.y - ZOMBI_Y) === 3 * grid;
        ctx.expect(!!t?.save && (pushed === (t.save.success === false)),
          `rejeu : sauvegarde ${t?.save?.total} ${t?.save?.success ? "réussie" : "ratée"}, repoussé ${pushed} (${pos.y - ZOMBI_Y} px)`);
      }
    }
    await pause(600);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
