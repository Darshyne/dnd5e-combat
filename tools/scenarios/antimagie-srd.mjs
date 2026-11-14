/**
 * §436 (suite) : le Champ antimagie du SRD de dnd5e 6.1 (compendium du système), dont l'activité pose elle-même le comportement de région
 * `antimagic` — le moteur ne lui en ajoute pas un second. Monde `dnd-6`, arène.
 *  1. Bénédiction du Clerc sur le Guerrier, loin.
 *  2. Le Magicien lance le Champ du SRD : un seul comportement `dnd5e.antimagic` sur la zone, statut sur le Magicien.
 *  3. Le Guerrier entre : statut, Bénédiction suspendue ; il sort : rétablie.
 *  4. Trait de feu du Magicien : le souci du champ (forçable, comme le Champ du Manuel).
 * Remet positions, effets, PV.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "antimagie — Champ antimagie du SRD de dnd5e 6.1",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Clerc", "Guerrier"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, cleric, fighter] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, cleric, fighter];
    let srd = null;
    for ( const packId of ["dnd5e.spells24", "dnd5e.spells"] ) {
      for ( const nameFilter of ["Antimagic", "antimagie"] ) {
        const r = await ctx.call("list-compendium-entries", { packId, nameFilter }).catch(() => null);
        const entry = (Array.isArray(r) ? r : (r?.entries ?? [])).find(e => /antimagic field|champ antimagie/i.test(e.name ?? ""));
        if ( entry ) { srd = `Compendium.${packId}.Item.${entry.id ?? entry._id}`; break; }
      }
      if ( srd ) break;
    }
    if ( !srd ) { ctx.log("Champ antimagie absent des compendiums du système : non applicable"); return; }
    ctx.log(`Champ du SRD : ${srd}`);
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t),
      effects: new Set((await ctx.effects(t)).map(e => e._id ?? e.id)) });
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    ctx.restore(async () => {
      for ( const t of all ) {
        const h = homes.get(t.id);
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !h.effects.has(e._id ?? e.id)) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(1500);
    });
    const grid = await ctx.gridSize();
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(1200); };
    const statuses = async t => new Set((await ctx.effects(t)).flatMap(e => e.statuses ?? []));
    const bless = async () => (await ctx.effectsFrom(fighter, "bless")).find(e => !(e.statuses ?? []).includes("concentrating")) ?? null;
    const m = homes.get(mage.id).pos;
    await place(fighter, m.x - 6 * grid, m.y);
    await place(cleric, m.x - 7 * grid, m.y);

    // 1. Bénédiction.
    const blessId = await ctx.ensureItem(cleric, PHB + "phbsplBless00000", { system: { method: "atwill" } });
    const b = await ctx.use({ tokenId: cleric.id, itemId: blessId, targetTokenIds: [fighter.id], consume: false });
    if ( b.usageMessageId ) await ctx.settle(b.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(1500);
    if ( !ctx.expect(!!(await bless()), "Bénédiction posée sur le Guerrier") ) return;

    // 2. Le Champ du SRD.
    const field = await ctx.ensureItem(mage, srd, { system: { method: "atwill" } });
    const used = await ctx.engine("use", { tokenId: mage.id, itemId: field });
    for ( const r of used.regions ?? [] ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    if ( used.messageId ) await ctx.settle(used.messageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    const regions = [];
    for ( const r of used.regions ?? [] ) {
      const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: r.id }).catch(() => ({ data: null }));
      if ( data ) regions.push(data);
    }
    const count = regions.reduce((n, r) => n + (r.behaviors ?? []).filter(x => x.type === "dnd5e.antimagic").length, 0);
    ctx.expect(count === 1, `un seul comportement « dnd5e.antimagic », celui du système (${count}, ${regions.length} zone(s))`);
    ctx.expect((await statuses(mage)).has("antimagic"), "le Magicien porte le statut « antimagic »");

    // 3. Le Guerrier entre, puis sort.
    await place(fighter, m.x - grid, m.y);
    await pause(1000);
    ctx.expect((await statuses(fighter)).has("antimagic") && (await bless())?.suppressed === true,
      `dans le champ : statut et Bénédiction suspendue (suppressed=${(await bless())?.suppressed})`);
    await place(fighter, m.x - 6 * grid, m.y);
    await pause(1000);
    ctx.expect(!(await statuses(fighter)).has("antimagic") && (await bless())?.suppressed === false,
      `hors du champ : plus de statut, Bénédiction rétablie (suppressed=${(await bless())?.suppressed})`);

    // 4. Trait de feu dans le champ : le souci du champ.
    const bolt = await ctx.ensureItem(mage, PHB + "phbsplFireBolt00", { system: { method: "atwill" } });
    const issues = await ctx.engine("issues", { tokenId: mage.id, itemId: bolt });
    ctx.expect(issues.some(l => /no spell can be cast|aucun sort/i.test(l)), `Trait de feu : le souci du champ (${issues.join(" ; ") || "aucun souci"})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
