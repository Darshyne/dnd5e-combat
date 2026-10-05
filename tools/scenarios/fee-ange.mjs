/**
 * §92 — Foulée des fées et Échappatoire brumeuse (Protecteur Archifée), Ange vengeur (Serment de vengeance). Prêtés depuis le compendium
 * du Manuel des joueurs, avec la Foulée brumeuse.
 *  - L'Occultiste se téléporte (`api.mcp.teleport`, la validation du moteur) : la question des effets de plus ; Foulée narquoise sur le
 *    Bandit resté à côté de la case quittée (Sagesse, « Narguée » ⇔ ratée ; il attaque alors le Clerc au Désavantage, l'Occultiste
 *    sans) ; Foulée effroyable à l'arrivée (Sagesse, 2d10 psychiques ⇔ ratée) ; Foulée revigorante (PV temporaires) ; Foulée
 *    évanescente (Invisible).
 *  - Le Paladin devient Ange vengeur ; le Bandit commence son tour dans l'aura : Sagesse, Effrayé ⇔ ratée ; l'attaque du Paladin
 *    contre lui a l'Avantage ; blessé, il n'est plus Effrayé.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "Compendium.dnd-players-handbook.classes.Item";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Foulée des fées, Échappatoire brumeuse, Ange vengeur",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Occultiste", "Bandit", "Clerc", "Paladin"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Occultiste, Bandit, Clerc ou Paladin absent : non applicable"); return; }
    const warlock = await ctx.token("Occultiste");
    const bandit = await ctx.token("Bandit");
    const cleric = await ctx.token("Clerc");
    const paladin = await ctx.token("Paladin");
    const grid = await ctx.gridSize();
    for ( const t of [warlock, bandit, cleric, paladin] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
    }
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const lend = async (token, uuid) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: token.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: token.actorId, itemId: r.id }).catch(() => {}));
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
    const named = async (t, re) => (await ctx.effects(t)).filter(e => !e.disabled && re.test(e.name ?? ""));
    const clear = async () => {
      await ctx.removeEffectsNamed(bandit, /Nargu|Taunt|Effray|Frighten/i);
      await ctx.removeEffectsNamed(warlock, /évanescente|Disappear|Invisible/i);
      await ctx.removeStatusEffects(bandit, "frightened");
      await ctx.removeStatusEffects(warlock, "invisible");
    };
    ctx.restore(clear);
    const temp0 = (await ctx.call("get-actor", { actorId: warlock.actorId })).system?.attributes?.hp?.temp ?? 0;
    ctx.restore(() => ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.attributes.hp.temp": temp0 } }).catch(() => {}));

    // 1. Foulée des fées.
    await lend(warlock, `${CLASSES}.phbwlkStepsOfThe`);
    await lend(warlock, `${CLASSES}.phbwlkMistyEscap`);
    const misty = await ctx.ensureItem(warlock, `${SPELLS}.phbsplMistyStep0`);
    await pause(1200);
    const w0 = await ctx.position(warlock);
    const home = async () => {
      await ctx.call("move-token", { tokenId: warlock.id, x: w0.x, y: w0.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: bandit.id, x: w0.x + grid, y: w0.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: cleric.id, x: w0.x + grid, y: w0.y + grid, elevation: 0 });
      await pause(800);
    };
    /** Se téléporte à 4 cases à l'ouest (ou à côté du Bandit : `near`) et choisit l'option ; rend ce qu'a vu la question. */
    const step = async (re, { near=false }={}) => {
      await home(); await tough(); await clear();
      const ids = await known();
      const since = await ctx.lastMessageId();
      const to = near ? { x: w0.x + 2 * grid, y: w0.y } : { x: w0.x - 4 * grid, y: w0.y };
      if ( near ) await ctx.call("move-token", { tokenId: warlock.id, x: w0.x - 4 * grid, y: w0.y, elevation: 0 });
      const r = await ctx.engine("teleport", { tokenId: warlock.id, itemId: misty, ...to });
      const asked = await answer(ids, re);
      await pause(1500);
      const msg = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resolution);
      const res = msg ? await ctx.settle(msg.id, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      return { accepted: r?.accepted, asked, res, since };
    };

    // Foulée narquoise : jusqu'à un échec du Bandit.
    let taunted = null;
    for ( let n = 0; (n < 12) && !taunted; n++ ) {
      const s = await step(/narquoise|Taunting/i);
      if ( n === 0 ) {
        ctx.expect(s.accepted === true, "téléportation acceptée");
        ctx.expect((s.asked?.labels ?? []).length === 6, `la question : Aucun + 5 options (${(s.asked?.labels ?? []).join(", ")})`);
      }
      const t = s.res?.targets?.find(x => x.name === "Bandit");
      const marked = (await named(bandit, /Nargu|Taunt/i)).length > 0;
      if ( n === 0 ) ctx.expect(s.res?.plan?.save?.ability === "wis" && !!t?.save && (marked === (t.save.success === false)), `Foulée narquoise : Sagesse du Bandit (${t?.save?.total}), Narguée ⇔ ratée`);
      if ( marked ) taunted = s;
    }
    if ( ctx.expect(!!taunted, "le Bandit Nargué (12 essais au plus)") ) {
      const scimitar = await ctx.itemId(bandit.id, "scimitar");
      const modeAgainst = async target => {
        const since = await ctx.lastMessageId();
        await ctx.use({ tokenId: bandit.id, itemId: scimitar, activityType: "attack", targetTokenIds: [target.id] });
        await pause(3500);
        return (await ctx.messagesSince(since)).find(m => m.type === "attack")?.rolls?.[0]?.options?.advantageMode ?? null;
      };
      ctx.expect((await modeAgainst(cleric)) === -1, "Nargué : son attaque contre le Clerc au Désavantage");
      ctx.expect((await modeAgainst(warlock)) !== -1, "Nargué : son attaque contre l'Occultiste sans Désavantage");
    }

    // Foulée effroyable, à l'arrivée à côté du Bandit.
    const dread = await step(/effroyable.*arriv|Dreadful.*arriv/i, { near: true });
    const td = dread.res?.targets?.find(x => x.name === "Bandit");
    ctx.expect(dread.res?.plan?.save?.ability === "wis" && !!td?.save, `Foulée effroyable : Sagesse du Bandit (${td?.save?.total})`);
    ctx.expect((td?.save?.success === false) ? ((td?.damage?.applied ?? 0) > 0) : ((td?.damage?.applied ?? 0) === 0), `2d10 psychiques ⇔ ratée (${td?.damage?.applied ?? 0})`);

    // Foulée revigorante : des PV temporaires.
    await ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.attributes.hp.temp": 0 } });
    await step(/revigorante|Refreshing/i);
    await pause(1500);
    const temp1 = (await ctx.call("get-actor", { actorId: warlock.actorId })).system?.attributes?.hp?.temp ?? 0;
    ctx.expect((temp1 >= 1) && (temp1 <= 10), `Foulée revigorante : ${temp1} PV temporaires`);

    // Foulée évanescente : Invisible.
    await step(/évanescente|Disappearing/i);
    const invisible = (await ctx.effects(warlock)).some(e => !e.disabled && (e.statuses ?? []).includes("invisible"));
    ctx.expect(invisible, "Foulée évanescente : l'Occultiste est Invisible");
    await clear();

    // 2. Ange vengeur.
    const angel = await lend(paladin, `${CLASSES}.phbpdnAvengingAn`);
    await pause(1200);
    ctx.restore(() => ctx.removeEffectsNamed(paladin, /Ange vengeur|Avenging/i));
    const p0 = await ctx.position(paladin);
    await ctx.call("move-token", { tokenId: bandit.id, x: p0.x + grid, y: p0.y, elevation: 0 });
    await pause(800);
    await tough();
    await ctx.use({ tokenId: paladin.id, itemId: angel, activityId: "PUWfXLPucizXR8p0" });
    await pause(2000);
    ctx.expect((await named(paladin, /Ange vengeur|Avenging/i)).length > 0, "l'effet Ange vengeur est sur le Paladin");
    await ctx.startCombat([paladin, bandit]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [t, v] of [[paladin, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    let frightened = false, saw = false;
    for ( let n = 0; (n < 16) && !frightened; n++ ) {
      await clear();
      // La borne avant le tour du Bandit : l'aura agit dès le début de son tour.
      const since = await ctx.lastMessageId();
      for ( let i = 0; (i < 3) && ((await current()) !== bandit.id); i++ ) { await ctx.nextTurn(); await pause(2000); }
      await pause(3000);
      const msg = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resolution);
      if ( !msg ) { await ctx.nextTurn(); await pause(1500); continue; }
      const r = await ctx.settle(msg.id, { timeoutMs: 45000 }).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Bandit");
      await pause(1200);
      frightened = (await ctx.effects(bandit)).some(e => !e.disabled && (e.statuses ?? []).includes("frightened"));
      if ( !saw ) { saw = true; ctx.expect(r?.plan?.save?.ability === "wis" && !!t?.save && (frightened === (t.save.success === false)), `début du tour du Bandit dans l'aura : Sagesse (${t?.save?.total}), Effrayé ⇔ ratée`); }
      if ( !frightened ) { await ctx.nextTurn(); await pause(1500); }
    }
    if ( ctx.expect(frightened, "le Bandit Effrayé (16 essais au plus)") ) {
      const since = await ctx.lastMessageId();
      const sword = (await ctx.call("get-actor", { actorId: paladin.actorId })).items.find(i => (i.type === "weapon") && i.system?.equipped
        && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
      await ctx.use({ tokenId: paladin.id, itemId: sword._id, activityType: "attack", targetTokenIds: [bandit.id] });
      await answer(await known(), /^Rien$|^Aucun|^None|^Non/i, 3000);
      await pause(5000);
      const attack = (await ctx.messagesSince(since)).find(m => m.type === "attack");
      ctx.expect(attack?.rolls?.[0]?.options?.advantageMode === 1, `l'attaque du Paladin contre l'Effrayé a l'Avantage (mode ${attack?.rolls?.[0]?.options?.advantageMode})`);
      await ctx.engine("hurt", { tokenId: bandit.id, amount: 3 });
      await pause(2500);
      const still = (await ctx.effects(bandit)).some(e => !e.disabled && (e.statuses ?? []).includes("frightened"));
      ctx.expect(!still, "blessé, le Bandit n'est plus Effrayé");
    }
  }
};
