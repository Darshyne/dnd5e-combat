/**
 * §95 — Sous-classes de Ravenloft (module premium `dnd-ravenloft-horrors-within`, pack `options`), aptitudes prêtées aux personnages de
 * l'arène :
 *  - Patron Mort-vivant (Occultiste) : Forme d'effroi, puis un coup — l'Avatar terrifiant proposé, Sagesse, Effrayé ⇔ ratée ;
 *    Cosse nécrotique : à 0 PV, la question, l'émanation (Constitution des ennemis), PV = 2 × niveau d'Occultiste, 1 Épuisement.
 *  - Sorcellerie de l'ombre (Ensorceleur) : à 0 PV, Force du tombeau — Charisme contre DD 5 + dégâts ; réussie : PV = Charisme + niveau.
 *  - Fantôme (Roublard) : une Attaque sournoise sur le Bandit — les Lamentations proposées, le Zombi choisi, dégâts nécrotiques ;
 *    Marche fantôme : l'attaque du Bandit contre lui au Désavantage.
 *  - Gardien creux (Rôdeur) : Courroux sauvage ; au début de son tour, l'Aura troublante sur le Bandit ; Courroux persistant à 0 PV.
 */
const MODULE_ID = "dnd5e-combat";
const RHW = "dnd-ravenloft-horrors-within.options";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Sous-classes de Ravenloft — Patron Mort-vivant, Sorcellerie de l'ombre, Fantôme, Gardien creux",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Occultiste", "Ensorceleur", "Roublard", "Rôdeur", "Bandit", "Zombi", "Guerrier"];
    if ( !need.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(RHW) ) { ctx.log("module Ravenloft absent : non applicable"); return; }
    const T = {};
    for ( const n of need ) T[n] = await ctx.token(n);
    const grid = await ctx.gridSize();
    for ( const t of Object.values(T) ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const bandit = T.Bandit, zombie = T.Zombi;
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const lend = async (t, id) => {
      const uuid = `Compendium.${RHW}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: r.id }).catch(() => {}));
      await pause(1000);
      return r.id;
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
    const statuses = async t => (await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const actorOf = t => ctx.call("get-actor", { actorId: t.actorId });
    const clear = async t => { for ( const s of ["frightened", "unconscious", "prone", "incapacitated", "dead"] ) await ctx.removeStatusEffects(t, s); };
    const place = async (t, dx, dy, ref) => { const p = await ctx.position(ref); await ctx.call("move-token", { tokenId: t.id, x: p.x + dx * grid, y: p.y + dy * grid, elevation: 0 }); };
    /** Tombe à 0 PV ; répond à la question (« Oui ») ; rend ce qu'on lit ensuite. */
    const drop = async t => {
      await ctx.setHp(t, 6);
      await ctx.call("update-actor", { actorId: t.actorId, actorData: { "system.attributes.hp.temp": 0 } }).catch(() => {});   // des PV temporaires absorberaient la chute
      await clear(t);
      const ids = await known();
      const since = await ctx.lastMessageId();
      await ctx.engine("hurt", { tokenId: t.id, amount: 6 });   // pile à 0 : pas de mort sur le coup (excédent ≥ PV max)
      const asked = await answer(ids, /^Oui|^Yes/i, 9000);
      await pause(6000);
      return { asked, since, hp: await ctx.hp(t), st: await statuses(t) };
    };

    // 1. Patron Mort-vivant.
    const warlock = T.Occultiste;
    await place(bandit, 1, 0, warlock);
    await place(zombie, 0, 1, warlock);
    await pause(800);
    const dread = await lend(warlock, "rhwUPFormofDreOJ");
    const fu = await ctx.use({ tokenId: warlock.id, itemId: dread, activityId: "sjAc47PXRIIRKS0u", targetTokenIds: [warlock.id] });
    await pause(800);
    // Le connecteur coupe l'enchaînement de dnd5e : le jet de PV temporaires se lance par la carte.
    if ( fu.usageMessageId ) await ctx.engine("rollCard", { messageId: fu.usageMessageId }).catch(() => null);
    await pause(2500);
    ctx.expect((await ctx.effects(warlock)).some(e => !e.disabled && /Dread|effroi/i.test(e.name ?? "")), "Forme d'effroi : l'effet sur l'Occultiste");
    let frightful = null;
    for ( let n = 0; (n < 12) && !frightful; n++ ) {
      await tough(); await clear(bandit);
      const ids = await known();
      const u = await ctx.use({ tokenId: warlock.id, identifier: "eldritch-blast", targetTokenIds: [bandit.id] }).catch(() => null);
      if ( !u?.usageMessageId ) break;
      const asked = await answer(ids, /Forme|Dread|effroi/i, 6000);
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( !asked || (r?.targets?.find(t => t.name === "Bandit")?.hit !== true) ) continue;
      await pause(3000);
      const save = (await ctx.messagesSince(u.usageMessageId)).find(m => (m.type === "usage") && (m.id !== u.usageMessageId) && m.flags?.[MODULE_ID]?.resolution);
      frightful = save ? await ctx.settle(save.id, { timeoutMs: 45000 }).catch(() => null) : null;
    }
    if ( ctx.expect(!!frightful, "Avatar terrifiant : proposé au coup qui touche, sa sauvegarde jouée") ) {
      const t = frightful.targets?.find(x => x.name === "Bandit");
      await pause(1200);
      ctx.expect(frightful.plan?.save?.ability === "wis" && ((await statuses(bandit)).includes("frightened") === (t?.save?.success === false)), `Sagesse du Bandit (${t?.save?.total}), Effrayé ⇔ ratée`);
    }
    await clear(bandit);
    await ctx.removeEffectsNamed(warlock, /Dread|effroi/i);
    await lend(warlock, "rhwUPNecroticHYI");
    const exh0 = (await actorOf(warlock)).system?.attributes?.exhaustion ?? 0;
    ctx.restore(() => ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.attributes.exhaustion": exh0 } }).catch(() => {}));
    const lvl = ((await actorOf(warlock)).items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "warlock"))?.system?.levels ?? 1;
    const husk = await drop(warlock);
    ctx.expect(!!husk.asked, "Cosse nécrotique : la question à 0 PV");
    ctx.expect(husk.hp === 2 * lvl, `PV = 2 × niveau d'Occultiste (${husk.hp}, niveau ${lvl})`);
    ctx.expect(((await actorOf(warlock)).system?.attributes?.exhaustion ?? 0) === exh0 + 1, "un niveau d'Épuisement");
    const burst = (await ctx.messagesSince(husk.since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resolution);
    const br = burst ? await ctx.settle(burst.id, { timeoutMs: 45000 }).catch(() => null) : null;
    const names = (br?.targets ?? []).map(t => t.name);
    ctx.expect(br?.plan?.save?.ability === "con" && names.includes("Bandit") && !names.includes("Occultiste"), `l'émanation : Constitution de ${names.join(", ")}`);

    // 2. Sorcellerie de l'ombre : Force du tombeau.
    const sorcerer = T.Ensorceleur;
    await lend(sorcerer, "rhwSSPowerofShNG");
    const grave = await drop(sorcerer);
    ctx.expect(!!grave.asked, "Force du tombeau : la question à 0 PV");
    const saveMsg = (await ctx.messagesSince(grave.since)).find(m => m.type === "save");
    const total = saveMsg?.rolls?.[0]?.total;
    const dc = Number(/DD (\d+)|DC (\d+)/.exec(saveMsg?.flavor ?? "")?.slice(1).find(Boolean));
    ctx.expect(Number.isFinite(total) && (dc === 11), `Charisme contre DD 5 + 6 dégâts (${total} contre ${dc})`);
    ctx.expect((total >= dc) ? (grave.hp > 0) : ((grave.hp === 0) && grave.st.includes("unconscious")), `${total >= dc ? "relevé" : "tombé"} (${grave.hp} PV, ${grave.st.join(", ") || "aucun état"})`);

    // 3. Fantôme.
    const rogue = T.Roublard;
    await place(bandit, 1, 0, rogue);
    await place(T.Guerrier, 2, 0, rogue);
    await place(zombie, 1, 2, rogue);
    await pause(800);
    await lend(rogue, "rhwPRWailsfromLz");
    let wailed = null;
    for ( let n = 0; (n < 12) && !wailed; n++ ) {
      await tough();
      await ctx.setHp(zombie, 100);
      const z0 = await ctx.hp(zombie);
      const ids = await known();
      const u = await ctx.use({ tokenId: rogue.id, identifier: "shortsword", activityType: "attack", targetTokenIds: [bandit.id] });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) continue;
      const asked = await answer(ids, /^Zombi/i, 9000);
      await pause(5000);
      if ( asked ) wailed = { z0, z1: await ctx.hp(zombie), since: u.usageMessageId };
    }
    if ( ctx.expect(!!wailed, "Lamentations d'outre-tombe : proposées après l'Attaque sournoise, le Zombi choisi") ) {
      const dmg = (await ctx.messagesSince(wailed.since)).filter(m => m.type === "damage").at(-1);
      ctx.expect(wailed.z1 < wailed.z0, `le Zombi subit des dégâts nécrotiques (${wailed.z0} → ${wailed.z1}, ${(dmg?.rolls ?? []).map(x => x.formula).join(" | ")})`);
    }
    const ghost = await lend(rogue, "rhwPRGhostWalkKY");
    await ctx.use({ tokenId: rogue.id, itemId: ghost, activityId: "8LWWIsoryEczdfnd", targetTokenIds: [rogue.id] });
    await pause(2500);
    ctx.restore(() => ctx.removeEffectsNamed(rogue, /Ghost|fantôme/i));
    const since3 = await ctx.lastMessageId();
    await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [rogue.id] });
    await pause(4000);
    const atk = (await ctx.messagesSince(since3)).find(m => m.type === "attack");
    ctx.expect(atk?.rolls?.[0]?.options?.advantageMode === -1, `Marche fantôme : l'attaque contre le Roublard au Désavantage (mode ${atk?.rolls?.[0]?.options?.advantageMode})`);

    // 4. Gardien creux.
    const ranger = T["Rôdeur"];
    await place(bandit, 1, 0, ranger);
    await pause(800);
    const wrath = await lend(ranger, "rhwHWWrathofth3C");
    await lend(ranger, "rhwHWAncientMibA");
    // `api.mcp.use` : l'enchantement « sur soi » se pose dans les actions enchaînées de dnd5e, que le connecteur coupe.
    await ctx.engine("use", { tokenId: ranger.id, itemId: wrath, activityType: "enchant" }).catch(err => ctx.log(`transformation : ${err.message}`));
    await pause(2500);
    const transformed = ((await actorOf(ranger)).items ?? []).find(i => i._id === wrath)?.effects?.some(e => (e.type === "enchantment") && !e.disabled);
    ctx.log(`Courroux sauvage : enchantement ${transformed ? "actif" : "absent"}`);
    await ctx.startCombat([ranger, bandit]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [t, v] of [[bandit, 20], [ranger, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 3) && ((await current()) !== bandit.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    const since4 = await ctx.lastMessageId();
    await ctx.nextTurn(); await pause(4500);   // début du tour du Rôdeur
    const aura = (await ctx.messagesSince(since4)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.moment === "ownTurnStart"));
    if ( ctx.expect(!!aura, "Aura troublante : au début du tour du Rôdeur") ) {
      const r = await ctx.settle(aura.id, { timeoutMs: 45000 }).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Bandit");
      await pause(1200);
      ctx.expect(r?.plan?.save?.ability === "wis" && ((await statuses(bandit)).includes("frightened") === (t?.save?.success === false)), `Sagesse du Bandit (${t?.save?.total}), Effrayé ⇔ ratée`);
    }
    const rl = ((await actorOf(ranger)).items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "ranger"))?.system?.levels ?? 1;
    const persist = await drop(ranger);
    ctx.expect(!!persist.asked && (persist.hp === 2 * rl), `Courroux persistant : la question à 0 PV, PV = 2 × niveau de Rôdeur (${persist.hp})`);
  }
};
