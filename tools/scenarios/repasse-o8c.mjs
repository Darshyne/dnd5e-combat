/**
 * §346, lot O8c de la repasse des objets : lumière d'une arme enchantée, capuchon de la Lanterne à capuchon. Arène de test (Guerrier).
 *  1. Lanterne à capuchon allumée : 30/60 ft ; capuchon baissé : 0/5 ft ; levé : 30/60 ft de nouveau.
 *  2. Langue de feu posée sur une Épée longue : pas de lumière ; « Ablaze » posé : la lame éclaire (40/80 ft) ; retiré : plus de lumière.
 *  3. Épée sélène : une source portée (menu « Allumer »), 15/30 ft.
 */
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o8c — capuchon de la Lanterne à capuchon, lumière d'une arme enchantée (Langue de feu, Épée sélène)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const t = tokens.find(x => x.name === "Guerrier");
    if ( !t?.actorId ) { ctx.log("Guerrier absent ou non lié : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const actorId = t.actorId;
    const light = () => ctx.engine("tokenLight", { tokenId: fighter.id });
    const near = (a, b) => Math.abs(a - b) < 0.6;
    const shows = async (bright, dim) => { await pause(600); const l = await light(); return near(l.bright, bright) && near(l.dim, dim) ? null : `${l.bright}/${l.dim}`; };
    const base = await light();
    // Les rayons s'expriment dans l'unité de la scène (pieds dans l'Arène). Les mains libres : armes et boucliers rangés le temps du scénario.
    const setItem = (id, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: id } });
    const inHand = ((await ctx.call("get-actor", { actorId })).items ?? []).filter(i => i.system?.equipped
      && ((i.type === "weapon") || ((i.type === "equipment") && (i.system?.type?.value === "shield")))).map(i => i._id);
    for ( const id of inHand ) await setItem(id, { "system.equipped": false });
    ctx.restore(async () => { for ( const id of inHand ) await setItem(id, { "system.equipped": true }); });

    // 1. Lanterne à capuchon.
    await ctx.ensureItem(fighter, `${PHB}phbagOil00000000`, { system: { quantity: 1 } });
    const lantern = await ctx.ensureItem(fighter, `${PHB}phbagLanternHood`);
    const on = await ctx.engine("toggleLight", { actorId, itemId: lantern, on: true });
    ctx.restore(() => ctx.engine("toggleLight", { actorId, itemId: lantern, on: false }).catch(() => null));
    ctx.expect(on?.changed === true, `Lanterne allumée (${on?.reason ?? "ok"})`);
    let bad = await shows(30, 60);
    ctx.expect(!bad, `Lanterne : 30/60 (${bad ?? "ok"})`);
    const down = await ctx.engine("hood", { actorId, itemId: lantern, down: true });
    bad = await shows(0, 5);
    ctx.expect(down?.changed === true && !bad, `Capuchon baissé : Lumière faible sur 5 ft (${bad ?? "ok"})`);
    await ctx.engine("hood", { actorId, itemId: lantern, down: false });
    bad = await shows(30, 60);
    ctx.expect(!bad, `Capuchon levé : 30/60 de nouveau (${bad ?? "ok"})`);
    await ctx.engine("toggleLight", { actorId, itemId: lantern, on: false });

    // 2. Langue de feu.
    const sword = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);
    await ctx.call("upsert-actor-item", { actorId, itemData: { system: { equipped: true } }, match: { path: "_id", value: sword } });
    const tongue = await ctx.ensureItem(fighter, `${DMG}dmgFlameTongue00`);
    const base1 = await ctx.engine("enchant", { tokenId: fighter.id, itemId: tongue, activityId: "QYYI3r1wlDAyKzAv", targetItemId: sword }).catch(err => ({ error: err.message }));
    if ( !ctx.expect(!!base1?.effectId, `la Langue de feu enchante l'Épée longue (${base1?.error ?? "ok"})`) ) return;
    bad = await shows(base.bright, base.dim);
    ctx.expect(!bad, `éteinte, l'épée n'éclaire pas (${bad ?? "ok"})`);
    const ablaze = await ctx.engine("enchant", { tokenId: fighter.id, itemId: tongue, activityId: "FrNZRC1C2HFJxUNu", targetItemId: sword }).catch(err => ({ error: err.message }));
    await pause(800);
    bad = await shows(40, 80);
    ctx.expect(!!ablaze?.effectId && !bad, `« Ablaze » : la lame éclaire 40/80 (${bad ?? ablaze?.error ?? "ok"})`);
    if ( ablaze?.effectId ) {
      await ctx.engine("removeItemEffect", { actorId, itemId: sword, effectId: ablaze.effectId });
      await pause(800);
      bad = await shows(base.bright, base.dim);
      ctx.expect(!bad, `les flammes éteintes, plus de lumière (${bad ?? "ok"})`);
    }

    // 3. Épée sélène.
    const moon = await ctx.ensureItem(fighter, `${DMG}dmgMoontouchedSw`);
    const lit = await ctx.engine("toggleLight", { actorId, itemId: moon, on: true });
    ctx.restore(() => ctx.engine("toggleLight", { actorId, itemId: moon, on: false }).catch(() => null));
    bad = await shows(15, 30);
    ctx.expect(lit?.changed === true && !bad, `Épée sélène dégainée : 15/30 (${bad ?? lit?.reason ?? "ok"})`);
    await ctx.engine("toggleLight", { actorId, itemId: moon, on: false });
  }
};
