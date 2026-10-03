/**
 * §61 — Robustesse de la non-vie. Monde `ravenloft` : le Zombi (sa capacité, ou celle du Zombi du Monster Manual prêtée), à 1 PV,
 * reçoit des Traits de feu de Kaalisti hors combat.
 *  - touché sans critique : une sauvegarde de Constitution, DD 5 + dégâts subis ; réussie, il reste à 1 PV, ni Mort ni
 *    Inconscient ; ratée, il est Mort à 0 PV ;
 *  - touché sur un critique : pas de sauvegarde, il est Mort.
 * Rejoue jusqu'à avoir vu un coup sans critique (20 essais au plus) ; le Zombi est remis à 1 PV entre deux essais.
 */
const ZOMBIE = "Compendium.dnd-monster-manual.actors.Actor.mmZombie00000000";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "robustesse de la non-vie — sauvegarde à 0 PV, DD 5 + dégâts, pas sur un critique",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Kaalisti"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi ou Kaalisti absent : non applicable"); return; }
    const zombie = await ctx.token("Zombi");
    const warlock = await ctx.token("Kaalisti");
    const hp0 = await ctx.hp(zombie);
    ctx.restore(() => ctx.setHp(zombie, hp0));
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(zombie, s));

    // La capacité : celle du Zombi, ou celle du Monster Manual prêtée le temps du scénario.
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombie.id });
    const items = (await ctx.call("get-actor", { actorId: tok.actorId })).items ?? [];
    if ( !items.some(i => i.system?.identifier === "undead-fortitude") ) {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid: ZOMBIE });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === "undead-fortitude");
      const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "undead-fortitude" } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(zombie.id, "undead-fortitude"));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));
      ctx.log("capacité prêtée depuis le Zombi du Monster Manual");
    }

    const statuses = async () => new Set((await ctx.effects(zombie)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []));
    const reset = async () => {
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(zombie, s).catch(() => {});
      await ctx.setHp(zombie, 1);
      await sleep(800);
    };

    let seenPlain = false;
    let seenCritical = false;
    for ( let i = 0; (i < 20) && !seenPlain; i++ ) {
      await reset();
      const since = await ctx.lastMessageId();
      const bolt = await ctx.use({ tokenId: warlock.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombie.id] });
      const r = await ctx.settle(bolt.usageMessageId).catch(() => null);
      const target = r?.targets?.[0];
      if ( !target?.hit ) continue;
      await sleep(3500);   // dégâts, puis la sauvegarde jouée par le MJ actif
      const messages = await ctx.messagesSince(since);
      const save = messages.find(m => m.flags?.["dnd5e-combat"]?.fortitude);
      const hp = await ctx.hp(zombie);
      const st = await statuses();
      if ( target.critical ) {
        if ( seenCritical ) continue;
        seenCritical = true;
        ctx.expect(!save, "coup critique : pas de sauvegarde");
        ctx.expect((hp === 0) && st.has("dead"), `coup critique : Mort à 0 PV (${hp} PV, ${[...st].join(", ") || "aucun état"})`);
        continue;
      }
      seenPlain = true;
      if ( !ctx.expect(!!save, "touché sans critique : une sauvegarde de Robustesse de la non-vie") ) return;
      const { dc } = save.flags["dnd5e-combat"].fortitude;
      const total = save.rolls?.[0]?.total;
      const damage = (messages.find(m => m.type === "damage")?.rolls ?? []).reduce((n, x) => n + (x.total ?? 0), 0);
      ctx.expect(/constitution|con/i.test(JSON.stringify(save)), "sauvegarde de Constitution");
      if ( damage ) ctx.expect(dc === 5 + damage, `DD 5 + dégâts subis (${dc}, ${damage} dégâts)`);
      if ( total >= dc ) ctx.expect((hp === 1) && !st.has("dead") && !st.has("unconscious"),
        `réussie (${total} contre DD ${dc}) : reste à 1 PV, debout (${hp} PV, ${[...st].join(", ") || "aucun état"})`);
      else ctx.expect((hp === 0) && st.has("dead"), `ratée (${total} contre DD ${dc}) : Mort à 0 PV (${hp} PV, ${[...st].join(", ") || "aucun état"})`);
    }
    ctx.expect(seenPlain, "un Trait de feu touche sans critique (20 essais au plus)");
  }
};
