/**
 * §87 — Manœuvres du Maître de guerre qui se jouent au toucher. Le Guerrier passe niveau 3 et reçoit, prêtés depuis le compendium du
 * Manuel des joueurs, le Maître de guerre (échelle des dés de supériorité : 4d8), la Supériorité martiale, le Croc-en-jambe et
 * l'Attaque provocante ; le Bandit (300 PV) au contact. Vérifie, pour chaque manœuvre :
 *  - au coup qui touche, la question propose les manœuvres ; choisie, +1d8 au jet de dégâts, un dé de supériorité dépensé ;
 *  - puis la sauvegarde de la manœuvre sur le Bandit : Croc-en-jambe — Force, À terre ⇔ ratée ; Attaque provocante — Sagesse,
 *    Provoqué ⇔ ratée, et aucun dégât de plus (la part de la sauvegarde n'est pas lancée : `noDamage`).
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.classes.Item";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Maître de guerre — Croc-en-jambe, Attaque provocante (dé de supériorité, sauvegarde)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Bandit absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const g = await ctx.position(fighter), b0 = await ctx.position(bandit);
    ctx.restore(() => ctx.call("move-token", { tokenId: bandit.id, x: b0.x, y: b0.y, elevation: 0 }));
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const clearBandit = async () => { await ctx.removeStatusEffects(bandit, "prone"); await ctx.removeEffectsNamed(bandit, /Goaded|Provoqu/i); };
    ctx.restore(clearBandit);
    await ctx.call("move-token", { tokenId: bandit.id, x: g.x + grid, y: g.y, elevation: 0 });
    await pause(700);

    // Niveau 3 de Guerrier, le temps du scénario.
    const actor = await ctx.call("get-actor", { actorId: fighter.actorId });
    const cls = (actor.items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "fighter"));
    if ( !ctx.expect(!!cls, "le Guerrier a sa classe de guerrier") ) return;
    const levels0 = cls.system.levels;
    ctx.restore(() => ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.levels": levels0 }, match: { path: "_id", value: cls._id } }).catch(() => {}));
    await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.levels": Math.max(3, levels0) }, match: { path: "_id", value: cls._id } });
    const lend = async id => {
      const uuid = `${PHB}.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    await lend("phbftrBattleMast");
    const superiority = await lend("phbftrCombatSupe");
    await lend("phbmnvTripAttack");
    await lend("phbmnvGoadingAtt");
    await pause(1500);
    const spent = async () => ((await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? []).find(i => i._id === superiority)?.system?.uses?.spent ?? null;
    await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    const sword = await ctx.itemId(fighter.id, "greatsword");

    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const answer = async (ids, re, ms=9000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const b = (d.buttons ?? []).find(x => re.test(x.label ?? ""));
          if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); return { labels: (d.buttons ?? []).map(x => x.label) }; }
        }
      }
      return null;
    };
    /** Frappe jusqu'à toucher en choisissant la manœuvre ; rend ce qui a été vu. */
    const maneuver = async re => {
      for ( let n = 0; n < 15; n++ ) {
        await tough(); await clearBandit();
        const before = await spent();
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
        const asked = await answer(ids, re);
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) continue;
        await pause(4000);
        const msgs = await ctx.messagesSince(since);
        const damage = msgs.find(m => m.type === "damage");
        const save = msgs.find(m => (m.type === "usage") && (m.id !== u.usageMessageId));
        return { asked, damage, save, msgs, before, after: await spent() };
      }
      return null;
    };

    // 1. Croc-en-jambe.
    const trip = await maneuver(/Croc|Trip/i);
    if ( ctx.expect(!!trip, "le Guerrier touche le Bandit (15 essais au plus)") ) {
      ctx.expect((trip.asked?.labels ?? []).some(l => /Croc|Trip/i.test(l)) && (trip.asked?.labels ?? []).some(l => /provoc|Goading/i.test(l)),
        `la question propose les manœuvres (${(trip.asked?.labels ?? []).join(", ")})`);
      const formula = (trip.damage?.rolls ?? []).map(x => x.formula).join(" | ");
      ctx.expect(/1d8/.test(formula), `+1d8 au jet de dégâts (${formula})`);
      ctx.expect(trip.after === trip.before + 1, `un dé de supériorité dépensé (${trip.before} → ${trip.after})`);
      const res = trip.save ? await ctx.settle(trip.save.id).catch(() => null) : null;
      const t = res?.targets?.find(x => x.name === "Bandit");
      await pause(1200);
      const prone = (await ctx.effects(bandit)).some(e => !e.disabled && (e.statuses ?? []).includes("prone"));
      ctx.expect(res?.plan?.save?.ability === "str" && !!t?.save, `sauvegarde de Force du Bandit : ${t?.save?.total} contre DD ${res?.plan?.save?.dc}`);
      ctx.expect(prone === (t?.save?.success === false), `À terre ${prone ? "posé" : "absent"}, cohérent avec la sauvegarde (${t?.save?.success ? "réussie" : "ratée"})`);
    }

    // 2. Attaque provocante.
    const goad = await maneuver(/provoc|Goading/i);
    if ( ctx.expect(!!goad, "le Guerrier touche le Bandit (Attaque provocante)") ) {
      const res = goad.save ? await ctx.settle(goad.save.id).catch(() => null) : null;
      const t = res?.targets?.find(x => x.name === "Bandit");
      await pause(1500);
      const goaded = (await ctx.effects(bandit)).some(e => !e.disabled && /Goaded|Provoqu/i.test(e.name ?? ""));
      ctx.expect(res?.plan?.save?.ability === "wis" && !!t?.save, `sauvegarde de Sagesse du Bandit : ${t?.save?.total} contre DD ${res?.plan?.save?.dc}`);
      ctx.expect(goaded === (t?.save?.success === false), `Provoqué ${goaded ? "posé" : "absent"}, cohérent avec la sauvegarde (${t?.save?.success ? "réussie" : "ratée"})`);
      const damages = (await ctx.messagesSince(goad.damage?.id ?? goad.save?.id)).filter(m => m.type === "damage");
      ctx.expect(!damages.length, `la sauvegarde n'ajoute pas de dégâts (${damages.length} jet(s) de plus)`);
    }
  }
};
