/**
 * §285 : chantiers du 2026-10-30, lot 3 (contrôle), monde `dnd-6`, Arène de test. Le Clerc reçoit les sorts du Manuel des joueurs ;
 * leurs effets sont posés sur le Zombi tels que la sauvegarde ratée les poserait (`api.mcp.placeItemEffect` : l'effet de l'item, son
 * id, l'item pour origine), puis un combat Clerc (20) / Zombi (10). Vérifie :
 *  - Terreur, Mauvais œil (Paniqué) : au tour du Zombi, Foncer et fuite — plus loin du Clerc qu'avant ;
 *  - Confusion : le d10 au début de son tour, son comportement et le budget (ni action Bonus ; rien / errance : plus d'action) ;
 *  - Couronne du dément : le rappel au tour du Zombi ; l'entretien du Clerc — offert au tour suivant, pris (action), puis oublié :
 *    sa concentration tombe à la fin de ce tour-là ;
 *  - Fou rire de Tasha : se relever refusé ; des dégâts → sauvegarde rejouée avec l'Avantage (mode par cible).
 * Remet positions, effets, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = { fear: "phbsplFear000000", eyebite: "phbsplEyebite000", confusion: "phbsplConfusion0", crown: "phbsplCrownofMad", tasha: "phbsplTashasHide" };
const EFFECTS = { fear: "ijiWLu6EJZmEJPOZ", eyebite: "Kj1GwWXD5k0Zen75", confusion: "VxmsgUz9OIUet6WC", crown: "0zixJ8ZoYFgSJtMV", tasha: "5nrcjxzmy3FCLCkV" };

export default {
  name: "sorts lot 3 — Terreur, Mauvais œil, Confusion, Couronne du dément, Fou rire de Tasha (contrôle)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Clerc", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Clerc et Zombi requis : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const ids = {};
    for ( const [k, id] of Object.entries(SPELLS) ) ids[k] = await ctx.ensureItem(cleric, PHB + id, { system: { method: "atwill" } });
    const zhp = await ctx.hp(zombi);
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const all = [cleric, zombi];
    const home = new Map(), effects0 = new Map();
    for ( const t of all ) { home.set(t.id, await ctx.position(t)); effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id))); }
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.[MODULE_ID]?.aura) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        const h = home.get(t.id), now = await ctx.position(t);
        if ( (now.x !== h.x) || (now.y !== h.y) ) await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
      }
      await ctx.setHp(zombi, zhp);
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await reset(); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const gap = async () => {
      const a = await ctx.position(cleric), b = await ctx.position(zombi);
      return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / grid - 1;
    };
    /** Le Zombi à `cells` cases à l'est du Clerc. */
    const placeZombi = async cells => {
      const c = await ctx.position(cleric);
      await ctx.call("move-token", { tokenId: zombi.id, x: c.x + ((cells + 1) * grid), y: c.y, elevation: c.elevation ?? 0 });
      await pause(800);
    };
    const place = key => ctx.engine("placeItemEffect", { tokenId: zombi.id, casterId: cleric.id, itemId: ids[key], effectId: EFFECTS[key] });
    /** Combat Clerc (20) / Zombi (10), au tour du Clerc. */
    const fight = async () => {
      await ctx.startCombat([cleric, zombi]);
      const c = await ctx.combat();
      for ( const [t, value] of [[cleric, 20], [zombi, 10]] ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      const now = await ctx.combat();
      if ( (now.combatants ?? []).find(x => x.isCurrent || x.current)?.name !== cleric.name ) await ctx.nextTurn();
      await pause(800);
    };
    /** Passe au tour suivant et attend la carte du moteur de ce `kind` (20 s au plus). */
    const next = async (kind, ms=20000) => {
      const since = await ctx.lastMessageId();
      await ctx.nextTurn();
      if ( !kind ) { await pause(2000); return null; }
      for ( const until = Date.now() + ms; Date.now() < until; ) {
        await pause(700);
        const found = (await ctx.messagesSince(since)).map(m => m.flags?.[MODULE_ID]?.control ?? m.flags?.control).find(c => c?.kind === kind);
        if ( found ) { await pause(1500); return found; }
      }
      return null;
    };
    const budget = () => ctx.engine("budget", { tokenId: zombi.id });

    for ( const key of ["fear", "eyebite"] ) {
      await part(key === "fear" ? "Terreur" : "Mauvais œil", async () => {
        await placeZombi(2);
        await place(key);
        const before = await gap();
        await fight();
        const fled = await next("panic");
        if ( !ctx.expect(!!fled, "au tour du Zombi : la fuite est jouée") ) return;
        const after = await gap();
        ctx.expect(after > before, `le Zombi s'éloigne du Clerc (${before} → ${after} cases)`);
        ctx.expect((await budget())?.dashed === true, "il a pris l'action Foncer");
        if ( key === "eyebite" ) ctx.expect(fled.ended === false, "Mauvais œil : toujours vu du Clerc, l'effet reste");
      });
    }

    await part("Confusion", async () => {
      await placeZombi(3);
      await place("confusion");
      await fight();
      const c = await next("confusion", 30000);
      if ( !ctx.expect(!!c, "au tour du Zombi : le d10 de Confusion est joué") ) return;
      const kind = c.roll <= 1 ? "wander" : c.roll <= 6 ? "idle" : c.roll <= 8 ? "lash" : "free";
      ctx.expect(c.behavior === kind, `d10 ${c.roll} → ${c.behavior} (attendu ${kind})`);
      const b = await budget();
      ctx.expect(b?.bonus === 0, "ni action Bonus");
      if ( ["wander", "idle"].includes(kind) ) ctx.expect(b?.action === 0 && b?.stopped === true, `plus d'action ni de déplacement (${JSON.stringify({ action: b?.action, stopped: b?.stopped })})`);
      if ( kind === "lash" ) ctx.expect(b?.stopped === true && (b?.action === (c.target ? 1 : 0)), `frappe au hasard : ${c.target ? "une cible tirée, l'action gardée" : "aucune cible, plus d'action"}`);
    });

    await part("Couronne du dément", async () => {
      await placeZombi(1);
      await ctx.engine("concentrate", { tokenId: cleric.id, itemId: ids.crown });
      await place("crown");
      await fight();
      const reminded = await next("forcedAttack");   // fin du tour du Clerc (le lancement), tour du Zombi
      ctx.expect(!!reminded, "au tour du Zombi : l'attaque imposée est rappelée");
      let state = await ctx.engine("upkeep", { tokenId: cleric.id });
      ctx.expect(!!state[0]?.flag?.since && !state[0].offered, "le tour du lancement est noté ; rien à entretenir hors de son tour");
      await next(null);   // round 2, tour du Clerc
      state = await ctx.engine("upkeep", { tokenId: cleric.id, maintain: true });
      ctx.expect(state[0]?.offered === true && state[0]?.maintained === true, `l'entretien est offert puis pris (${JSON.stringify(state[0])})`);
      await next(null);   // fin du tour du Clerc, entretenu : le sort reste
      state = await ctx.engine("upkeep", { tokenId: cleric.id });
      ctx.expect(state.length === 1, "entretenu : la concentration tient");
      await next(null);   // round 3, tour du Clerc — pas d'entretien
      const lost = await next("upkeepLost");
      ctx.expect(!!lost, "sans entretien, le sort prend fin à la fin du tour du Clerc");
      state = await ctx.engine("upkeep", { tokenId: cleric.id });
      ctx.expect(!state.length, "plus de concentration sur la Couronne");
    });

    await part("Fou rire de Tasha", async () => {
      await place("tasha");
      await pause(800);
      const s = await ctx.engine("stand", { tokenId: zombi.id });
      ctx.expect(!s.offered && !s.stood, `se relever : ni offert ni fait (${JSON.stringify(s)})`);
      const since = await ctx.lastMessageId();
      await ctx.engine("hurt", { tokenId: zombi.id, amount: 1 });
      let resave = null;
      for ( const until = Date.now() + 15000; !resave && (Date.now() < until); ) {
        await pause(700);
        resave = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.resave?.moment === "isDamaged");
      }
      if ( !ctx.expect(!!resave, "des dégâts : la sauvegarde est rejouée") ) return;
      const modes = resave.flags[MODULE_ID].targetModes ?? [];
      ctx.expect(modes.some(m => m.mode === "advantage"), `avec l'Avantage (${JSON.stringify(modes)})`);
      await ctx.settle(resave._id ?? resave.id, { timeoutMs: 30000 }).catch(() => null);
    });
  }
};
