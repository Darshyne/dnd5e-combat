/**
 * Les auras de sort du Manuel des joueurs 3.0.0 suivent leur porteur (§438, suite), monde `dnd-6`, arène.
 * L'aura est une émanation rattachée au token du lanceur (`attachment.token`) : dnd5e la pose (Manteau du croisé), ou le moteur
 * quand le Manuel coupe la pose (`target.prompt: false` : Aura de pureté, Aura de vie, Cercle de pouvoir). Foundry déplace la zone
 * avec le token, et le comportement `applyActiveEffect` de dnd5e donne puis retire l'effet.
 *
 * Pour chaque aura, le Guerrier ne bouge pas, à 10 cases du Paladin :
 *  - l'aura lancée, rien sur le Guerrier, la zone est rattachée au Paladin ;
 *  - le Paladin vient à 1,50 m du Guerrier → la zone a suivi (sa base est à la position du Paladin), l'effet est sur le Guerrier ;
 *  - le Paladin repart → l'effet quitte le Guerrier, la zone a suivi encore.
 * Ne joue que la forme 3.0.0 (activité à comportement de zone) ; sur une fiche 2.2.0, non applicable. Remet positions et effets.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "auras de sort 3.0.0 — la zone suit le porteur",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const names = ["Paladin", "Guerrier"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [pal, fighter] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [pal, fighter];
    const grid = await ctx.gridSize();
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, await ctx.position(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async (t, only=null) => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && (!only || only(e))) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    let regions = [];
    const reset = async () => {
      // La concentration d'abord : sa fin retire la zone, et dnd5e retire alors lui-même les effets de son comportement.
      for ( const t of all ) await clearNew(t, e => (e.statuses ?? []).includes("concentrating") || /^Concentrat/i.test(e.name ?? ""));
      await pause(1500);
      for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      regions = [];
      await pause(1000);
      for ( const t of all ) await clearNew(t);
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
      }
      await pause(1000);
    };
    ctx.restore(reset);
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(2500); };
    const regionOf = async id => (await ctx.call("get-scene-object", { type: "Region", objectId: id }).catch(() => null))?.data ?? null;
    /** La base de l'émanation est-elle à la position du token ? */
    const follows = (region, pos) => (region?.shapes ?? []).some(s => (s.type === "emanation")
      && (Math.abs((s.base?.x ?? NaN) - pos.x) < 1) && (Math.abs((s.base?.y ?? NaN) - pos.y) < 1));

    const auraCase = async (label, id, identifier) => {
      try {
        const itemId = await ctx.ensureItem(pal, PHB + id, { system: { method: "atwill" } });
        const item = ((await ctx.call("get-actor", { actorId: pal.actorId })).items ?? []).find(i => i._id === itemId);
        const v3 = Object.values(item?.system?.activities ?? {}).some(a => (a.behaviors ?? []).some(b => b.type === "applyActiveEffect"));
        if ( !v3 ) { ctx.log(`${label} : forme 2.2.0 (pas de comportement de zone), non applicable`); return; }
        const home = homes.get(pal.id);
        const far = { x: home.x - 10 * grid, y: home.y };
        await place(fighter, far.x, far.y);
        const used = await ctx.engine("use", { tokenId: pal.id, itemId });
        regions = (used?.regions ?? []).map(r => r.id);
        await pause(2500);
        if ( !ctx.expect(regions.length > 0, `${label} : une zone est posée (${JSON.stringify(used?.regions ?? null)})`) ) return;
        const regionId = regions[0];
        const on = async () => (await ctx.effectsFrom(fighter, identifier)).length > 0;

        let region = await regionOf(regionId);
        ctx.expect(region?.attachment?.token === pal.id, `${label} : la zone est rattachée au Paladin (${JSON.stringify(region?.attachment ?? null)})`);
        ctx.expect(follows(region, await ctx.position(pal)), `${label} : la zone est posée sur le Paladin`);
        ctx.expect(!(await on()), `${label} : rien sur le Guerrier hors de l'aura`);

        // Le porteur vient au Guerrier, qui ne bouge pas.
        await place(pal, far.x + grid, far.y);
        region = await regionOf(regionId);
        ctx.expect(follows(region, await ctx.position(pal)), `${label} : le Paladin avance → la zone l'a suivi`);
        await pause(1500);
        ctx.expect(await on(), `${label} : l'aura arrive sur le Guerrier → l'effet`);
        ctx.expect((await ctx.effectsFrom(pal, identifier)).length > 0, `${label} : le Paladin garde l'effet de sa propre aura`);

        // Le porteur repart.
        await place(pal, home.x, home.y);
        region = await regionOf(regionId);
        ctx.expect(follows(region, await ctx.position(pal)), `${label} : le Paladin repart → la zone l'a suivi`);
        await pause(1500);
        ctx.expect(!(await on()), `${label} : l'aura quitte le Guerrier → l'effet part`);
      } catch ( err ) {
        ctx.expect(false, `${label} : ${err.message}`);
      } finally {
        await reset();
      }
    };

    await auraCase("Manteau du croisé", "phbsplCrusadersM", "crusaders-mantle");
    await auraCase("Aura de pureté", "phbsplAuraofPuri", "aura-of-purity");
    await auraCase("Aura de vie", "phbsplAuraofLife", "aura-of-life");
    await auraCase("Cercle de pouvoir", "phbsplCircleofPo", "circle-of-power");
  }
};
