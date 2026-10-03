/**
 * M8 (SPEC §18.13) — Régénération. Monde `ravenloft` : la Régénération du Troll (Monster Manual) prêtée à l'Ours brun.
 *  1. Au début de son tour, l'Ours regagne des PV.
 *  2. Un Trait de feu de Kaalisti le touche : au tour suivant, pas de régénération.
 *  3. À 0 PV il est Inconscient, pas Mort (la Mort d'office de dnd5e est retirée) ; au début de son tour il régénère.
 *  4. À 0 PV et brûlé : au début de son tour, il meurt.
 * Initiative imposée : Kaalisti, puis l'Ours.
 */
const TROLL = "Compendium.dnd-monster-manual.actors.Actor.mmTroll000000000";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "régénération — soin au début du tour, coupée par le feu, troll à 0 PV",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ours brun", "Kaalisti"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ours brun ou Kaalisti absent : non applicable"); return; }
    const bear = await ctx.token("Ours brun");
    const warlock = await ctx.token("Kaalisti");
    const hp0 = await ctx.hp(bear);
    ctx.restore(() => ctx.setHp(bear, hp0));
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(bear, s));
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: bear.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bear.id,
      data: { "delta.flags.dnd5e-combat.-=regenerationStopped": null } }).catch(() => {}));

    const { data: troll } = await ctx.call("get-compendium-entry", { uuid: TROLL });
    const { _id, folder, ownership, _stats, ...itemData } = troll.items.find(i => i.system?.identifier === "regeneration");
    const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "regeneration" } });
    const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(bear.id, "regeneration"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));

    await ctx.startCombat([warlock, bear]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[warlock, 20], [bear, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === token.id).id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    /** Avance jusqu'au début du tour de ce token. */
    const turnOf = async token => {
      for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await sleep(1500); }
      return (await current()) === token.id;
    };
    const statuses = async () => new Set((await ctx.effects(bear)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []));
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;

    // 1. Soin au début du tour.
    await ctx.setHp(bear, 10);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) > 10, `début du tour de l'Ours : régénère (10 → ${await ctx.hp(bear)} PV)`);

    // 2. Brûlé : pas de régénération au tour suivant.
    const burn = async () => {
      for ( let i = 0; i < 20; i++ ) {
        const bolt = await ctx.use({ tokenId: warlock.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [bear.id] });
        const r = await ctx.settle(bolt.usageMessageId).catch(() => null);
        if ( r?.targets?.[0]?.hit ) return true;
      }
      return false;
    };
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 30);
    if ( !ctx.expect(await burn(), "Trait de feu : touché") ) return;
    await sleep(1000);
    const burnt = await ctx.hp(bear);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === burnt, `brûlé : pas de régénération ce tour-ci (${burnt} → ${await ctx.hp(bear)} PV)`);

    // 3. À 0 PV : Inconscient, puis régénère.
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 0);
    await sleep(2000);
    let st = await statuses();
    ctx.expect(st.has("unconscious") && !st.has("dead"), `0 PV : Inconscient, pas Mort (${[...st].join(", ")})`);
    await ctx.nextTurn(); await sleep(2500);
    st = await statuses();
    ctx.expect(((await ctx.hp(bear)) > 0) && !st.has("dead") && !st.has("unconscious"), `début de son tour : régénère et se relève (${await ctx.hp(bear)} PV, ${[...st].join(", ")})`);

    // 4. À 0 PV et brûlé : meurt au début de son tour.
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 1);
    if ( !ctx.expect(await burn(), "Trait de feu : touché") ) return;
    await sleep(1000);
    await ctx.setHp(bear, 0);
    await sleep(1500);
    ctx.expect(!(await statuses()).has("dead"), "brûlé à 0 PV : pas encore Mort");
    await ctx.nextTurn(); await sleep(2500);
    st = await statuses();
    ctx.expect(st.has("dead") && ((await ctx.hp(bear)) === 0), `début de son tour à 0 PV sans régénérer : Mort (${[...st].join(", ")})`);
  }
};
