/**
 * Relevé des sorts, lot 5c (SPEC §164), monde `dnd-6`, arène. Sorts prêtés du Manuel des joueurs.
 *  - Lévitation (le Guerrier, sauvegarde ratée) : +20 ft d'élévation ; l'effet retiré, il redescend ;
 *  - Inversion de la gravité (le Zombi, ratée) : en haut du Cylindre (100 ft) ; la concentration retirée, il chute — dégâts, À terre ;
 *  - Embruns prismatiques : une couleur tirée par cible (journal du moteur) ;
 *  - Vif carquois (combat, le Rôdeur) : deux attaques gratuites ouvertes ;
 *  - Invocation d'élémentaire : l'esprit à côté du Zombi ; au début du tour du Zombi, sa sauvegarde (areaTick `pulse`) ;
 *  - Invocation de céleste : le Cylindre sur le Guerrier ; à la fin de son tour, la Lumière guérisseuse (un allié) le soigne ;
 *  - Grêle d'épines : le Rôdeur touche le Zombi à l'arc, la question du châtiment y répond ; le Zombi et le Bandit à côté sauvegardent.
 * Remet positions, élévations, PV, effets, emplacements, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 5c — Lévitation, Inversion de la gravité, Embruns, Vif carquois, élémentaire, céleste, Grêle d'épines",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Clerc", "Guerrier", "Rôdeur", "Bandit", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, cleric, fighter, ranger, bandit, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, cleric, fighter, ranger, bandit, zombi];
    const grid = await ctx.gridSize();
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const tokens0 = new Set(tokens.map(t => t.id));
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const t of all ) await clearNew(t);
      await pause(2500);
      for ( const t of await ctx.liveTokens() ) if ( !tokens0.has(t.id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: t.id }).catch(() => {});
      for ( const t of all ) {
        for ( const s of ["prone", "restrained", "blinded"] ) await ctx.removeStatusEffects(t, s).catch(() => {});
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const lend = (t, id, system={ method: "atwill" }) => ctx.ensureItem(t, PHB + id, { system });
    const settled = async used => { const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null; await pause(2000); return r; };
    const elevation = async t => (await ctx.position(t)).elevation ?? 0;
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId; };
    const fight = async order => {
      await ctx.startCombat(order);
      const c = await state();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 10 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 4) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      return (await current()) === order[0].id;
    };
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3500); };
    const tiny = async t => { const b = await ctx.box(t); return { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: b.width * 0.6 }; };

    await part("Lévitation", async () => {
      const id = await lend(mage, "phbsplLevitate00");
      for ( let n = 1; n <= 15; n++ ) {
        await clearNew(fighter);
        const r = await settled(await ctx.use({ tokenId: mage.id, itemId: id, targetTokenIds: [fighter.id], consume: false }));
        if ( r?.targets?.[0]?.save?.success === false ) break;
      }
      const up = await elevation(fighter);
      ctx.expect(up === 20, `Lévitation : le Guerrier à ${up} ft`);
      // §195 : en l'air, il lévite — dnd5e ne le met pas « En chute » (immunité portée par l'effet) ; l'effet fini, il se pose en douceur.
      await pause(1500);
      const aloft = (await ctx.effects(fighter)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
      ctx.expect(!aloft.includes("falling"), `Lévitation : en l'air sans « En chute » (${aloft.join(", ") || "aucun état"})`);
      const hpUp = await ctx.hp(fighter);
      const since = await ctx.lastMessageId();
      await clearNew(mage); await clearNew(fighter);
      await pause(2500);
      const landed = (await ctx.effects(fighter)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
      const fallCard = (await ctx.messagesSince(since)).some(m => (m.type === "damage") && m.flags?.dnd5e?.context?.fall);
      ctx.expect((await elevation(fighter)) === 0, `Lévitation : l'effet retiré, il redescend à ${await elevation(fighter)} ft`);
      ctx.expect(((await ctx.hp(fighter)) === hpUp) && !fallCard && !landed.includes("falling") && !landed.includes("prone"),
        `Lévitation : posé en douceur — PV ${hpUp} → ${await ctx.hp(fighter)}, carte de chute ${fallCard ? "postée" : "aucune"}, ${landed.join(", ") || "aucun état"}`);
    });

    await part("Inversion de la gravité", async () => {
      const id = await lend(mage, "phbsplReverseGra");
      const hp = await ctx.hp(zombi);
      let lifted = false;
      for ( let n = 1; (n <= 15) && !lifted; n++ ) {
        await clearNew(mage);
        await pause(1500);
        const r = await settled(await ctx.use({ tokenId: mage.id, itemId: id, activityType: "save", consume: false, area: await tiny(zombi) }));
        lifted = (r?.targets?.find(t => t.name === "Zombi")?.save?.success === false);
      }
      if ( !ctx.expect(lifted && ((await elevation(zombi)) === 100), `Inversion de la gravité : le Zombi en haut (${await elevation(zombi)} ft)`) ) return;
      await clearNew(mage);
      await pause(4000);
      const statuses = (await ctx.effects(zombi)).flatMap(e => e.statuses ?? []);
      ctx.expect(((await elevation(zombi)) === 0) && statuses.includes("prone") && ((await ctx.hp(zombi)) < hp),
        `Inversion de la gravité : la chute — ${await elevation(zombi)} ft, ${hp} → ${await ctx.hp(zombi)} PV, ${statuses.includes("prone") ? "À terre" : "debout"}`);
    });

    await part("Embruns prismatiques", async () => {
      const id = await lend(mage, "phbsplPrismaticS");
      await settled(await ctx.use({ tokenId: mage.id, itemId: id, activityType: "save", targetTokenIds: [zombi.id], consume: false, area: await tiny(zombi) }));
      const log = (await ctx.engineLog()).filter(l => /Prismatic Spray: Zombi/.test(l));
      ctx.expect(log.length > 0, `Embruns prismatiques : ${log.at(-1) ?? "pas de couleur tirée"}`);
    });

    await part("Vif carquois", async () => {
      const id = await lend(ranger, "phbsplSwiftQuive");
      if ( !ctx.expect(await fight([ranger, zombi]), "Vif carquois : tour du Rôdeur") ) return;
      await settled(await ctx.use({ tokenId: ranger.id, itemId: id, activityId: "DE7WqJFIWGteZ8xU", targetTokenIds: [ranger.id], consume: false }));
      const b = await ctx.engine("budget", { tokenId: ranger.id });
      ctx.expect((b?.flurry === 2) && (b?.flurryAny === true), `Vif carquois : deux attaques gratuites (${b?.flurry}, toute arme : ${b?.flurryAny})`);
    });

    await part("Invocation d'élémentaire", async () => {
      const id = await lend(mage, "phbsplConjureEle");
      if ( !ctx.expect(await fight([mage, zombi]), "Élémentaire : tour du Magicien") ) return;
      const z = await ctx.position(zombi);
      const s = await ctx.engine("summonAt", { tokenId: mage.id, itemId: id, x: z.x + grid, y: z.y });
      await pause(2500);
      if ( !ctx.expect(!!s?.tokens?.[0], `Élémentaire : invoqué (${s?.tokens?.[0]?.name ?? "rien"})`) ) return;
      const since = await ctx.lastMessageId();
      await next();   // début du tour du Zombi
      const tick = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.event === "pulse"));
      ctx.expect(!!tick, "Élémentaire : le Zombi commence son tour à côté → la sauvegarde de l'esprit");
    });

    await part("Invocation de céleste", async () => {
      const id = await lend(cleric, "phbsplConjureCel");
      if ( !ctx.expect(await fight([cleric, fighter]), "Céleste : tour du Clerc") ) return;
      await ctx.setHp(fighter, 1);
      await settled(await ctx.use({ tokenId: cleric.id, itemId: id, activityId: "VjKltnyiWXZ0xDGZ", consume: false, area: await tiny(fighter) }));
      const before = await ctx.hp(fighter);
      await next(); await next();   // fin du tour du Guerrier
      await pause(2000);
      const log = (await ctx.engineLog()).filter(l => /Healing Light|Searing Light/.test(l)).slice(-2);
      ctx.expect((await ctx.hp(fighter)) > before, `Céleste : le Guerrier (allié) finit son tour dans le Cylindre → ${before} → ${await ctx.hp(fighter)} PV ${log.join(" / ")}`);
    });

    await part("Grêle d'épines", async () => {
      await lend(ranger, "phbsplHailofThor", {});
      const actor0 = await ctx.call("get-actor", { actorId: ranger.actorId });
      const slot0 = actor0.system?.spells?.spell1?.value ?? 0;
      await ctx.call("update-actor", { actorId: ranger.actorId, actorData: { "system.spells.spell1.value": Math.max(2, slot0) } });
      ctx.restore(() => ctx.call("update-actor", { actorId: ranger.actorId, actorData: { "system.spells.spell1.value": slot0 } }).catch(() => {}));
      const bow = (actor0.items ?? []).find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack" && a.attack?.type?.value === "ranged"))?._id;
      if ( !ctx.expect(!!bow, "Grêle d'épines : le Rôdeur a une arme à distance") ) return;
      const z = await ctx.position(zombi);
      await ctx.call("move-token", { tokenId: bandit.id, x: z.x + grid, y: z.y, elevation: 0 }); await pause(800);
      // Le Zombi (15 PV) tombait sous la flèche : il faut qu'il soit encore debout pour sauvegarder (remis par `reset`).
      for ( const t of [zombi, bandit] ) await ctx.setHp(t, 100);
      for ( let n = 1; n <= 10; n++ ) {
        const ids = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: ranger.id, itemId: bow, activityType: "attack", targetTokenIds: [zombi.id] });
        let asked = false;
        for ( const stop = Date.now() + 9000; Date.now() < stop && !asked; ) {
          const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null))?.windows?.[0];
          if ( !d ) continue;
          asked = true;
          const b = (d.buttons ?? []).find(x => /Hail|Grêle/i.test(x.label ?? ""));
          await ctx.call("answer-dialog", { id: d.id, button: b ? (b.action ?? b.label) : (d.buttons?.at(-1)?.action ?? d.buttons?.at(-1)?.label) }).catch(() => {});
        }
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.[0]?.hit !== true ) continue;
        await pause(4000);
        const log = (await ctx.engineLog()).filter(l => /Hail of Thorns: .* makes their saving throw/.test(l)).slice(-2);
        ctx.expect(log.some(l => /Zombi makes/.test(l)) && log.some(l => /Bandit, within/.test(l)), `Grêle d'épines : ${log.join(" / ") || "aucune sauvegarde"}`);
        return;
      }
      ctx.expect(false, "Grêle d'épines : aucun coup en 10 essais");
    });
  }
};
