/**
 * L'Ensorceleur du Manuel des joueurs 2024 (SPEC §32), monde `dnd-6`. L'Ensorceleur passe un temps niveau 5 et reçoit, prêtés
 * depuis le compendium du Manuel des joueurs, la Réserve arcanique et les options de Métamagie ; le Bandit reçoit 300 PV. Vérifie :
 *  - Sorcellerie innée : active, l'Éclair de feu a l'Avantage ;
 *  - Sort accéléré : deux points dépensés, l'Éclair de feu (une action) se paie de l'action Bonus, l'action reste ; l'option oubliée ;
 *  - Sort intensifié : Mains brûlantes sur le Bandit — sa sauvegarde a le Désavantage ;
 *  - Sort prévenant : Mains brûlantes sur le Guerrier et le Bandit — le Guerrier réussit d'office et ne perd rien ;
 *  - Sort subtil : un Mage hostile à portée, pas de fenêtre de Contresort.
 * Remet niveau, positions, PV, points, états ; retire les items prêtés.
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
  name: "ensorceleur — Sorcellerie innée, Sorts accéléré, intensifié, prévenant, subtil",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Ensorceleur", "Bandit", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const sorc = await ctx.token("Ensorceleur");
    const bandit = await ctx.token("Bandit");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [sorc, bandit, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    // Restored Keep, 3080 × 4900 : loin de tout hostile (sa case d'origine touche l'Âme-en-peine : Désavantage à distance).
    const g = { x: 3080, y: 4900 };

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
      const r = await ctx.call("upsert-actor-item", { actorId: sorc.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: sorc.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const cls = await ctx.itemId(sorc.id, "sorcerer");
    const actor0 = await ctx.call("get-actor", { actorId: sorc.actorId });
    const level0 = actor0.items.find(i => i._id === cls)?.system?.levels ?? 1;
    ctx.restore(() => ctx.call("upsert-actor-item", { actorId: sorc.actorId, itemData: { "system.levels": level0 }, match: { path: "_id", value: cls } }).catch(() => {}));
    await ctx.call("upsert-actor-item", { actorId: sorc.actorId, itemData: { "system.levels": 5 }, match: { path: "_id", value: cls } });
    const font = await lend("phbscrFontOfMagi");
    const quick = await lend("phbmmoQuickenedS");
    const careful = await lend("phbmmoCarefulSpe");
    const heightened = await lend("phbmmoHeightened");
    const subtle = await lend("phbmmoSubtleSpel");
    const refill = () => ctx.call("upsert-actor-item", { actorId: sorc.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: font } });
    const spentPoints = async () => ((await ctx.call("get-actor", { actorId: sorc.actorId })).items ?? []).find(i => i._id === font)?.system?.uses?.spent ?? null;
    const pending = async () => (await ctx.call("get-actor", { actorId: sorc.actorId })).flags?.[MODULE_ID]?.metamagic?.kinds ?? [];
    const innate = await ctx.itemId(sorc.id, "innate-sorcery");
    const bolt = await ctx.itemId(sorc.id, "fire-bolt");
    const hands = await ctx.itemId(sorc.id, "burning-hands");

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Sorcellerie innée|Innate Sorcery/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
      await refill();
      await ctx.call("update-actor", { actorId: sorc.actorId, actorData: { [`flags.${MODULE_ID}.-=metamagic`]: null } }).catch(() => {});
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async () => {
      await ctx.startCombat([sorc, bandit]);
      const combat = await state();
      for ( const [t, v] of [[sorc, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== sorc.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === sorc.id;
    };
    const budget = () => ctx.engine("budget", { tokenId: sorc.id });
    const metamagic = async itemId => { await ctx.use({ tokenId: sorc.id, itemId, consume: true, usageConfig: { [MODULE_ID]: { confirmed: true } } }); await pause(1500); };
    const boltFormula = async (usage={ confirmed: true }) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: sorc.id, itemId: bolt, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: usage } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1000);
      return (await ctx.messagesSince(since)).find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "";
    };
    /** Mains brûlantes : zone posée sur `boxes` ; rend la résolution et les messages. */
    const burn = async (...targets) => {
      const boxes = [];
      for ( const t of targets ) boxes.push(await ctx.box(t));
      const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
      const w = Math.max(...boxes.map(b => b.x + b.width)) - x, h = Math.max(...boxes.map(b => b.y + b.height)) - y;
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: sorc.id, itemId: hands, activityType: "save", area: { shape: "rectangle", x, y, width: w, height: h }, usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
      if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      return { r, msgs: await ctx.messagesSince(since) };
    };

    await part("Sorcellerie innée", async () => {
      await tough(); await place(sorc, g.x, g.y); await place(bandit, g.x, g.y + 2 * grid);
      const before = await boltFormula();
      ctx.expect(!/adv|kh/.test(before), `sans : ${before}`);
      await ctx.use({ tokenId: sorc.id, itemId: innate, usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await pause(2000);
      const after = await boltFormula();
      ctx.expect(/adv|kh/.test(after), `Sorcellerie innée active : ${after}`);
    });

    await part("Sort accéléré", async () => {
      await tough(); await place(sorc, g.x, g.y); await place(bandit, g.x, g.y + 2 * grid);
      if ( !ctx.expect(await fight(), "combat : au tour de l'Ensorceleur") ) return;
      await metamagic(quick);
      ctx.expect((await spentPoints()) === 2 && (await pending()).includes("quickened"), `option retenue (${(await pending()).join(", ")}), ${await spentPoints()} points dépensés`);
      await boltFormula({});
      const b = await budget();
      ctx.expect(b?.bonus === 0 && b?.action === 1, `Éclair de feu : action Bonus ${b?.bonus}, action ${b?.action}`);
      ctx.expect(!(await pending()).length, `option oubliée après le sort (${(await pending()).join(", ") || "rien"})`);
    });

    await part("Sort intensifié", async () => {
      await tough(); await place(sorc, g.x, g.y); await place(bandit, g.x, g.y + grid);
      await metamagic(heightened);
      const { r, msgs } = await burn(bandit);
      const save = msgs.find(m => (m.type === "save") && (m.alias === "Bandit"));
      const formula = save?.rolls?.[0]?.formula ?? "";
      ctx.expect(!!r?.targets?.find(t => t.name === "Bandit")?.save && /dis|kl/.test(formula), `sauvegarde du Bandit : ${formula}`);
    });

    await part("Sort prévenant", async () => {
      await tough(); await place(sorc, g.x, g.y);
      await place(fighter, g.x, g.y + grid);
      await place(bandit, g.x, g.y + 2 * grid);
      const f0 = await ctx.hp(fighter);
      await metamagic(careful);
      const { r } = await burn(fighter, bandit);
      const tf = r?.targets?.find(t => t.name === "Guerrier");
      ctx.expect(tf?.save?.auto === "sculpted" && ((await ctx.hp(fighter)) === f0), `Guerrier épargné : ${JSON.stringify(tf?.save)}, PV ${f0} → ${await ctx.hp(fighter)}`);
      ctx.expect(!!r?.targets?.find(t => t.name === "Bandit")?.save?.total, "le Bandit fait sa sauvegarde");
    });

    await part("Sort subtil", async () => {
      const mage = tokens.find(t => t.name === "Mage");
      if ( !mage ) { ctx.log("pas de Mage hostile : partie non applicable"); return; }
      await tough(); await place(sorc, g.x, g.y); await place(bandit, g.x, g.y + 2 * grid);
      await metamagic(subtle);
      const ids = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      await boltFormula({});
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 3000, details: true }).catch(() => null);
      const counter = (r?.windows ?? []).filter(d => /Contresort|Counterspell|réag/i.test(`${d.title} ${d.content ?? d.text ?? ""}`));
      for ( const d of r?.windows ?? [] ) await ctx.call("answer-dialog", { id: d.id, button: (d.buttons ?? []).at(-1)?.action ?? "none" }).catch(() => {});
      ctx.expect(!counter.length, `Sort subtil : pas de fenêtre de Contresort (${counter.length})`);
    });
  }
};
