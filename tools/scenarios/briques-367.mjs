/**
 * §367 : trois briques. Arène de test.
 *  1. Marche dans l'ombre (`teleport.maxLight`, Ravenloft) prêtée au Guerrier : en plein jour, refusée (souci et destination) ; dans une
 *     région d'obscurité, acceptée vers une case obscure, refusée vers une case éclairée.
 *  2. Tempête de vengeance (`noRangedWeapons: { fromPulse: 4 }`) posée par le Magicien sur le Bandit : l'arbalète légère du Bandit sans
 *     souci avant le tour 5 ; le compteur de la zone mis à 4 (le tour 5), le souci « attaques à distance avec une arme impossibles » ;
 *     son cimeterre, non.
 * (Esprit de l'ombre, `endActivity` : scénario `college-esprits`.)
 */
const RHW = "dnd-ravenloft-horrors-within.options";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "briques §367 — Marche dans l'ombre selon la lumière, Tempête de vengeance sans tir",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const need = ["Guerrier", "Magicien", "Bandit"];
    if ( !need.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const grid = await ctx.gridSize();
    const [fighter, mage, bandit] = await Promise.all(need.map(n => ctx.token(n)));
    for ( const t of [fighter, bandit] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }

    // 1. Marche dans l'ombre.
    if ( JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes(RHW) ) {
      const uuid = `Compendium.${RHW}.Item.rhwSSShadowWalqT`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: r.id }).catch(() => {}));
      await pause(800);
      const p = await ctx.position(fighter);
      const light = async () => (await ctx.engine("stealth", { tokenId: fighter.id })).light;
      const hop = async dx => ctx.engine("teleport", { tokenId: fighter.id, itemId: r.id, x: p.x + dx * grid, y: p.y });
      const issues = async () => (await ctx.engine("issues", { tokenId: fighter.id, itemId: r.id })).join(" / ");

      if ( (await light()) !== 2 ) ctx.log(`lumière au départ : ${await light()} (l'arène n'est pas en plein jour ?)`);
      else {
        ctx.expect(/Pénombre|Dim Light/.test(await issues()), `en plein jour : souci de lumière (${await issues()})`);
        ctx.expect((await hop(-2)).accepted === false, "en plein jour : téléportation refusée");
      }
      const region = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
        shapes: [{ type: "rectangle", x: p.x - (grid * 4), y: p.y - grid, width: grid * 5, height: grid * 3 }],
        behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
      const regionId = region?.id ?? region?.regionId ?? region?.region?.id;
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {}));
      await pause(1200);
      ctx.log(`lumière dans la région : ${await light()}`);
      ctx.expect(!/Pénombre|Dim Light/.test(await issues()), `dans le noir : plus de souci de lumière (${await issues() || "aucun"})`);
      const into = await hop(-2);
      ctx.expect(into.accepted === true, `dans le noir, vers une case obscure : acceptée (${JSON.stringify(into.position)})`);
      await pause(800);
      const out = await hop(4);
      ctx.expect(out.accepted === false, "dans le noir, vers une case éclairée : refusée");
    } else ctx.log("module Ravenloft absent : Marche dans l'ombre non jouée");

    // 2. Tempête de vengeance.
    const z = await ctx.box(bandit);
    const storm = await ctx.ensureItem(mage, `${PHB}phbsplStormofVen`, { system: { method: "atwill" } });
    const used = await ctx.use({ tokenId: mage.id, itemId: storm, activityType: "save", consume: false,
      area: { shape: "circle", x: z.x + z.width / 2, y: z.y + z.height / 2, radius: grid * 1.5 } });
    if ( !ctx.expect(!!used.regionId, "Tempête : zone posée") ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(1500);
    const crossbow = await ctx.itemId(bandit.id, "light-crossbow");
    const scimitar = await ctx.itemId(bandit.id, "scimitar");
    const banned = async itemId => /attaques à distance avec une arme|ranged attacks with weapons/.test(
      (await ctx.engine("issues", { tokenId: bandit.id, itemId, activityType: "attack" })).join(" / "));
    ctx.expect(!(await banned(crossbow)), "Tempête, avant le tour 5 : l'arbalète sans souci");
    const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: used.regionId });
    const area = data.flags?.["dnd5e-combat"]?.area ?? {};
    await ctx.call("update-scene-object", { type: "Region", objectId: used.regionId, data: { "flags.dnd5e-combat.area": { ...area, pulses: 4 } } });
    await pause(800);
    ctx.expect(await banned(crossbow), "Tempête, tour 5 : l'arbalète du Bandit dans la zone — attaque à distance impossible");
    ctx.expect(!(await banned(scimitar)), "Tempête, tour 5 : le cimeterre, permis");
  }
};
