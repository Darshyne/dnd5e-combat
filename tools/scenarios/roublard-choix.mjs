/**
 * §223 (#16) : l'Attaque sournoise au choix et l'activité de l'item, monde `dnd-6`. Le Roublard (halfelin, niveau 1) passe niveau 5
 * le temps du scénario (Attaque sournoise 3d6), le Guerrier se tient à côté du Bandit (un allié à 1,50 m), le Bandit reçoit 300 PV.
 *  - réglage « automatique » : l'activité de l'item ne lance rien (ni dégâts, ni PV perdus pour le Roublard) ;
 *  - réglage « demander », en combat : au premier coup, la fenêtre « Au toucher » s'ouvre ; « Rien de tout cela » garde l'Attaque
 *    sournoise ; au second coup du tour, elle se repropose, acceptée : 3d6 ; au troisième, plus de question ni d'Attaque sournoise ;
 *  - réglage « demander », tour suivant : l'activité de l'item réserve l'Attaque sournoise, le coup suivant l'a sans question.
 * Remet le réglage, positions, PV, niveau.
 */
const MODULE_ID = "dnd5e-combat";
const HIT_TITLE = /Au toucher|On hit/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "roublard-choix — Attaque sournoise au choix, activité de l'item",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Roublard", "Bandit", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const rogue = await ctx.token("Roublard");
    const bandit = await ctx.token("Bandit");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [rogue, bandit, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const r0 = homes.get(rogue.id).pos;

    // Les alliés rangés sous le Roublard s'écartent (voir le scénario `roublard`).
    for ( const name of ["Moine", "Druide", "Rôdeur", "Barde"] ) {
      const t = (await ctx.scene()).tokens.find(x => x.name === name);
      if ( !t ) continue;
      const pos = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y, elevation: pos.elevation ?? 0 }).catch(() => {}));
      await ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y + 2 * grid, elevation: pos.elevation ?? 0 });
    }
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(600); };
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        const t = tokens.find(x => x.id === id);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const setting = async (key, value) => { const r = await ctx.engine("setting", { key, value }); ctx.restore(() => ctx.engine("setting", { key, value: r.before })); return r; };

    const actor = await ctx.call("get-actor", { actorId: rogue.actorId });
    const cls = (actor.items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "rogue"));
    const sneakItem = (actor.items ?? []).find(i => i.system?.identifier === "sneak-attack");
    if ( !ctx.expect(!!cls && !!sneakItem, "le Roublard a sa classe et son Attaque sournoise") ) return;
    const setLevel = n => ctx.call("upsert-actor-item", { actorId: rogue.actorId, itemData: { "system.levels": n }, match: { path: "_id", value: cls._id } });
    ctx.restore(() => setLevel(cls.system.levels).catch(() => {}));
    await setLevel(5);
    const blade = await ctx.itemId(rogue.id, "shortsword");
    const useSneakItem = async () => {
      const since = await ctx.lastMessageId();
      const hp = await ctx.hp(rogue);
      const used = await ctx.use({ tokenId: rogue.id, itemId: sneakItem._id, activityType: "damage", targetTokenIds: [] }).catch(err => ({ error: err.message }));
      await pause(2000);
      const msgs = await ctx.messagesSince(since);
      // L'utilisation annulée ne laisse ni carte d'utilisation ni jet de dégâts.
      return { used: used?.used === true, card: msgs.some(m => m.type === "usage"), damage: msgs.find(m => m.type === "damage") ?? null,
        hpBefore: hp, hpAfter: await ctx.hp(rogue) };
    };

    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const hitDialog = async (ids, waitMs) => {
      for ( const until = Date.now() + waitMs; Date.now() < until; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 2000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => HIT_TITLE.test(w.title ?? ""));
        if ( d ) return d;
      }
      return null;
    };
    /** Une attaque à l'épée courte ; `answer` : "strike" (valider tel quel), "none" (rien de tout cela) ou null (aucune fenêtre attendue). */
    const attack = async answer => {
      const since = await ctx.lastMessageId();
      const ids = await known();
      const u = await ctx.use({ tokenId: rogue.id, itemId: blade, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      let hit = null;
      let dialog = null;
      for ( const until = Date.now() + 20000; Date.now() < until; await pause(400) ) {
        const res = await ctx.resolution(u.usageMessageId);
        const t = res?.targets?.find(x => x.name === bandit.name);
        if ( (t?.hit === false) || ["missed", "undone"].includes(res?.step) ) { hit = false; break; }
        if ( t?.hit === true ) {
          hit = true;
          dialog = await hitDialog(ids, answer ? 8000 : 3000);
          if ( dialog ) await ctx.call("answer-dialog", { id: dialog.id, button: answer ?? "strike" });
          break;
        }
      }
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      return { hit, dialog, sneak: damage?.flags?.[MODULE_ID]?.sneak ?? null };
    };
    const hitUntil = async answer => {
      for ( let n = 0; n < 20; n++ ) { const a = await attack(answer); if ( a.hit ) return a; }
      return null;
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const toRogue = async () => {
      for ( let i = 0; (i < 4) && ((await current()) !== rogue.id); i++ ) { await ctx.nextTurn(); await pause(1500); }
      return (await current()) === rogue.id;
    };
    const fight = async () => {
      await ctx.startCombat([rogue, bandit, fighter]);
      const combat = await state();
      for ( const [t, v] of [[rogue, 20], [bandit, 10], [fighter, 5]] ) {
        await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 4) && ((await current()) !== rogue.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }).catch(() => ctx.nextTurn()); await pause(1500); }
      return (await current()) === rogue.id;
    };
    const bx = r0.x - grid;
    const by = r0.y;

    await part("automatique : l'activité de l'item ne frappe pas le Roublard", async () => {
      await setting("sneakAttackMode", "auto");
      const r = await useSneakItem();
      ctx.expect(!r.card && !r.damage, `utilisation annulée : ni carte ni jet de dégâts (carte : ${r.card}, utilisée : ${r.used})`);
      ctx.expect(r.hpAfter === r.hpBefore, `PV du Roublard inchangés (${r.hpBefore} → ${r.hpAfter})`);
    });

    await part("demander : gardée, puis acceptée, une fois par tour", async () => {
      await setting("sneakAttackMode", "ask");
      await tough();
      await place(bandit, bx, by);
      await place(fighter, bx - grid, by);
      if ( !ctx.expect(await fight(), "combat : au tour du Roublard") ) return;
      const kept = await hitUntil("none");
      if ( !ctx.expect(!!kept, "premier coup (20 essais au plus)") ) return;
      ctx.expect(!!kept.dialog, `la question s'ouvre (${kept.dialog?.title ?? "aucune"})`);
      ctx.expect(!kept.sneak, "« Rien de tout cela » : pas d'Attaque sournoise sur ce coup");
      const taken = await hitUntil("strike");
      if ( !ctx.expect(!!taken, "second coup (20 essais au plus)") ) return;
      ctx.expect(!!taken.dialog && (taken.sneak?.dice === 3), `second coup : reproposée et acceptée, ${taken.sneak?.dice ?? "aucun"}d6`);
      const third = await hitUntil(null);
      if ( !ctx.expect(!!third, "troisième coup (20 essais au plus)") ) return;
      ctx.expect(!third.dialog && !third.sneak, "troisième coup du tour : ni question ni Attaque sournoise");
    });

    await part("demander : l'activité de l'item réserve l'Attaque sournoise", async () => {
      await setting("sneakAttackMode", "ask");
      await tough();
      await place(bandit, bx, by);
      await place(fighter, bx - grid, by);
      if ( !ctx.expect(await fight(), "combat : au tour du Roublard") ) return;
      const r = await useSneakItem();
      ctx.expect(!r.card && !r.damage && (r.hpAfter === r.hpBefore), `utilisation annulée, PV inchangés (${r.hpBefore} → ${r.hpAfter})`);
      const armed = (await ctx.call("get-actor", { actorId: rogue.actorId })).flags?.[MODULE_ID]?.sneakArmed ?? null;
      ctx.expect(!!armed, `réservation posée sur le Roublard (${armed})`);
      const a = await hitUntil(null);
      if ( !ctx.expect(!!a, "coup (20 essais au plus)") ) return;
      ctx.expect(!a.dialog && (a.sneak?.dice === 3), `réservée : sans question (${a.dialog?.title ?? "aucune"}), ${a.sneak?.dice ?? "aucun"}d6`);
      // Au tour suivant du Roublard, la réservation est oubliée : la question revient.
      await ctx.nextTurn(); await pause(1500);
      if ( !ctx.expect(await toRogue(), "tour suivant du Roublard") ) return;
      const b = await hitUntil("strike");
      ctx.expect(!!b?.dialog && (b?.sneak?.dice === 3), `tour suivant : la question revient (${b?.dialog?.title ?? "aucune"})`);
    });
  }
};
