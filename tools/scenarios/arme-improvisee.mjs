/**
 * §213 : Armes improvisées, demandées au MJ — Arène, Guerrier contre le Zombi (300 PV le temps du test), au contact. Le client du MJ
 * joue les deux côtés : la fenêtre du joueur (objet, geste), puis celle du MJ (décision).
 *  1. Acceptée en arme improvisée : une arme temporaire « (improvisée) » de type `improv`, 1d4 du type choisi, sans maîtrise ; son
 *     attaque part contre le Zombi ; elle disparaît à la fin du tour.
 *  2. Refusée : pas d'arme, pas d'attaque.
 *  3. Acceptée comme un gourdin : l'arme temporaire a les dégâts et le type du gourdin.
 * Remet positions, PV, items temporaires.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "arme improvisée — demande au MJ, accepter, refuser, comme une arme",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier et Zombi requis : non applicable"); return; }
    const hero = await ctx.token("Guerrier");
    const zombie = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [hero, zombie] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(hero.id).pos;

    const { data: zdata } = await ctx.call("get-scene-object", { type: "Token", objectId: zombie.id });
    const max0 = zdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombie.id, data: { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: zombie.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    const items = async () => (await ctx.call("get-actor", { actorId: hero.actorId })).items ?? [];
    const temporary = async () => (await items()).filter(i => i.flags?.[MODULE_ID]?.improvised);
    const dropTemporary = async () => {
      for ( const i of await temporary() ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: i._id }).catch(() => {});
    };
    ctx.restore(dropTemporary);
    const action = (await items()).find(i => i.flags?.[MODULE_ID]?.basicAction === "improvised");
    if ( !ctx.expect(!!action, "le Guerrier a l'action de base « Arme improvisée »") ) return;

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        if ( id !== zombie.id ) await ctx.setHp(tokens.find(x => x.id === id), h.hp);
      }
      await dropTemporary();
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      await tough();
      await ctx.call("move-token", { tokenId: zombie.id, x: g.x + grid, y: g.y, elevation: 0 }); await pause(700);
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
      await ctx.startCombat([hero, zombie]);
      const combat = await state();
      for ( const [t, v] of [[hero, 20], [zombie, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== hero.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === hero.id;
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** Attend la fenêtre dont le titre répond à `title`, la remplit et clique `button`. */
    const fill = async (ids, title, fields, button, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        const d = (r?.windows ?? []).find(w => title.test(w.title ?? ""));
        if ( !d ) continue;
        await ctx.call("answer-dialog", { id: d.id, fields, button });
        return d;
      }
      return null;
    };
    /** Demande une arme improvisée ; `verdict` : les champs et le bouton du MJ. Rend ce qui a été vu et les messages produits. */
    const ask = async (object, mode, verdict) => {
      const since = await ctx.lastMessageId();
      const ids = await known();
      ctx.use({ tokenId: hero.id, itemId: action._id, activityType: "utility", targetTokenIds: [zombie.id] }).catch(() => null);
      const player = await fill(ids, /improvis/i, { object, mode }, "ask");
      const gm = player ? await fill([...ids, player.id], /improvis/i, verdict.fields ?? {}, verdict.button) : null;
      await pause(7000);
      return { player: !!player, gm: !!gm, messages: await ctx.messagesSince(since) };
    };

    await part("Acceptée", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const r = await ask("une chaise", "melee", { fields: { as: "", type: "bludgeoning" }, button: "accept" });
      ctx.expect(r.player && r.gm, `la fenêtre du joueur puis celle du MJ (${r.player}, ${r.gm})`);
      const [temp] = await temporary();
      ctx.expect(!!temp && (temp.system?.type?.value === "improv") && (temp.system?.damage?.base?.denomination === 4), `arme temporaire : ${temp?.name} (${temp?.system?.type?.value}, d${temp?.system?.damage?.base?.denomination})`);
      ctx.expect(temp?.system?.proficient === 0, `sans maîtrise (${temp?.system?.proficient})`);
      ctx.expect(r.messages.some(m => m.type === "attack"), "son attaque part contre le Zombi");
      await ctx.nextTurn(); await pause(2500);
      ctx.expect(!(await temporary()).length, "elle disparaît à la fin du tour");
    });

    await part("Refusée", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const r = await ask("un tabouret", "melee", { button: "refuse" });
      ctx.expect(r.player && r.gm, "demande faite, refusée");
      ctx.expect(!(await temporary()).length && !r.messages.some(m => m.type === "attack"), "ni arme ni attaque");
    });

    await part("Comme un gourdin", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const r = await ask("un pied de table", "melee", { fields: { as: "club" }, button: "accept" });
      const [temp] = await temporary();
      ctx.expect(!!temp && (temp.system?.type?.baseItem === "club"), `arme temporaire comme un gourdin : ${temp?.name} (${temp?.system?.type?.value}/${temp?.system?.type?.baseItem})`);
      ctx.expect(r.messages.some(m => m.type === "attack"), "son attaque part");
    });
  }
};
