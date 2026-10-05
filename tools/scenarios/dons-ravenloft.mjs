/**
 * §94 — Dons et traits d'espèce de Ravenloft (module premium `dnd-ravenloft-horrors-within`, pack `options`), prêtés au Guerrier.
 *  - Cri surnaturel (Murmures rassemblés) : le Bandit attaque, la réaction est prise d'office — CA + maîtrise contre cette attaque.
 *  - Symbiose entretenue (Être symbiotique) : Terreur du Magicien jusqu'à une sauvegarde ratée — la question, un dé de vie dépensé.
 *  - Se ressaisir (Survivant) : même chose, contre Effrayé — la question, l'utilisation dépensée.
 *  - Savoir d'une vie passée (Né-de-nouveau) : un test, la question, +1d6.
 *  - Hurlement (Lupin) : le Bandit (ennemi) fait sa sauvegarde, pas le Clerc (allié) ; raté : ses attaques au Désavantage.
 *  - Bond féroce (Lupin) : un coup à mains nues qui touche — la Bousculade proposée, Force ou Dextérité, À terre ⇔ ratée.
 *  - Chercher (Guetteurs + Œil vif) : le test de Perception avec +1d4 et l'Avantage.
 */
const MODULE_ID = "dnd5e-combat";
const RHW = "dnd-ravenloft-horrors-within.options";
const FEAR = "Compendium.dnd-players-handbook.spells.Item.phbsplFear000000";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Dons et espèces de Ravenloft — Cri surnaturel, Symbiose, Survivant, Savoir d'une vie passée, Hurlement, Bond féroce, Chercher",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit", "Clerc", "Magicien"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Bandit, Clerc ou Magicien absent : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(RHW) ) { ctx.log("module Ravenloft absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const cleric = await ctx.token("Clerc");
    const mage = await ctx.token("Magicien");
    const grid = await ctx.gridSize();
    for ( const t of [fighter, bandit, cleric, mage] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
    }
    const hp0 = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const g = await ctx.position(fighter);
    await ctx.call("move-token", { tokenId: bandit.id, x: g.x + grid, y: g.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: cleric.id, x: g.x - grid, y: g.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: mage.id, x: g.x, y: g.y + 4 * grid, elevation: 0 });
    await pause(800);

    const lend = async id => {
      const uuid = `Compendium.${RHW}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      const remove = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: r.id }).catch(() => {});
      ctx.restore(remove);
      await pause(1000);
      return { id: r.id, remove };
    };
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
    const actor = async () => ctx.call("get-actor", { actorId: fighter.actorId });
    const bonusCards = (msgs, item) => msgs.filter(m => m.flags?.[MODULE_ID]?.rollBonus?.item === item);
    const clearFighter = async () => { for ( const s of ["frightened", "prone"] ) await ctx.removeStatusEffects(fighter, s); await ctx.removeEffectsNamed(fighter, /Terreur|Fear|Effray/i); };
    ctx.restore(clearFighter);

    // 1. Cri surnaturel.
    const whispers = await lend("rhwGatheredWhisp");
    const ac0 = (await ctx.engine("stats", { tokenId: fighter.id }))?.ac;
    let screamed = null;
    for ( let n = 0; (n < 20) && !screamed; n++ ) {
      await ctx.setHp(fighter, hp0);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [fighter.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const reacted = (await ctx.messagesSince(since)).some(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.reaction);
      if ( reacted ) screamed = r;
    }
    if ( ctx.expect(!!screamed, "Cri surnaturel : la réaction à un coup (20 attaques au plus)") ) {
      const t = screamed.targets?.find(x => x.name === "Guerrier");
      ctx.expect(Number.isFinite(t?.ac) && (t.ac > ac0) && (t.hit === (screamed.attack?.roll?.total >= t.ac)), `CA ${ac0} → ${t?.ac} contre cette attaque (${screamed.attack?.roll?.total} : ${t?.hit ? "touché" : "raté"})`);
    }
    await whispers.remove();

    // 2 et 3. Symbiose, puis Survivant : Terreur jusqu'à une sauvegarde ratée.
    const fear = await ctx.ensureItem(mage, FEAR);
    const failFear = async (re, ms) => {
      for ( let n = 0; n < 20; n++ ) {
        await clearFighter();
        const ids = await known();
        const since = await ctx.lastMessageId();
        const box = await ctx.box(fighter);
        const u = await ctx.use({ tokenId: mage.id, itemId: fear, activityType: "save", area: { shape: "circle", x: box.x + box.width / 2, y: box.y + box.height / 2, radius: grid / 2 } });
        if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
        const asked = await answer(ids, re, ms);
        await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        if ( asked ) return { since, asked };
      }
      return null;
    };
    const symb = await lend("rhwSymbioticBein");
    const hdSpent = async () => ((await actor()).items ?? []).filter(i => i.type === "class").reduce((n, i) => n + (Number(i.system?.hd?.spent) || 0), 0);
    // Le dé de vie dépensé n'est pas suivi par le filet de sécurité : remis ici, avant et après.
    const classes = ((await actor()).items ?? []).filter(i => i.type === "class").map(i => ({ id: i._id, spent: Number(i.system?.hd?.spent) || 0 }));
    const setHd = async spent => { for ( const c of classes ) await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.hd.spent": spent ?? c.spent }, match: { path: "_id", value: c.id } }); };
    ctx.restore(() => setHd(null));
    await setHd(0);
    const hd0 = await hdSpent();
    const s1 = await failFear(/^Ajouter|^Add/i, 6000);
    if ( ctx.expect(!!s1, "Symbiose : la question à une sauvegarde ratée") ) {
      const cards = bonusCards(await ctx.messagesSince(s1.since), "symbiotic-being");
      ctx.expect(cards.length === 1 && /d(6|8|10|12)/.test(s1.asked.labels.join(" ")), `un dé de vie lancé (${s1.asked.labels.join(", ")})`);
      const hd1 = await hdSpent();
      ctx.expect(hd1 === hd0 + 1, `un dé de vie dépensé (dépensés ${hd0} → ${hd1})`);
    }
    await symb.remove();
    const surv = await lend("rhwSurvivor2zrM3");
    const s2 = await failFear(/^Ajouter|^Add/i, 6000);
    if ( ctx.expect(!!s2, "Survivant : la question à une sauvegarde ratée contre Effrayé") ) {
      const cards = bonusCards(await ctx.messagesSince(s2.since), "survivor-ravenloft");
      ctx.expect(cards.length === 1, "Se ressaisir : + bonus de maîtrise");
      const item = (await actor()).items.find(i => i._id === surv.id);
      const act = Object.values(item?.system?.activities ?? {}).find(x => x._id === "9wAIIWcBr8lwp7Rm");
      ctx.log(`utilisations de l'activité : max « ${act?.uses?.max ?? ""} », dépensées ${act?.uses?.spent ?? 0} (sans maximum dans la donnée : rien à décompter)`);
    }
    await surv.remove();
    await clearFighter();

    // 4. Savoir d'une vie passée.
    const past = await lend("rhwKnowledgefraL");
    const ids4 = await known();
    const since4 = await ctx.lastMessageId();
    await ctx.engine("rollCheck", { tokenId: fighter.id, skill: "ath" });
    const asked4 = await answer(ids4, /^Ajouter|^Add/i, 8000);
    await pause(1500);
    ctx.expect(!!asked4 && bonusCards(await ctx.messagesSince(since4), "knowledge-from-a-past-life").length === 1, "Savoir d'une vie passée : +1d6 proposé et lancé");
    await past.remove();

    // 5. Hurlement.
    const howl = await lend("rhwHowlA3f2I58L3");
    let howled = false;
    for ( let n = 0; (n < 12) && !howled; n++ ) {
      await ctx.removeEffectsNamed(bandit, /Disadvantage|Désavantage|Hurlement|Howl/i);
      const fb = await ctx.box(fighter);
      // Le connecteur ne pose pas le gabarit (au clic, la zone de 4,50 m se pose sur le Guerrier) : posé ici.
      const u = await ctx.use({ tokenId: fighter.id, itemId: howl.id, activityType: "save", area: { shape: "circle", x: fb.x + fb.width / 2, y: fb.y + fb.height / 2, radius: 3.5 * grid } });
      if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( n === 0 ) {
        const names = (r?.targets ?? []).map(t => t.name);
        ctx.expect(names.includes("Bandit") && !names.includes("Clerc"), `Hurlement : le Bandit visé, pas le Clerc (${names.join(", ")})`);
      }
      await pause(1200);
      howled = (await ctx.effects(bandit)).some(e => !e.disabled && /Disadvantage|Désavantage|Hurlement|Howl/i.test(e.name ?? ""));
    }
    ctx.restore(() => ctx.removeEffectsNamed(bandit, /Disadvantage|Désavantage|Hurlement|Howl/i));
    if ( ctx.expect(howled, "le Bandit rate sa sauvegarde (12 essais au plus)") ) {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [cleric.id] });
      await pause(4000);
      const attack = (await ctx.messagesSince(since)).find(m => m.type === "attack");
      ctx.expect(attack?.rolls?.[0]?.options?.advantageMode === -1, `son attaque au Désavantage (mode ${attack?.rolls?.[0]?.options?.advantageMode})`);
    }
    await ctx.removeEffectsNamed(bandit, /Disadvantage|Désavantage|Hurlement|Howl/i);
    await howl.remove();

    // 6. Bond féroce.
    const pounce = await lend("rhwFeralPounce7E");
    let shoved = null;
    for ( let n = 0; (n < 15) && !shoved; n++ ) {
      await tough(); await ctx.removeStatusEffects(bandit, "prone");
      const ids = await known();
      const u = await ctx.use({ tokenId: fighter.id, itemId: pounce.id, activityId: "UABX8SgYYrOxVNFW", targetTokenIds: [bandit.id] });
      const asked = await answer(ids, /Bond|Feral|Pounce/i, 6000);
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( (r?.targets?.find(t => t.name === "Bandit")?.hit !== true) || !asked ) continue;
      await pause(3000);
      const msgs = await ctx.messagesSince(u.usageMessageId);
      const save = msgs.find(m => (m.type === "usage") && (m.id !== u.usageMessageId) && m.flags?.[MODULE_ID]?.resolution);
      shoved = save ? await ctx.settle(save.id, { timeoutMs: 45000 }).catch(() => null) : null;
    }
    ctx.restore(() => ctx.removeStatusEffects(bandit, "prone"));
    if ( ctx.expect(!!shoved, "Bond féroce : la Bousculade proposée au coup qui touche, sa sauvegarde jouée") ) {
      const t = shoved.targets?.find(x => x.name === "Bandit");
      await pause(1200);
      const prone = (await ctx.effects(bandit)).some(e => !e.disabled && (e.statuses ?? []).includes("prone"));
      ctx.expect(["str", "dex"].includes(shoved.plan?.save?.ability) && (prone === (t?.save?.success === false)), `${shoved.plan?.save?.ability} du Bandit (${t?.save?.total}), À terre ⇔ ratée`);
    }
    await pounce.remove();

    // 7. Chercher, avec Guetteurs (+1d4) et Œil vif (Avantage).
    await lend("rhwWatchersGH8OL");
    await lend("rhwSharpEyev8PBf");
    await ctx.startCombat([fighter, bandit]);
    await pause(2000);
    const search = (await actor()).items.find(i => i.flags?.[MODULE_ID]?.basicAction === "search");
    if ( ctx.expect(!!search, "le Guerrier a l'action Chercher") ) {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: fighter.id, itemId: search._id, activityType: "utility" }).catch(() => ctx.use({ tokenId: fighter.id, itemId: search._id }));
      await pause(3500);
      const check = (await ctx.messagesSince(since)).find(m => m.type === "check");
      const formula = (check?.rolls ?? []).map(x => x.formula).join(" | ");
      ctx.expect(/1d4/.test(formula) && /kh|adv/.test(formula), `Perception de la fouille : +1d4 et Avantage (${formula})`);
    }
  }
};
