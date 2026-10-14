/**
 * M8 (SPEC §18.16) — drain du maximum de PV. Monde `ravenloft`, capacités du Monster Manual prêtées :
 *  1. Absorption de vie (Nécrophage ; une sauvegarde de Constitution dans le MM 2024) au Loup, contre le Zombi : ratée, le
 *     maximum du Zombi baisse des dégâts subis
 *     (`hp.tempmax` du delta du token).
 *  2. Morsure du Vampire (sauvegarde de Constitution, perforant + nécrotique) au Zombi, contre le Loup : ratée, le maximum du
 *     Loup baisse des seuls dégâts nécrotiques, et le Zombi regagne autant de PV.
 *  3. Drain d'énergie (Demi-liche) au Zombi, contre le Loup ramené à un maximum effectif de 3 : ratée, le maximum baisse de
 *     4d6, donc à 0 — le Loup meurt.
 *  4. §105 : Caresse dévitalisante (Ombre) au Zombi, contre le Loup : touché, un effet « Force −1d4 » sur le Loup.
 *  5. §105 : Drain de vie de la « Brume vampirique » (fiche du monde faite à la main, format 2014 en français : attaque puis
 *     sauvegarde enchaînée) au Zombi, contre le Loup : touché et sauvegarde ratée, effet de maximum de PV = dégâts subis.
 * Depuis le §105, chaque drain est un effet sur la cible (flag `dnd5e-combat.drain`), plus une écriture de `hp.tempmax`.
 * Les jets sont aléatoires : on rejoue jusqu'au toucher ou à l'échec (20 essais au plus).
 */
