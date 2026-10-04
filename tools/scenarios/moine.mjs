/**
 * Le Moine du Manuel des joueurs 2024 (SPEC §24), monde `dnd-6`. Le Guerrier reçoit, prêtées depuis le compendium du Manuel des
 * joueurs, la classe de Moine au niveau 5 (5 points de concentration) et Arts martiaux, Concentration du moine, Frappe
 * étourdissante, Technique de la main ouverte et Parade. Le Bandit reçoit 300 PV. Vérifie :
 *  - Arts martiaux : l'action dépensée (épée à deux mains), la frappe à mains nues se paie de l'action Bonus ;
 *  - Déluge de coups : un point, deux frappes à mains nues gratuites (l'action reste), cartes marquées « Déluge » ;
 *    Technique de la main ouverte au premier coup (Renverser : À terre ⇔ sauvegarde ratée) ;
 *  - Frappe étourdissante : la question, un point, la sauvegarde (Étourdi ⇔ ratée), pas de seconde question dans le tour ;
 *  - Défense patiente (1 point) : Se désengager et Esquiver ; Pas du vent : Foncer et Se désengager ;
 *  - Parade : le Bandit touche le moine → la réaction réduit les dégâts du montant de son jet, sans soigner.
 * Remet positions, PV, états ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "moine — Arts martiaux, Déluge de coups, main ouverte, Frappe étourdissante, Défense patiente, Pas du vent, Parade",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(PHB) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const monk = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [monk, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(monk.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const lend = async id => {
      const uuid = `Compendium.${PHB}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: monk.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: monk.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const cls = await lend("phbmnkMonk000000");
    await ctx.call("upsert-actor-item", { actorId: monk.actorId, itemData: { "system.levels": 5 }, match: { path: "_id", value: cls } });
    await lend("phbmnkMartialArt");
    const focus = await lend("phbmnkMonksFocus");
    await lend("phbmnkStunningSt");
    await lend("phbmnkOpenHandTe");
    await lend("phbmnkDeflectAtt");
    const refill = () => ctx.call("upsert-actor-item", { actorId: monk.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: focus } });
    const spent = async () => ((await ctx.call("get-actor", { actorId: monk.actorId })).items ?? []).find(i => i._id === focus)?.system?.uses?.spent ?? null;

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of ["prone", "stunned", "dodging"] ) { await ctx.removeStatusEffects(t, s); await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {}); }
        await ctx.removeEffectsNamed(t, /Stunned|Étourdi|Slowed|Ralenti|Addled|Toppled|Disengaged|Patient|Désengag|Défense/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
      await refill();
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
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
      await ctx.startCombat([monk, bandit]);
      const combat = await state();
      for ( const [t, v] of [[monk, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== monk.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === monk.id;
    };
    const budget = () => ctx.engine("budget", { tokenId: monk.id });
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** Répond aux questions qui s'ouvrent pendant `ms` : `answers` = [motif du titre ou du texte, motif du bouton]. */
    const answerAll = async (ids, answers, ms=9000) => {
      const seen = [];
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...ids, ...seen.map(d => d.id)], waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
          const rule = answers.find(([re]) => re.test(text));
          const b = rule ? (d.buttons ?? []).find(x => rule[1].test(x.label ?? "")) : null;
          if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
          seen.push({ id: d.id, text, answered: b?.label ?? null });
        }
      }
      return seen;
    };
    const strike = await ctx.itemId(monk.id, "unarmed-strike");
    const sword = await ctx.itemId(monk.id, "greatsword");
    const attack = async (attacker, itemId, target, usage={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: usage } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      return { r, since, usage: u.usageMessageId, hit: r?.targets?.find(t => t.name === target.name)?.hit ?? null };
    };

    await part("Arts martiaux", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du moine") ) return;
      await attack(monk, sword, bandit);
      const b1 = await budget();
      const ids = await known();
      await attack(monk, strike, bandit, { confirmed: false });
      await answerAll(ids, [[/Frappe étourdissante|Stunning/i, /^Non$|^No$/i]], 4000);
      await pause(1500);
      const b2 = await budget();
      ctx.expect(b1?.action === 0 && b2?.bonus === 0, `épée : action ${b1?.action} ; frappe à mains nues : action Bonus ${b1?.bonus} → ${b2?.bonus}`);
    });

    await part("Déluge de coups, main ouverte", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du moine") ) return;
      await ctx.use({ tokenId: monk.id, itemId: focus, activityId: "2ghJTBhilLrFn9xT", consume: true });   // le connecteur ne consomme pas par défaut
      await pause(2500);
      const b = await budget();
      ctx.expect(b?.flurry === 2 && b?.bonus === 0 && (await spent()) === 1, `Déluge : ${b?.flurry} frappes, action Bonus ${b?.bonus}, points dépensés ${await spent()}`);
      let toppled = null;
      for ( let n = 0; n < 2; n++ ) {
        const ids = await known();
        const a = await attack(monk, strike, bandit);
        const answered = await answerAll(ids, [[/main ouverte|Open Hand/i, /Renverser|Topple/i], [/étourdissante|Stunning/i, /^Non$|^No$/i]], a.hit ? 9000 : 1500);
        const card = (await ctx.messagesSince(a.since)).find(m => m.type === "usage" && m.id === a.usage);
        ctx.expect(card?.flags?.[MODULE_ID]?.flurry === true, `frappe ${n + 1} : carte du Déluge (${a.hit ? "touché" : "raté"})`);
        if ( a.hit && (toppled === null) ) {
          ctx.expect(answered.some(d => /Renverser|Topple/.test(d.answered ?? "")), "touché : la question de la main ouverte, « Renverser »");
          let save = null;
          for ( const stop = Date.now() + 15000; !save && (Date.now() < stop); await pause(500) ) {
            save = (await ctx.messagesSince(a.since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "cunningStrike");
          }
          const r = save ? await ctx.settle(save.id, { timeoutMs: 30000 }).catch(() => null) : null;
          const t = r?.targets?.[0];
          const prone = (await ctx.engine("stats", { tokenId: bandit.id }))?.statuses?.includes("prone");
          toppled = !!t?.save;
          ctx.expect(!!t?.save && (prone === !t.save.success), `Renverser : sauvegarde ${t?.save?.total} (${t?.save?.success ? "réussie" : "ratée"}), À terre ${prone}`);
        }
      }
      const b2 = await budget();
      ctx.expect(b2?.flurry === 0 && b2?.action === 1, `après : ${b2?.flurry} frappe restante, l'action intacte (${b2?.action})`);
    });

    await part("Frappe étourdissante", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du moine") ) return;
      let asked = null;
      for ( let n = 0; (n < 10) && !asked; n++ ) {
        const ids = await known();
        const a = await attack(monk, strike, bandit, {});
        if ( !a.hit ) continue;
        const answered = await answerAll(ids, [[/étourdissante|Stunning/i, /Frappe étourdissante|Stunning Strike/i]]);
        asked = { a, answered };
      }
      if ( !ctx.expect(!!asked?.answered?.some(d => d.answered), "touché : la question de la Frappe étourdissante") ) return;
      let save = null;
      for ( const stop = Date.now() + 15000; !save && (Date.now() < stop); await pause(500) ) {
        save = (await ctx.messagesSince(asked.a.since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "cunningStrike");
      }
      const r = save ? await ctx.settle(save.id, { timeoutMs: 30000 }).catch(() => null) : null;
      const t = r?.targets?.[0];
      const stunned = (await ctx.engine("stats", { tokenId: bandit.id }))?.statuses?.includes("stunned");
      ctx.expect((await spent()) === 1, `un point dépensé (${await spent()})`);
      ctx.expect(!!t?.save && (stunned === !t.save.success), `Constitution ${t?.save?.total} (${t?.save?.success ? "réussie" : "ratée"}), Étourdi ${stunned}`);
      const ids = await known();
      const again = await attack(monk, strike, bandit, {});
      const more = again.hit ? await answerAll(ids, [[/étourdissante|Stunning/i, /^Non$|^No$/i]], 4000) : [];
      ctx.expect(!more.some(d => /étourdissante|Stunning/i.test(d.text)), "second coup du tour : pas de seconde question");
    });

    await part("Défense patiente, Pas du vent", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du moine") ) return;
      await ctx.use({ tokenId: monk.id, itemId: focus, activityId: "7xj7b6e8tDznDSrE", consume: true });
      await pause(2000);
      const b = await budget();
      ctx.expect(b?.disengaged === true && b?.dodging === true && b?.bonus === 0, `Défense patiente : désengagé ${b?.disengaged}, esquive ${b?.dodging}`);
      // §79 : l'Esquive (état du moteur, l'effet de l'item n'est pas posé) tient pendant le tour du Bandit et tombe au début du
      // prochain tour du moine.
      const dodging = async () => (await ctx.effects(monk)).some(e => !e.disabled && (e.statuses ?? []).includes("dodging"));
      await ctx.nextTurn(); await pause(1500);
      ctx.expect(await dodging(), "au tour du Bandit, le moine esquive toujours");
      await ctx.nextTurn(); await pause(2000);
      ctx.expect(!(await dodging()), "au prochain tour du moine, l'Esquive est tombée");
      await ctx.use({ tokenId: monk.id, itemId: focus, activityId: "0MuRZ0Ur95xQTKFq", consume: true });
      await pause(2000);
      const c = await budget();
      ctx.expect(c?.dashed === true && c?.disengaged === true && c?.bonus === 0, `Pas du vent : Foncer ${c?.dashed}, désengagé ${c?.disengaged}`);
    });

    await part("Parade", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      let checked = false;
      for ( let n = 0; (n < 30) && !checked; n++ ) {
        await ctx.setHp(monk, homes.get(monk.id).hp);
        const hp0 = await ctx.hp(monk);
        const a = await attack(bandit, await ctx.itemId(bandit.id, "scimitar"), monk, { autoReact: "first" });
        if ( !a.hit ) continue;
        await pause(2500);
        const msgs = await ctx.messagesSince(a.since);
        const dealt = (msgs.find(m => (m.type === "damage") && (m.alias === "Bandit"))?.rolls ?? []).reduce((s, r) => s + (r.total ?? 0), 0);
        const reduce = (msgs.find(m => (m.type === "healing") || ((m.type === "damage") && (m.alias !== "Bandit")))?.rolls ?? []).reduce((s, r) => s + (r.total ?? 0), 0);
        const lost = hp0 - (await ctx.hp(monk));
        ctx.expect((reduce > 0) && (lost === Math.max(0, dealt - reduce)), `Parade : ${dealt} dégâts, réduits de ${reduce} → ${lost} PV perdus`);
        checked = true;
      }
      ctx.expect(checked, "le Bandit a touché le moine (30 essais au plus)");
    });
  }
};
