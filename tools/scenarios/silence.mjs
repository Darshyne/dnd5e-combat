/**
 * Silence (SPEC §37.4), monde `dnd-6`. Le Clerc reçoit Silence (Manuel des joueurs, à volonté) et pose la Sphère (6 m) sur le Zombi,
 * lui-même hors de la zone. Vérifie :
 *  - le Zombi, déjà dedans à la pose, porte l'effet (Assourdi, `silenced`) ;
 *  - il sort de la zone : l'effet part (comportement `applyActiveEffect` du cœur) ; il y revient : l'effet revient ;
 *  - la concentration du Clerc retirée : la zone disparaît, l'effet aussi.
 * Remet positions, effets, zone et concentration.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "silence — effet porté dans la zone, entrée, sortie, fin",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const silenceId = await ctx.ensureItem(cleric, PHB + "phbsplSilence000", { system: { method: "atwill" } });
    const home = await ctx.position(zombi);
    const effects0 = new Map();
    for ( const t of [cleric, zombi] ) effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const added = async t => (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id));
    const silenced = async () => (await added(zombi)).filter(e => (e.statuses ?? []).includes("silenced"));
    let regionId = null;
    const reset = async () => {
      if ( regionId ) await ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {});
      for ( const t of [cleric, zombi] ) {
        const target = await targetOf(t);
        for ( const e of await added(t) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      await pause(600);
    };
    ctx.restore(reset);

    const used = await ctx.use({ tokenId: cleric.id, itemId: silenceId, activityType: "utility", consume: false,
      area: { shape: "circle", x: home.x + grid / 2, y: home.y + grid / 2, radius: 4 * grid } });
    regionId = used.regionId ?? null;
    if ( !ctx.expect(!!regionId, "la Sphère est posée sur le Zombi") ) return;
    await pause(2500);
    const atCast = await silenced();
    ctx.expect(atCast.length === 1 && (atCast[0].statuses ?? []).includes("deafened"),
      `déjà dedans à la pose : l'effet est porté (${atCast.map(e => `${e.name} [${(e.statuses ?? []).join(", ")}]`).join(" ; ")})`);
    const region = (await ctx.call("get-scene-object", { type: "Region", objectId: regionId })).data;
    ctx.expect((region.behaviors ?? []).some(b => b.type === "applyActiveEffect"), "la région porte le comportement « appliquer un effet » du cœur");

    // Sortie, puis retour.
    await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y - 6 * grid, elevation: home.elevation });
    await pause(2500);
    const out = await silenced();
    ctx.expect(!out.length, `sorti de la zone : l'effet part (${out.length})`);
    await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation });
    await pause(2500);
    const back = await silenced();
    ctx.expect(back.length === 1, `revenu dans la zone : l'effet revient (${back.length})`);

    // Fin de la concentration : la zone disparaît, l'effet aussi.
    const target = await targetOf(cleric);
    for ( const e of (await added(cleric)).filter(e => (e.statuses ?? []).includes("concentrating")) ) {
      await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id });
    }
    await pause(3000);
    const gone = !(await ctx.call("get-scene-object", { type: "Region", objectId: regionId }).catch(() => null))?.data;
    if ( gone ) regionId = null;
    const after = await silenced();
    ctx.expect(gone && !after.length, `concentration retirée : zone disparue (${gone}), effet retiré (${after.length})`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