const WIGHT = "Compendium.dnd-monster-manual.actors.Actor.mmWight000000000";
const VAMPIRE = "Compendium.dnd-monster-manual.actors.Actor.mmVampire0000000";
const DEMILICH = "Compendium.dnd-monster-manual.actors.Actor.mmDemilich000000";
const SHADOW = "Compendium.dnd-monster-manual.actors.Actor.mmShadow00000000";
const MIST = "lcCmYY4WnuhxMDSs";   // « Brume vampirique », acteur du monde `ravenloft`
const DRAIN_EFFECT = /maximum de PV|Hit Point maximum|: (Force|Strength) −/;
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
    const drained = async (t, kind="hp") => (await ctx.effects(t)).filter(e => e.flags?.["dnd5e-combat"]?.drain?.kind === kind)
      .reduce((n, e) => n + (e.flags["dnd5e-combat"].drain.total ?? 0), 0);
    const clearDrains = t => ctx.removeEffectsNamed(t, DRAIN_EFFECT);
    const setTempmax = (t, v) => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.tempmax": v } });
    for ( const t of [wolf, zombi] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      const tm = await tempmax(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
      ctx.restore(() => setTempmax(t, tm));
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(t, s));
      ctx.restore(() => clearDrains(t));
    }
    const lend = async (uuid, identifier, token, activityType, { name }={}) => {
      const source = uuid.startsWith("Compendium.") ? (await ctx.call("get-compendium-entry", { uuid })).data : await ctx.call("get-actor", { actorId: uuid });
      const found = source.items.find(i => name ? (i.name === name) : (i.system?.identifier === identifier));
      const { _id, folder, ownership, _stats, ...itemData } = { ...found, system: { ...found.system, identifier } };
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
      ctx.expect((await drained(zombi)) >= hit.damage.applied, `effet : maximum du Zombi -${await drained(zombi)} (PV perdus ${hit.damage.applied})`);
    }
    await clearDrains(zombi);

    // 2. Morsure du Vampire.
    const bite = await lend(VAMPIRE, "bite", zombi);
    await setTempmax(wolf, 0);
    let failed = null;
    let zombiBefore = 0;
    let since = null;
    for ( let i = 0; (i < 20) && !failed; i++ ) {
      await ctx.setHp(wolf, 100);
      await ctx.setHp(zombi, 1);
      await clearDrains(wolf);
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
      const necroticDrained = await drained(wolf);
      // « égal aux dégâts nécrotiques subis » : les dégâts (dnd5e, après résistances), pas les PV perdus — un Loup à 11 PV qui
      // encaisse 18 nécrotiques voit son maximum baisser de 18.
      ctx.expect((necroticDrained > 0) && (!necrotic || necroticDrained <= necrotic),
        `effet : maximum du Loup -${necroticDrained} : la part nécrotique (jet nécrotique ${necrotic || "?"}, subi en tout ${failed.damage.applied})`);
      ctx.expect((await ctx.hp(zombi)) > zombiBefore, `le Zombi regagne des PV (${zombiBefore} → ${await ctx.hp(zombi)})`);
    }
    await clearDrains(wolf);

    // 3. Drain d'énergie.
    const energy = await lend(DEMILICH, "energy-drain", zombi);
    // Maximum effectif ramené à 3 (le delta du Loup de `ravenloft` porte un maximum de 100) : 4d6 le met sûrement à 0.
    const { data: wolfTok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const baseMax = wolfTok.delta?.system?.attributes?.hp?.max ?? 11;
    const start = -(baseMax - 3);
    let energized = null;
    for ( let i = 0; (i < 20) && !energized; i++ ) {
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wolf, s);
      await clearDrains(wolf);
      await setTempmax(wolf, start);
      await ctx.setHp(wolf, 3);
      const used = await ctx.use({ tokenId: zombi.id, itemId: energy, activityType: "save", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( t?.save?.success === false ) energized = t;
    }
    if ( ctx.expect(!!energized, "Drain d'énergie : sauvegarde ratée") ) {
      await sleep(1500);
      const tm = await drained(wolf);
      ctx.expect(tm >= 4, `effet : maximum du Loup réduit de 4d6 (${tm})`);
      const dead = (await ctx.effects(wolf)).some(e => !e.disabled && (e.statuses ?? []).includes("dead"));
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
      ctx.log(`Loup : drain ${tm}, PV ${data.delta?.system?.attributes?.hp?.value}, Mort ${dead}`);
      ctx.expect(dead, "maximum effectif ramené à 0 : le Loup meurt");
    }
    await setTempmax(wolf, 0);
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wolf, s);
    await clearDrains(wolf);

    // 4. Caresse dévitalisante (Ombre).
    const swipe = await lend(SHADOW, "draining-swipe", zombi);
    let struck = null;
    for ( let i = 0; (i < 20) && !struck; i++ ) {
      await ctx.setHp(wolf, 100);
      const used = await ctx.use({ tokenId: zombi.id, itemId: swipe, activityType: "attack", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( t?.hit === true ) struck = t;
    }
    if ( ctx.expect(!!struck, "Caresse dévitalisante : touché") ) {
      await sleep(1500);
      const str = await drained(wolf, "str");
      ctx.expect((str >= 1) && (str <= 4), `effet : Force du Loup -${str} (1d4)`);
    }
    await clearDrains(wolf);
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wolf, s);

    // 5. Drain de vie de la Brume vampirique (fiche faite à la main, en français).
    const mist = await lend(MIST, "drain-de-vie-test", zombi, null, { name: "Drain de vie" }).catch(() => null);
    if ( !mist ) { ctx.log("Brume vampirique absente du monde : partie 5 non applicable"); return; }
    let sucked = null;
    for ( let i = 0; (i < 20) && !sucked; i++ ) {
      await ctx.setHp(wolf, 100);
      await clearDrains(wolf);
      const used = await ctx.use({ tokenId: zombi.id, itemId: mist, activityType: "attack", targetTokenIds: [wolf.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(wolf.id));
      if ( (t?.hit === true) && (t.save?.success === false) && (t.damage?.applied > 0) ) sucked = t;
      else if ( (t?.hit === true) && (t.save?.success === true) ) {
        await sleep(800);
        ctx.expect((await drained(wolf)) === 0, "Drain de vie, sauvegarde réussie : pas de drain");
      }
    }
    if ( ctx.expect(!!sucked, "Drain de vie : touché, sauvegarde ratée") ) {
      await sleep(1500);
      const n = await drained(wolf);
      ctx.expect(n >= sucked.damage.applied, `effet : maximum du Loup -${n} (PV perdus ${sucked.damage.applied})`);
    }
  }
};
