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
      ctx.expect(/[12]d8/.test(formula), `+1d8 au jet de dégâts, 2d8 sur un critique (${formula})`);
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

    // 3. §88 : Parade et Riposte, en réaction aux attaques du Bandit (prises d'office : `autoReact: "first"`).
    await lend("phbmnvParry00000");
    await lend("phbmnvRiposte000");
    await pause(1200);
    await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    const hp0 = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    const scimitar = await ctx.itemId(bandit.id, "scimitar");
    const banditAttack = async () => {
      await ctx.setHp(fighter, hp0); await tough(); await clearBandit();
      // Dés remis à chaque attaque : les Ripostes des coups ratés les épuiseraient avant le coup qui touche (Parade).
      await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
      const before = await spent();
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: bandit.id, itemId: scimitar, activityType: "attack", targetTokenIds: [fighter.id],
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(5000);
      return { r, since, before, after: await spent(), hit: r?.targets?.find(t => t.name === "Guerrier")?.hit ?? null };
    };

    // Parade : un coup qui touche — un dé dépensé, les dégâts réduits du jet de la Parade.
    let parried = null;
    for ( let n = 0; (n < 20) && !parried; n++ ) { const a = await banditAttack(); if ( a.hit === true ) parried = a; }
    if ( ctx.expect(!!parried, "le Bandit touche le Guerrier (20 essais au plus)") ) {
      const msgs = await ctx.messagesSince(parried.since);
      const reaction = msgs.find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.reaction && /Parade|Parry/i.test(m.flavor ?? m.speaker?.alias ?? JSON.stringify(m.system?.activity ?? "")));
      const t = parried.r?.targets?.find(x => x.name === "Guerrier");
      ctx.expect(parried.after === parried.before + 1, `Parade : un dé de supériorité dépensé (${parried.before} → ${parried.after})`);
      ctx.expect((t?.damage?.reduced ?? t?.reduced ?? 0) > 0 || (t?.damage?.applied ?? 99) < (t?.damage?.total ?? 0),
        `Parade : dégâts réduits (${JSON.stringify(t?.damage ?? null)})`);
      ctx.log(`carte de réaction : ${reaction ? "présente" : "non trouvée par le libellé"}`);
    }

    // Riposte : un coup raté — un dé dépensé, une attaque du Guerrier contre le Bandit ; touché, +1d8 aux dégâts.
    // Jusqu'à une Riposte qui touche (pour voir le dé aux dégâts) ; à défaut, la dernière qui a eu lieu.
    let riposted = null;
    for ( let n = 0; n < 25; n++ ) {
      const a = await banditAttack();
      if ( a.hit !== false ) continue;
      riposted = a;
      const msgs = await ctx.messagesSince(a.since);
      if ( msgs.some(m => (m.type === "damage") && (m.speaker?.alias === "Guerrier" || m.alias === "Guerrier")) ) break;
      await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    }
    if ( ctx.expect(!!riposted, "le Bandit rate le Guerrier (20 essais au plus)") ) {
      ctx.expect(riposted.after === riposted.before + 1, `Riposte : un dé de supériorité dépensé (${riposted.before} → ${riposted.after})`);
      const msgs = await ctx.messagesSince(riposted.since);
      const counter = msgs.find(m => (m.type === "attack") && (m.speaker?.alias === "Guerrier" || m.alias === "Guerrier"));
      ctx.expect(!!counter, "Riposte : le Guerrier attaque le Bandit avec son arme");
      const dmg = msgs.find(m => (m.type === "damage") && (m.speaker?.alias === "Guerrier" || m.alias === "Guerrier"));
      if ( dmg ) {
        const formula = (dmg.rolls ?? []).map(x => x.formula).join(" | ");
        ctx.expect(/1d8/.test(formula), `Riposte qui touche : +1d8 aux dégâts (${formula})`);
      } else ctx.log("la Riposte a raté : pas de jet de dégâts à contrôler");
    }

    // 4. §89 : manœuvres à l'action Bonus (hors combat : le budget du tour n'est pas en jeu ici).
    await lend("phbmnvFeintingAt");
    await lend("phbmnvLungingAtt");
    await lend("phbmnvEvasiveFoo");
    await lend("phbmnvRally00000");
    await pause(1200);
    const refill = () => ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    const pendingFlag = async () => (await ctx.call("get-actor", { actorId: fighter.actorId })).flags?.[MODULE_ID]?.pendingDie ?? null;
    ctx.restore(() => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { [`flags.${MODULE_ID}.-=pendingDie`]: null } }).catch(() => {}));
    const swing = async () => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
      await answer(await known(), /^Rien$|^Aucune|^None/i, 3000);   // la question des manœuvres au toucher : rien
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const msgs = await ctx.messagesSince(since);
      return { hit: r?.targets?.find(t => t.name === "Bandit")?.hit ?? null, mode: msgs.find(m => m.type === "attack")?.rolls?.[0]?.options?.advantageMode ?? null,
        damage: (msgs.find(m => m.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ") };
    };

    // Feinte : sur le Bandit — aucun dégât, l'effet posé ; l'attaque suivante a l'Avantage ; touchée, +1d8.
    const feint = await ctx.itemId(fighter.id, "feinting-attack");
    let feinted = null;
    for ( let n = 0; (n < 15) && !feinted; n++ ) {
      await tough(); await refill(); await clearBandit();
      const hpBefore = await ctx.hp(bandit);
      await ctx.use({ tokenId: fighter.id, itemId: feint, targetTokenIds: [bandit.id] });
      await pause(2500);
      const marked = (await ctx.effects(bandit)).some(e => /Feint/i.test(e.name ?? ""));
      const hpAfter = await ctx.hp(bandit);
      if ( n === 0 ) {
        ctx.expect(marked, "Feinte : l'effet est posé sur le Bandit");
        ctx.expect(hpAfter === hpBefore, `Feinte : aucun dégât à l'utilisation (${hpBefore} → ${hpAfter})`);
        ctx.expect((await pendingFlag())?.against === "target", "Feinte : le dé est promis contre le Bandit");
      }
      const a = await swing();
      if ( n === 0 ) ctx.expect(a.mode === 1, `Feinte : l'attaque suivante a l'Avantage (mode ${a.mode})`);
      if ( a.hit === true ) feinted = a;
      else if ( n === 0 ) ctx.expect(!(await pendingFlag()), "Feinte : l'attaque a raté, le dé promis est perdu");
    }
    if ( ctx.expect(!!feinted, "Feinte suivie d'un coup qui touche (15 essais au plus)") ) {
      ctx.expect(/1d8/.test(feinted.damage), `Feinte : +1d8 aux dégâts (${feinted.damage})`);
    }
    await ctx.removeEffectsNamed(bandit, /Feint/i);

    // Fente : le dé promis au prochain coup au corps à corps.
    const lunge = await ctx.itemId(fighter.id, "lunging-attack");
    let lunged = null;
    for ( let n = 0; (n < 15) && !lunged; n++ ) {
      await tough(); await refill();
      if ( !(await pendingFlag()) ) await ctx.use({ tokenId: fighter.id, itemId: lunge });
      await pause(1500);
      if ( n === 0 ) ctx.expect((await pendingFlag())?.against === "melee", "Fente : le dé est promis au prochain coup au corps à corps");
      const a = await swing();
      if ( a.hit === true ) lunged = a;
    }
    if ( ctx.expect(!!lunged, "Fente suivie d'un coup qui touche (15 essais au plus)") ) {
      ctx.expect(/1d8/.test(lunged.damage), `Fente : +1d8 aux dégâts (${lunged.damage})`);
      ctx.expect(!(await pendingFlag()), "Fente : la promesse est consommée");
    }

    // Jeu de jambes évasif : la CA augmente du dé.
    await refill();
    const ac0 = (await ctx.engine("stats", { tokenId: fighter.id }))?.ac ?? null;
    ctx.restore(() => ctx.removeEffectsNamed(fighter, /Evasive|évasif/i));
    await ctx.use({ tokenId: fighter.id, itemId: await ctx.itemId(fighter.id, "evasive-footwork") });
    await pause(4000);
    const ac1 = (await ctx.engine("stats", { tokenId: fighter.id }))?.ac ?? null;
    ctx.expect((ac0 !== null) && (ac1 > ac0) && (ac1 - ac0 <= 8), `Jeu de jambes évasif : CA ${ac0} → ${ac1} (+1d8)`);

    // Ralliement : des PV temporaires au Clerc (allié).
    const ally = tokens.find(t => t.name === "Clerc") ? await ctx.token("Clerc") : null;
    if ( ally ) {
      await refill();
      const a0 = await ctx.call("get-actor", { actorId: ally.actorId });
      const temp0 = a0.system?.attributes?.hp?.temp ?? 0;
      ctx.restore(() => ctx.call("update-actor", { actorId: ally.actorId, actorData: { "system.attributes.hp.temp": temp0 } }).catch(() => {}));
      const before = await spent();
      // `consume: true` : le dé se dépense comme au clic ; le jet de soin est lancé par la carte (le connecteur coupe l'enchaînement
      // de dnd5e : `subsequentActions: false`), comme `sorts-lot-1`.
      const u = await ctx.use({ tokenId: fighter.id, itemId: await ctx.itemId(fighter.id, "rally"), targetTokenIds: [ally.id], consume: true });
      await pause(800);
      if ( u.usageMessageId ) await ctx.engine("rollCard", { messageId: u.usageMessageId }).catch(() => null);
      await pause(3500);
      const temp1 = (await ctx.call("get-actor", { actorId: ally.actorId })).system?.attributes?.hp?.temp ?? 0;
      ctx.expect(temp1 > temp0, `Ralliement : PV temporaires du Clerc ${temp0} → ${temp1}`);
      ctx.expect((await spent()) === before + 1, "Ralliement : un dé de supériorité dépensé");
    }
  }
};
