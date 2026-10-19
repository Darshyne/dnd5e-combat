/**
 * §211 : Se tenir prêt — Guerrier et Magicien de `dnd-6` contre le Zombi (Arène).
 *  1. « Arrive à portée » : le Guerrier prépare son épée ; au tour du Zombi, celui-ci marche vers une case au-delà du Guerrier. Sa
 *     marche s'arrête à la case où il arrive à l'allonge, la Réaction est proposée (acceptée), l'attaque part avec `readiedRelease`,
 *     puis la marche reprend jusqu'au bout ; le plan est servi, la Réaction dépensée.
 *  2. Refuser laisse le plan armé.
 *  3. « Attaque » : le Guerrier prépare son épée contre une attaque ; le Zombi attaque le Guerrier ; la Réaction est proposée après.
 *  4. Sort préparé : le Magicien prépare Projectile magique — un emplacement dépensé, la Concentration posée ; au début de son tour
 *     suivant, non libéré, il est perdu (Concentration retirée, plan tombé).
 * Remet positions, PV, emplacements, Concentration.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "se tenir prêt — arrive à portée, attaque, sort préparé",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Magicien", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const hero = await ctx.token("Guerrier");
    const mage = await ctx.token("Magicien");
    const zombie = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [hero, mage, zombie] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(hero.id).pos;
    const cellOf = pos => ({ i: Math.round(pos.y / grid), j: Math.round(pos.x / grid) });
    const home = cellOf(g);

    const mageActor = await ctx.call("get-actor", { actorId: mage.actorId });
    const slots0 = Object.fromEntries(Object.entries(mageActor.system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
    const setSlots = slots => ctx.call("update-actor", { actorId: mage.actorId, actorData: Object.fromEntries(Object.entries(slots).map(([k, v]) => [`system.spells.${k}.value`, v])) });
    ctx.restore(() => setSlots(slots0).catch(() => {}));

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Concentr/i);
        for ( const st of ["prone", "dead", "unconscious"] ) await ctx.removeStatusEffects(t, st);
        if ( id !== zombie.id ) await ctx.setHp(t, h.hp);
      }
      await setSlots(slots0);
    };
    ctx.restore(remettre);
    // Le Zombi encaisse (300 PV le temps du test) : mort, il ne finirait pas sa marche.
    const { data: zdata } = await ctx.call("get-scene-object", { type: "Token", objectId: zombie.id });
    const max0 = zdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombie.id, data: { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: zombie.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      await tough();
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async order => {
      await ctx.startCombat(order.map(([t]) => t));
      const combat = await state();
      for ( const [t, v] of order ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 4) && ((await current()) !== order[0][0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === order[0][0].id;
    };
    const ready = (t, args) => ctx.engine("ready", { tokenId: t.id, ...args });
    const budget = t => ctx.engine("budget", { tokenId: t.id });
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** Attend la fenêtre de réaction ; `button` : /regex/ du bouton (ou « Ne pas réagir »). Rend ce qui a été vu, et la position du Zombi à ce moment. */
    const answer = async (ids, button, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        const d = (r?.windows ?? []).find(w => /Réaction|Reaction|prêt|ready/i.test(`${w.title ?? ""} ${w.content ?? w.text ?? ""}`));
        if ( !d ) continue;
        const at = await ctx.position(zombie);
        const b = (d.buttons ?? []).find(x => button.test(x.label ?? ""));
        if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
        return { text: `${d.title ?? ""} ${d.content ?? d.text ?? ""}`, at: cellOf(at), buttons: (d.buttons ?? []).map(x => x.label) };
      }
      return null;
    };
    const released = async since => (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.readiedRelease === true) ?? null;

    await part("Arrive à portée", async () => {
      await ctx.call("move-token", { tokenId: zombie.id, x: g.x + 4 * grid, y: g.y, elevation: 0 }); await pause(700);
      if ( !ctx.expect(await fight([[hero, 20], [zombie, 10]]), "combat : au tour du Guerrier") ) return;
      const r = await ready(hero, { name: "Épée", trigger: "enters" });
      ctx.expect(r.set && (r.plan?.trigger === "enters"), `plan rangé : ${r.plan?.name} — ${r.plan?.trigger}`);
      await ctx.nextTurn(); await pause(1500);
      const since = await ctx.lastMessageId();
      const ids = await known();
      const goal = { i: home.i + 1, j: home.j };   // 4 cases (Vitesse 20 ft) : la dernière après l'entrée à portée
      const walking = ctx.engine("move", { tokenId: zombie.id, cell: goal });
      const seen = await answer(ids, /Épée|sword/i);
      await walking.catch(() => null);
      await pause(3000);
      if ( !ctx.expect(!!seen, "la Réaction est proposée pendant la marche du Zombi") ) return;
      const dist = Math.max(Math.abs(seen.at.i - home.i), Math.abs(seen.at.j - home.j));
      ctx.expect(dist === 1, `le Zombi est arrêté à l'allonge quand elle est proposée (case à ${dist} case(s) du Guerrier)`);
      ctx.expect(!!(await released(since)), "l'attaque préparée part (carte « readiedRelease »)");
      const end = cellOf(await ctx.position(zombie));
      ctx.expect((end.i === goal.i) && (end.j === goal.j) && ((seen.at.i !== end.i) || (seen.at.j !== end.j)),
        `la marche reprend jusqu'au bout : arrêtée en (${seen.at.i}, ${seen.at.j}), arrivée en (${end.i}, ${end.j})`);
      const b = await budget(hero);
      ctx.expect(!b.readied && (b.reaction === 0), `plan servi, Réaction dépensée (readied ${JSON.stringify(b.readied)}, réaction ${b.reaction})`);
    });

    await part("Refuser", async () => {
      await ctx.call("move-token", { tokenId: zombie.id, x: g.x + 4 * grid, y: g.y, elevation: 0 }); await pause(700);
      if ( !ctx.expect(await fight([[hero, 20], [zombie, 10]]), "combat : au tour du Guerrier") ) return;
      await ready(hero, { name: "Épée", trigger: "enters" });
      await ctx.nextTurn(); await pause(1500);
      const since = await ctx.lastMessageId();
      const ids = await known();
      const walking = ctx.engine("move", { tokenId: zombie.id, cell: { i: home.i, j: home.j + 1 } });
      const seen = await answer(ids, /Ne pas|Don't|not react/i);
      await walking.catch(() => null);
      await pause(1500);
      ctx.expect(!!seen && !(await released(since)), "proposée, refusée : pas d'attaque");
      const b = await budget(hero);
      ctx.expect(b.readied?.trigger === "enters" && (b.reaction === 1), `le plan reste armé, la Réaction aussi (${b.readied?.name}, réaction ${b.reaction})`);
    });

    await part("Attaque", async () => {
      await ctx.call("move-token", { tokenId: zombie.id, x: g.x + grid, y: g.y, elevation: 0 }); await pause(700);
      if ( !ctx.expect(await fight([[hero, 20], [zombie, 10]]), "combat : au tour du Guerrier") ) return;
      await ready(hero, { name: "Épée", trigger: "attacks", targetId: zombie.id });
      await ctx.nextTurn(); await pause(1500);
      const since = await ctx.lastMessageId();
      const ids = await known();
      const using = ctx.use({ tokenId: zombie.id, identifier: "slam", activityType: "attack", targetTokenIds: [hero.id] });
      const seen = await answer(ids, /Épée|sword/i, 40000);
      await using.catch(() => null);
      await pause(4000);
      if ( !ctx.expect(!!seen && /attaqu|attacked/i.test(seen.text), `proposée après l'attaque du Zombi (${seen?.text?.slice(0, 80) ?? "rien"})`) ) return;
      ctx.expect(!!(await released(since)), "l'attaque préparée part");
    });

    await part("Sort préparé perdu", async () => {
      await setSlots({ ...slots0, spell1: 2 });
      if ( !ctx.expect(await fight([[mage, 20], [zombie, 10]]), "combat : au tour du Magicien") ) return;
      const r = await ready(mage, { name: "Projectile", trigger: "casts" });
      ctx.expect(r.set && (r.slots.spell1 === 1), `emplacement de niveau 1 dépensé (${r.slots.spell1} restant)`);
      ctx.expect(!!r.held, `Concentration posée (${r.held?.name ?? "aucune"})`);
      await ctx.nextTurn(); await pause(1500);
      await ctx.nextTurn(); await pause(3000);
      const after = await ready(mage, {});
      ctx.expect(!after.held, "au début de son tour, le sort non libéré est perdu (Concentration retirée)");
      ctx.expect(!after.plan, `le plan est tombé (${JSON.stringify(after.plan)})`);
    });

    await part("Sort préparé libéré", async () => {
      await setSlots({ ...slots0, spell1: 2 });
      await ctx.call("move-token", { tokenId: zombie.id, x: g.x + grid, y: g.y, elevation: 0 }); await pause(700);
      await ctx.call("move-token", { tokenId: mage.id, x: g.x, y: g.y + 4 * grid, elevation: 0 }); await pause(700);
      if ( !ctx.expect(await fight([[mage, 20], [zombie, 10]]), "combat : au tour du Magicien") ) return;
      const r = await ready(mage, { name: "Projectile", trigger: "attacks" });
      await ctx.nextTurn(); await pause(1500);
      const since = await ctx.lastMessageId();
      const ids = await known();
      // Il frappe le Guerrier : touché, le Magicien ferait son jet de Concentration (raté, le sort serait perdu — la règle).
      const using = ctx.use({ tokenId: zombie.id, identifier: "slam", activityType: "attack", targetTokenIds: [hero.id] });
      const seen = await answer(ids, /Projectile|Missile/i, 40000);
      await using.catch(() => null);
      await pause(6000);
      if ( !ctx.expect(!!seen, "proposée après l'attaque du Zombi") ) return;
      ctx.expect(!!(await released(since)), "le sort préparé part (carte « readiedRelease »)");
      const after = await ready(mage, {});
      ctx.expect(after.slots.spell1 === r.slots.spell1, `aucun autre emplacement dépensé (${r.slots.spell1} → ${after.slots.spell1})`);
      ctx.expect(!after.held && !after.plan, "Concentration de l'action préparée retirée, plan servi");
    });
  }
};
