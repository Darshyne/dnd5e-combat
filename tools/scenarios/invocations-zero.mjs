/**
 * §259 : « la monture disparaît si elle tombe à 0 point de vie » (Appel de destrier), comme les créatures des sorts d'invocation du
 * PHB 2024. Le Paladin invoque sa monture, puis elle est mise à 0 PV : son token disparaît.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "invocations — une monture d'Appel de destrier disparaît à 0 PV",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Paladin") ) { ctx.log("Paladin requis : non applicable"); return; }
    const paladin = await ctx.token("Paladin");
    const steed = await ctx.itemId(paladin.id, "find-steed").catch(() => null);
    if ( !steed ) { ctx.log("Paladin sans Appel de destrier : non applicable"); return; }
    const summoned = [];
    ctx.restore(async () => {
      const live = (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of summoned ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
    });
    const present = async id => (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.some(t => t.id === id);
    const grid = await ctx.gridSize();
    const pos = await ctx.position(paladin);

    const s = await ctx.engine("summonAt", { tokenId: paladin.id, itemId: steed, x: pos.x + (2 * grid), y: pos.y });
    const st = s.tokens?.[0];
    if ( !ctx.expect(!!st, "la monture est invoquée") ) return;
    summoned.push(st.id);
    await pause(1500);
    ctx.expect(await present(st.id), "elle est sur la scène");
    const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: st.id });
    // Une monture liée est un acteur du monde, réutilisé par la prochaine invocation : ses PV sont remis.
    const before = data.actorLink ? (await ctx.call("get-actor", { actorId: data.actorId })).system?.attributes?.hp?.value : null;
    if ( before ) ctx.restore(() => ctx.call("update-actor", { actorId: data.actorId, actorData: { "system.attributes.hp.value": before } }).catch(() => {}));
    await ctx.setHp({ id: st.id, actorId: data.actorId, name: "monture" }, 0);
    await pause(2500);
    ctx.expect(!(await present(st.id)), "à 0 PV, elle a disparu");
  }
};
