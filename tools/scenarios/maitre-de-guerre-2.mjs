/**
 * §90 — Le reste des manœuvres du Maître de guerre. Le Guerrier passe niveau 3 et reçoit, prêtés depuis le compendium du Manuel des
 * joueurs, le Maître de guerre, la Supériorité martiale et les manœuvres ; le Bandit (300 PV) à l'est, le Clerc au nord-est (au contact
 * des deux), le Zombi au sud-est (au contact des deux). Vérifie :
 *  - Attaque précise : une attaque ratée — la question, un dé dépensé, le total de la résolution = jet + dé, touché ⇔ total ≥ CA ;
 *  - Embuscade : un test de Discrétion — la question, un dé dépensé ; un test d'Athlétisme — aucune question ; Autorité naturelle sur
 *    un test de Persuasion ; l'initiative : la première valeur du Guerrier (20) reçoit le dé ;
 *  - Frappe commandée (en combat, tour du Guerrier) : l'ordre au Clerc (budget, dé promis), son attaque payée par la Réaction, +1d8 ;
 *  - Chassé-croisé : les places échangées, le dé à la CA du Clerc ;
 *  - Balayage : un coup qui touche le Bandit — le dé au Zombi, un dé dépensé.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.classes.Item";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Maître de guerre — Attaque précise, Embuscade, Frappe commandée, Chassé-croisé, Balayage",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit", "Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Bandit, Clerc ou Zombi absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const cleric = await ctx.token("Clerc");
    const zombie = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const g = await ctx.position(fighter);
    for ( const t of [bandit, cleric, zombie] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
    }
    ctx.restore(() => ctx.call("move-token", { tokenId: fighter.id, x: g.x, y: g.y, elevation: g.elevation }));
    const place = async () => {
      await ctx.call("move-token", { tokenId: fighter.id, x: g.x, y: g.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: bandit.id, x: g.x + grid, y: g.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: cleric.id, x: g.x + grid, y: g.y - grid, elevation: 0 });
      await ctx.call("move-token", { tokenId: zombie.id, x: g.x + grid, y: g.y + grid, elevation: 0 });
      await pause(800);
    };
    await place();
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const zhp0 = await ctx.hp(zombie);
    ctx.restore(() => ctx.setHp(zombie, zhp0));

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
    for ( const id of ["phbmnvPrecisionA", "phbmnvAmbush0000", "phbmnvCommanding", "phbmnvCommanders", "phbmnvBaitandSwi"] ) await lend(id);
    await pause(1500);
    const spent = async () => ((await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? []).find(i => i._id === superiority)?.system?.uses?.spent ?? null;
    const refill = () => ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    await refill();
    const sword = await ctx.itemId(fighter.id, "greatsword");

    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const answer = async (ids, re, ms=9000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const b = (d.buttons ?? []).find(x => re.test(x.label ?? ""));
          if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); return { labels: (d.buttons ?? []).map(x => x.label), text: d.content ?? d.text ?? "" }; }
        }
      }
      return null;
    };
    const bonusCards = (msgs, kind) => msgs.filter(m => m.flags?.[MODULE_ID]?.rollBonus?.kind === kind);

    // 1. Attaque précise : jusqu'à une attaque ratée, dé ajouté.
    let precise = null;
    for ( let n = 0; (n < 20) && !precise; n++ ) {
      await tough(); await refill();
      const before = await spent();
      const ids = await known();
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
      const asked = await answer(ids, /^Ajouter|^Add/i, 6000);
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( !asked ) continue;
      await pause(1500);
      precise = { r, before, after: await spent(), cards: bonusCards(await ctx.messagesSince(since), "attack") };
    }
    if ( ctx.expect(!!precise, "Attaque précise : une attaque ratée, la question posée et acceptée (20 essais au plus)") ) {
      const t = precise.r?.targets?.find(x => x.name === "Bandit");
      const added = precise.cards[0]?.flags?.[MODULE_ID]?.rollBonus?.added ?? null;
      const total = precise.r?.attack?.roll?.total ?? null;
      ctx.expect(precise.after === precise.before + 1, `Attaque précise : un dé de supériorité dépensé (${precise.before} → ${precise.after})`);
      ctx.expect(Number.isFinite(added) && (added >= 1) && (added <= 8), `Attaque précise : le dé lancé en clair (+${added})`);
      ctx.expect(Number.isFinite(total) && Number.isFinite(t?.ac) && (t.hit === (total >= t.ac)), `Attaque précise : total ${total} contre CA ${t?.ac}, ${t?.hit ? "touché" : "raté"}`);
    }

    // 2. Embuscade et Autorité naturelle : un test de la bonne compétence ouvre la question ; un autre non.
    const check = async (skill, re) => {
      await refill();
      const before = await spent();
      const ids = await known();
      const since = await ctx.lastMessageId();
      const rolled = await ctx.engine("rollCheck", { tokenId: fighter.id, skill });
      const asked = re ? await answer(ids, re, 8000) : await answer(ids, /./, 3000);
      await pause(1500);
      return { rolled, asked, before, after: await spent(), cards: bonusCards(await ctx.messagesSince(since), "check") };
    };
    const stealth = await check("ste", /^Ajouter|^Add/i);
    ctx.expect(!!stealth.asked, `Embuscade : la question au test de Discrétion (${stealth.rolled?.total})`);
    ctx.expect(stealth.after === stealth.before + 1, `Embuscade : un dé dépensé (${stealth.before} → ${stealth.after})`);
    ctx.expect(stealth.cards.length === 1, `Embuscade : la carte du dé (${stealth.cards[0]?.flavor ?? "absente"})`);
    const athletics = await check("ath", null);
    ctx.expect(!athletics.asked && (athletics.after === athletics.before), "Athlétisme : aucune question, aucun dé dépensé");
    const persuasion = await check("per", /^Ajouter|^Add/i);
    ctx.expect(!!persuasion.asked && (persuasion.cards[0]?.flags?.[MODULE_ID]?.rollBonus?.item === "commanding-presence"),
      `Autorité naturelle : la question au test de Persuasion (${persuasion.cards[0]?.flags?.[MODULE_ID]?.rollBonus?.item ?? "aucune carte"})`);

    // 3. En combat : l'initiative du Guerrier reçoit le dé d'Embuscade.
    await refill();
    await ctx.startCombat([fighter, bandit, cleric]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    let combat = await state();
    const cid = t => combat.combatants.find(x => x.tokenId === t.id)?.id;
    const ids0 = await known();
    await ctx.call("set-initiative", { combatantId: cid(fighter), value: 20, combatId: ctx.ownCombat });
    const initAsked = await answer(ids0, /^Ajouter|^Add/i, 8000);
    for ( const [t, v] of [[bandit, 10], [cleric, 5]] ) await ctx.call("set-initiative", { combatantId: cid(t), value: v, combatId: ctx.ownCombat });
    await pause(2000);
    combat = await state();
    const init = combat.combatants.find(x => x.tokenId === fighter.id)?.initiative;
    ctx.expect(!!initAsked && (init > 20) && (init <= 28), `Embuscade : initiative 20 → ${init}`);
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 3) && ((await current()) !== fighter.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    ctx.expect((await current()) === fighter.id, "tour du Guerrier");

    // 4. Frappe commandée : l'ordre au Clerc, son attaque payée par la Réaction, +1d8 s'il touche.
    const clericActor = await ctx.call("get-actor", { actorId: cleric.actorId });
    const weapon = (clericActor.items ?? []).find(i => (i.type === "weapon") && i.system?.equipped
      && Object.values(i.system?.activities ?? {}).some(a => (a.type === "attack") && (a.attack?.type?.value === "melee")));
    if ( ctx.expect(!!weapon, `le Clerc a une arme de corps à corps équipée (${weapon?.name})`) ) {
      const strike = await ctx.itemId(fighter.id, "commanders-strike");
      let commanded = null;
      for ( let n = 0; (n < 8) && !commanded; n++ ) {
        await tough(); await refill();
        const before = await spent();
        const u = await ctx.use({ tokenId: fighter.id, itemId: strike, targetTokenIds: [cleric.id], consume: true });
        await pause(2500);
        const order = (await ctx.engine("budget", { tokenId: cleric.id }))?.commanded ?? null;
        const flag = (await ctx.call("get-actor", { actorId: cleric.actorId })).flags?.[MODULE_ID]?.pendingDie ?? null;
        if ( n === 0 ) {
          ctx.expect(!!u.usageMessageId && ((await spent()) === before + 1), "Frappe commandée : un dé de supériorité dépensé");
          ctx.expect(!!order, "Frappe commandée : l'ordre est noté dans le budget du Clerc");
          ctx.expect(flag?.against === "any" && /d8/.test(flag?.formula ?? ""), `Frappe commandée : le dé promis au Clerc (${flag?.formula})`);
        }
        const b0 = await ctx.engine("budget", { tokenId: cleric.id });
        const since = await ctx.lastMessageId();
        const a = await ctx.use({ tokenId: cleric.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [bandit.id] });
        const r = await ctx.settle(a.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(2500);
        const b1 = await ctx.engine("budget", { tokenId: cleric.id });
        if ( n === 0 ) {
          ctx.expect((b0?.reaction ?? 1) > (b1?.reaction ?? 1) || (b1?.reactionUsed === true && !b0?.reactionUsed), `l'attaque du Clerc payée par sa Réaction (${JSON.stringify({ avant: b0?.reaction, après: b1?.reaction })})`);
          ctx.expect(b1?.action === b0?.action, `l'action du Clerc reste entière (${b0?.action} → ${b1?.action})`);
          ctx.expect(!b1?.commanded, "l'ordre est servi");
        }
        if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) {
          await ctx.call("update-actor", { actorId: cleric.actorId, actorData: { [`flags.${MODULE_ID}.-=pendingDie`]: null } }).catch(() => {});
          continue;
        }
        const msgs = await ctx.messagesSince(since);
        commanded = (msgs.find(m => m.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ");
      }
      if ( ctx.expect(commanded !== null, "Frappe commandée : le Clerc touche (8 essais au plus)") ) {
        ctx.expect(/1d8|2d8/.test(commanded), `Frappe commandée : +1d8 aux dégâts du Clerc (${commanded})`);
      }
      ctx.restore(() => ctx.call("update-actor", { actorId: cleric.actorId, actorData: { [`flags.${MODULE_ID}.-=pendingDie`]: null } }).catch(() => {}));
    }

    // 5. Chassé-croisé : le Guerrier et le Clerc échangent leurs places, le dé à la CA du Clerc.
    await place(); await refill();
    ctx.restore(() => ctx.removeEffectsNamed(cleric, /Chassé|Bait/i));
    ctx.restore(() => ctx.removeEffectsNamed(fighter, /Chassé|Bait/i));
    const ac0 = (await ctx.engine("stats", { tokenId: cleric.id }))?.ac ?? null;
    const before = await spent();
    const ids1 = await known();
    await ctx.use({ tokenId: fighter.id, itemId: await ctx.itemId(fighter.id, "bait-and-switch"), targetTokenIds: [cleric.id], consume: true });
    const who = await answer(ids1, /^Clerc/i, 10000);
    await pause(3000);
    const f1 = await ctx.position(fighter), c1 = await ctx.position(cleric);
    ctx.expect((f1.x === g.x + grid) && (f1.y === g.y - grid) && (c1.x === g.x) && (c1.y === g.y), `Chassé-croisé : places échangées (Guerrier ${f1.x},${f1.y} ; Clerc ${c1.x},${c1.y})`);
    const ac1 = (await ctx.engine("stats", { tokenId: cleric.id }))?.ac ?? null;
    ctx.expect(!!who && (ac1 > ac0) && (ac1 - ac0 <= 8), `Chassé-croisé : CA du Clerc ${ac0} → ${ac1}`);
    ctx.expect((await spent()) === before + 1, "Chassé-croisé : un dé de supériorité dépensé");

    // 6. Balayage : un coup qui touche le Bandit — le dé au Zombi (CA 8).
    await place();
    await lend("phbmnvSweepingAt");
    await pause(1200);
    await ctx.setHp(zombie, 100);
    let swept = null;
    for ( let n = 0; (n < 15) && !swept; n++ ) {
      await tough(); await refill();
      const before = await spent();
      const z0 = await ctx.hp(zombie);
      const ids = await known();
      const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
      await answer(ids, /^Garder|^Keep/i, 4000);   // un coup raté : l'Attaque précise n'est pas prise
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) continue;
      const asked = await answer(ids, /^Zombi/i, 10000);
      await pause(2500);
      swept = { asked, before, after: await spent(), z0, z1: await ctx.hp(zombie) };
    }
    if ( ctx.expect(!!swept, "Balayage : le Guerrier touche le Bandit (15 essais au plus)") ) {
      ctx.expect(!!swept.asked, `Balayage : la question propose le Zombi (${(swept.asked?.labels ?? []).join(", ")})`);
      ctx.expect((swept.z1 < swept.z0) && (swept.z0 - swept.z1 <= 8), `Balayage : le Zombi perd le dé (${swept.z0} → ${swept.z1})`);
      ctx.expect(swept.after === swept.before + 1, `Balayage : un dé de supériorité dépensé (${swept.before} → ${swept.after})`);
    }
  }
};
