/**
 * M8 (SPEC §18.16) — drain du maximum de PV. Monde `ravenloft`, capacités du Monster Manual prêtées :
 *  1. Absorption de vie (Nécrophage ; une sauvegarde de Constitution dans le MM 2024) au Loup, contre le Zombi : ratée, le
 *     maximum du Zombi baisse des dégâts subis
 *     (`hp.tempmax` du delta du token).
 *  2. Morsure du Vampire (sauvegarde de Constitution, perforant + nécrotique) au Zombi, contre le Loup : ratée, le maximum du
 *     Loup baisse des seuls dégâts nécrotiques, et le Zombi regagne autant de PV.
 *  3. Drain d'énergie (Demi-liche) au Zombi, contre le Loup ramené à un maximum effectif de 3 : ratée, le maximum baisse de
 *     4d6, donc à 0 — le Loup meurt.
 * Les jets sont aléatoires : on rejoue jusqu'au toucher ou à l'échec (20 essais au plus).
 */
const WIGHT = "Compendium.dnd-monster-manual.actors.Actor.mmWight000000000";
const VAMPIRE = "Compendium.dnd-monster-manual.actors.Actor.mmVampire0000000";
const DEMILICH = "Compendium.dnd-monster-manual.actors.Actor.mmDemilich000000";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "drain du maximum de PV — Absorption de vie, Morsure du Vampire, Drain d'énergie",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup ou Zombi absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const tempmax = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.delta?.system?.attributes?.hp?.tempmax ?? 0;
    const setTempmax = (t, v) => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.tempmax": v } });
    for ( const t of [wolf, zombi] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      const tm = await tempmax(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
      ctx.restore(() => setTempmax(t, tm));
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(t, s));
    }
    const lend = async (uuid, identifier, token, activityType) => {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === identifier);
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(token.id, identifier));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));
      return itemId;
    };
    const at = await ctx.position(wolf);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });

    // 1. Absorption de vie.
    const lifeDrain = await lend(WIGHT, "life-drain", wolf);
    await setTempmax(zombi, 0);
    let hit = null;
    for ( let i = 0; (i < 20) && !hit; i++ ) {
      await ctx.setHp(zombi, 100);
      const used = await ctx.use({ tokenId: wolf.id, itemId: lifeDrain, activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(zombi.id));
      if ( (t?.save?.success === false) && (t.damage?.applied > 0) ) hit = t;
    }
    if ( ctx.expect(!!hit, "Absorption de vie : sauvegarde ratée") ) {
      await sleep(1000);
      ctx.expect((await tempmax(zombi)) === -hit.damage.applied, `maximum du Zombi -${hit.damage.applied} (tempmax ${await tempmax(zombi)})`);
    }
    await setTempmax(zombi, 0);

    // 2. Morsure du Vampire.
    const bite = await lend(VAMPIRE, "bite", zombi);
    await setTempmax(wolf, 0);
    let failed = null;
    let zombiBefore = 0;
    let since = null;
    for ( let i = 0; (i < 20) && !failed; i++ ) {
      await ctx.setHp(wolf, 100);
      await ctx.setHp(zombi, 1);
      await setTempmax(wolf, 0);
      zombiBefore = await ctx.hp(zombi);
      since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: zombi.id, itemId: bite, activityType: "save", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( (t?.save?.success === false) && (t.damage?.applied > 0) ) failed = t;
    }
    if ( ctx.expect(!!failed, "Morsure du Vampire : sauvegarde ratée") ) {
      await sleep(1200);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      const necrotic = (damage?.rolls ?? []).filter(x => /necrotic/i.test(JSON.stringify(x.options ?? {}))).reduce((n, x) => n + (x.total ?? 0), 0);
      const drained = -(await tempmax(wolf));
      // « égal aux dégâts nécrotiques subis » : les dégâts (dnd5e, après résistances), pas les PV perdus — un Loup à 11 PV qui
      // encaisse 18 nécrotiques voit son maximum baisser de 18.
      ctx.expect((drained > 0) && (!necrotic || drained <= necrotic),
        `maximum du Loup -${drained} : la part nécrotique (jet nécrotique ${necrotic || "?"}, subi en tout ${failed.damage.applied})`);
      ctx.expect((await ctx.hp(zombi)) > zombiBefore, `le Zombi regagne des PV (${zombiBefore} → ${await ctx.hp(zombi)})`);
    }
    await setTempmax(wolf, 0);

    // 3. Drain d'énergie.
    const energy = await lend(DEMILICH, "energy-drain", zombi);
    // Maximum effectif ramené à 3 (le delta du Loup de `ravenloft` porte un maximum de 100) : 4d6 le met sûrement à 0.
    const { data: wolfTok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const baseMax = wolfTok.delta?.system?.attributes?.hp?.max ?? 11;
    const start = -(baseMax - 3);
    let drained = null;
    for ( let i = 0; (i < 20) && !drained; i++ ) {
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wolf, s);
      await setTempmax(wolf, start);
      await ctx.setHp(wolf, 3);
      const used = await ctx.use({ tokenId: zombi.id, itemId: energy, activityType: "save", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( t?.save?.success === false ) drained = t;
    }
    if ( ctx.expect(!!drained, "Drain d'énergie : sauvegarde ratée") ) {
      await sleep(1500);
      const tm = await tempmax(wolf);
      ctx.expect(tm <= start - 4, `maximum du Loup réduit de 4d6 (tempmax ${start} → ${tm})`);
      const dead = (await ctx.effects(wolf)).some(e => !e.disabled && (e.statuses ?? []).includes("dead"));
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
      ctx.log(`Loup : tempmax ${tm}, PV ${data.delta?.system?.attributes?.hp?.value}, Mort ${dead}`);
      ctx.expect(dead, "maximum effectif ramené à 0 : le Loup meurt");
    }
  }
};
