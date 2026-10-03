/**
 * Le Magicien du Manuel des joueurs 2024 (SPEC §28), monde `dnd-6`. Le Magicien (niveau 1) reçoit, prêtés depuis le compendium du
 * Manuel des joueurs, Sort mineur appuyé, Façonneur de sorts, Évocation améliorée et Calque illusoire ; le Bandit reçoit 300 PV.
 * Vérifie :
 *  - Sort mineur appuyé : Rayon de givre raté → le Bandit perd la moitié des dégâts (arrondie à l'inférieur), sans l'effet de
 *    lenteur ; Aspersion acide sauvegardée → la moitié ;
 *  - Façonneur de sorts : Vague tonnante posée sur le Guerrier et le Bandit — le Guerrier réussit d'office et ne perd rien ;
 *  - Évocation améliorée : la Vague tonnante porte + le modificateur d'Intelligence ;
 *  - Calque illusoire : le Bandit touche le Magicien → la réaction fait rater l'attaque ; le Bouclier, sans emplacement, n'est pas proposé.
 * Remet positions, PV, emplacements, états ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "magicien — Sort mineur appuyé, Façonneur de sorts, Évocation améliorée, Calque illusoire",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Bandit", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const bandit = await ctx.token("Bandit");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [mage, bandit, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(mage.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const lend = async id => {
      const uuid = `Compendium.${CLASSES}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: id }).catch(() => {});
    const actor0 = await ctx.call("get-actor", { actorId: mage.actorId });
    const slots0 = Object.fromEntries(Object.entries(actor0.system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
    ctx.restore(() => ctx.call("update-actor", { actorId: mage.actorId, actorData: Object.fromEntries(Object.entries(slots0).map(([k, v]) => [`system.spells.${k}.value`, v])) }).catch(() => {}));

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Ralenti|Slowed|Rayon de givre|Ray of Frost/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const total = msg => (msg?.rolls ?? []).reduce((s, r) => s + (r.total ?? 0), 0);

    await part("Sort mineur appuyé", async () => {
      const potent = await lend("phbwzdPotentCant");
      await tough(); await place(bandit, g.x + 2 * grid, g.y);
      // Rayon de givre raté : la moitié, sans la lenteur.
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        await ctx.removeEffectsNamed(tokens.find(x => x.id === bandit.id), /Ralenti|Slowed|Rayon de givre|Ray of Frost/i);   // posée par un essai qui a touché
        const hp0 = await ctx.hp(bandit);
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.[0]?.hit !== false ) continue;
        await pause(1500);
        const dealt = total((await ctx.messagesSince(since)).find(m => m.type === "damage"));
        const lost = hp0 - (await ctx.hp(bandit));
        const effects = (await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id })).data.delta?.effects ?? [];
        if ( process.env.DEBUG ) ctx.log(`effets du Bandit : ${JSON.stringify(effects.map(e => [e.name, e.origin, e._stats?.createdTime]))}`);
        const slowed = effects.some(e => /Ralenti|Slowed|givre|Frost/i.test(e.name ?? ""));
        ctx.expect((dealt > 0) && (lost === Math.floor(dealt / 2)) && !slowed, `Rayon de givre raté : ${dealt} dégâts → ${lost} PV perdus, lenteur ${!!slowed}`);
        checked = true;
      }
      ctx.expect(checked, "un Rayon de givre raté (20 essais au plus)");
      // Aspersion acide sauvegardée : la moitié.
      checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        const hp0 = await ctx.hp(bandit);
        const since = await ctx.lastMessageId();
        const box = await ctx.box(bandit);
        const u = await ctx.use({ tokenId: mage.id, identifier: "acid-splash", activityType: "save", area: { shape: "rectangle", ...box }, usageConfig: { [MODULE_ID]: { confirmed: true } } });
        if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Bandit");
        if ( t?.save?.success !== true ) continue;
        await pause(1500);
        const dealt = total((await ctx.messagesSince(since)).find(m => m.type === "damage"));
        const lost = hp0 - (await ctx.hp(bandit));
        ctx.expect((dealt > 0) && (lost === Math.floor(dealt / 2)), `Aspersion acide sauvegardée (${t.save.total}) : ${dealt} dégâts → ${lost} PV perdus`);
        checked = true;
      }
      ctx.expect(checked, "une Aspersion acide sauvegardée (20 essais au plus)");
      await unlend(potent);
    });

    await part("Façonneur de sorts, Évocation améliorée", async () => {
      const sculpt = await lend("phbwzdSculptSpel");
      const empowered = await lend("phbwzdEmpoweredE");
      await tough();
      await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.spells.spell1.value": 2 } });
      await place(fighter, g.x, g.y + 2 * grid);
      await place(bandit, g.x + grid, g.y + 2 * grid);
      const f0 = await ctx.hp(fighter);
      const fb = await ctx.box(fighter);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: mage.id, identifier: "thunderwave", activityType: "save",
        area: { shape: "rectangle", x: fb.x, y: fb.y, width: 2 * grid, height: grid }, usageConfig: { [MODULE_ID]: { confirmed: true } } });
      if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const tf = r?.targets?.find(x => x.name === "Guerrier");
      const tb = r?.targets?.find(x => x.name === "Bandit");
      ctx.expect(tf?.save?.auto === "sculpted" && tf.save.success === true, `Guerrier épargné : sauvegarde ${JSON.stringify(tf?.save)}`);
      ctx.expect((await ctx.hp(fighter)) === f0, `Guerrier : ${f0} → ${await ctx.hp(fighter)} PV`);
      ctx.expect(!!tb?.save && (tb.save.auto !== "sculpted"), `Bandit : sauvegarde jouée (${tb?.save?.total})`);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      const bonuses = (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
      ctx.expect(bonuses.includes("@abilities.int.mod thunder"), `Évocation améliorée : ${bonuses.join(", ")} ; jets ${(damage?.rolls ?? []).map(x => x.formula).join(" + ")}`);
      await unlend(sculpt); await unlend(empowered);
    });

    await part("Calque illusoire", async () => {
      await lend("phbwzdIllusorySe");
      // Sans emplacement, pas de Bouclier : la seule réaction offerte est le Calque.
      await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.spells.spell1.value": 0 } });
      await tough(); await place(bandit, g.x + grid, g.y);
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        const hp0 = await ctx.hp(mage);
        const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [mage.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Magicien");
        if ( process.env.DEBUG && t?.hit ) ctx.log(`coup : ${JSON.stringify(t).slice(0, 500)} ; ${JSON.stringify(await ctx.engine("identify", { tokenId: mage.id })).match(/illusory[^}]*}/)?.[0]}`);
        if ( !t?.reaction ) continue;
        await pause(1000);
        ctx.expect((t.hit === false) && ((await ctx.hp(mage)) === hp0), `réaction « ${t.reaction} » : touché ${t.hit}, PV ${hp0} → ${await ctx.hp(mage)} (jet ${r.attack?.roll?.total} contre CA ${t.ac})`);
        checked = true;
      }
      ctx.expect(checked, "le Bandit a touché le Magicien et le Calque a joué (20 essais au plus)");
    });
  }
};
