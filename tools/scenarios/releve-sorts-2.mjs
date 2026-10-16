/**
 * Relevé des sorts, lot 1, seconde moitié (SPEC §157), monde `dnd-6`, arène — sorts prêtés depuis le Manuel des joueurs :
 *  - Flèche acide de Melf ratée : la moitié des dégâts, pas d'acide persistant ;
 *  - Fracassement sur une Créature artificielle (le Zombi le devient le temps du test) : sauvegarde avec le Désavantage ;
 *  - Héroïsme (combat) : les PV temporaires reviennent au début du tour du Guerrier ;
 *  - Sommeil (combat, le Bandit) : à la fin de son tour, réussie → l'effet tombe, ratée → Inconscient ;
 *  - Hâte (combat) : au début de son tour, le Guerrier a l'action limitée ;
 *  - Bouclier contre Projectile magique (le Zombi le lance sur le Magicien, réaction prise d'office) : Bouclier posé, aucun dégât.
 * Remet positions, PV, effets, emplacements, type de créature, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 1 (suite) — Melf, Fracassement, Héroïsme, Sommeil, Hâte, Bouclier",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Guerrier", "Clerc", "Bandit", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, fighter, cleric, bandit, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, fighter, cleric, bandit, zombi];
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
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
    const temp = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( !data.actorLink ) return data.delta?.system?.attributes?.hp?.temp ?? 0;
      return (await ctx.call("get-actor", { actorId: data.actorId })).system?.attributes?.hp?.temp ?? 0;
    };
    const setTemp = async (t, value) => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.actorLink ) await ctx.call("update-actor", { actorId: t.actorId, actorData: { "system.attributes.hp.temp": value } });
      else await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.temp": value } });
    };
    const temps0 = new Map();
    for ( const t of all ) temps0.set(t.id, await temp(t));
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };
    const reset = async () => {
      await endCombat();
      for ( const t of all ) {
        await clearNew(t);
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
        await setTemp(t, temps0.get(t.id)).catch(() => {});
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const lend = (t, id) => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
    const settled = async used => (await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null));
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId; };
    /** Combat à l'ordre donné (initiatives 20, 15, 10…), tour du premier. */
    const fight = async order => {
      await ctx.startCombat(order);
      const c = await state();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 4) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      return (await current()) === order[0].id;
    };
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3000); };

    await part("Flèche acide de Melf", async () => {
      const id = await lend(mage, "phbsplMelfsAcidA");
      for ( let n = 1; n <= 20; n++ ) {
        await clearNew(zombi);
        await ctx.setHp(zombi, homes.get(zombi.id).hp);
        const r = await settled(await ctx.use({ tokenId: mage.id, itemId: id, activityType: "attack", targetTokenIds: [zombi.id], consume: false }));
        await pause(1500);
        const t = r?.targets?.find(x => x.name === "Zombi");
        if ( t?.hit !== false ) continue;
        const lost = homes.get(zombi.id).hp - await ctx.hp(zombi);
        ctx.expect(lost > 0, `Melf raté (${r.attack?.roll?.total} contre CA ${t.ac}) : ${lost} PV perdus (la moitié)`);
        ctx.expect(!(await ctx.effectsFrom(zombi, "melfs-acid-arrow")).length, "Melf raté : pas d'acide persistant");
        return;
      }
      ctx.expect(false, "Melf : aucun raté en 20 essais");
    });

    await part("Fracassement", async () => {
      const id = await lend(mage, "phbsplShatter000");
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
      const type0 = data.delta?.system?.details?.type?.value ?? null;
      await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.details.type.value": "construct" } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
        data: type0 === null ? { "delta.system.details.type.-=value": null } : { "delta.system.details.type.value": type0 } }).catch(() => {}));
      const g = await ctx.position(zombi);
      const grid = await ctx.gridSize();
      await settled(await ctx.use({ tokenId: mage.id, itemId: id, activityType: "save", targetTokenIds: [zombi.id], consume: false,
        area: { shape: "circle", x: g.x + grid / 2, y: g.y + grid / 2, radius: grid } }));
      await pause(1500);
      const log = (await ctx.engineLog()).filter(l => /Shatter|Fracassement/.test(l) && /Disadvantage/.test(l));
      ctx.expect(log.length > 0, `Fracassement : le Zombi (Créature artificielle) sauvegarde avec le Désavantage (${log.at(-1) ?? "rien au journal"})`);
    });

    await part("Héroïsme", async () => {
      const id = await lend(cleric, "phbsplHeroism000");
      if ( !ctx.expect(await fight([cleric, fighter]), "Héroïsme : tour du Clerc") ) return;
      // Les PV temporaires attendent le clic « Soins » de la carte (api.mcp.rollCard), comme au scénario clerc.
      const u = await ctx.use({ tokenId: cleric.id, itemId: id, targetTokenIds: [fighter.id], consume: false });
      await pause(1500);
      await ctx.engine("rollCard", { messageId: u.usageMessageId }).catch(() => null);
      await settled(u);
      await pause(2000);
      ctx.expect((await ctx.effectsFrom(fighter, "heroism")).length > 0, "Héroïsme : l'effet est sur le Guerrier");
      const given = await temp(fighter);
      ctx.expect(given > 0, `Héroïsme : ${given} PV temporaires à la pose`);
      await setTemp(fighter, 0);
      await next();
      ctx.expect((await current()) === fighter.id, "Héroïsme : tour du Guerrier");
      ctx.expect((await temp(fighter)) === given, `Héroïsme : début du tour du Guerrier → ${await temp(fighter)} PV temporaires`);
    });

    await part("Sommeil", async () => {
      const id = await lend(mage, "phbsplSleep00000");
      if ( !ctx.expect(await fight([mage, bandit]), "Sommeil : tour du Magicien") ) return;
      const g = await ctx.position(bandit);
      const grid = await ctx.gridSize();
      let asleep = false;
      for ( let n = 1; (n <= 15) && !asleep; n++ ) {
        await clearNew(bandit);
        const r = await settled(await ctx.use({ tokenId: mage.id, itemId: id, activityType: "save", targetTokenIds: [bandit.id], consume: false,
          area: { shape: "circle", x: g.x + grid / 2, y: g.y + grid / 2, radius: grid } }));
        await pause(1500);
        asleep = r?.targets?.find(x => x.name === "Bandit")?.save?.success === false;
      }
      if ( !ctx.expect(asleep, "Sommeil : le Bandit rate (15 essais au plus)") ) return;
      ctx.expect((await ctx.effectsFrom(bandit, "sleep")).some(e => (e.statuses ?? []).includes("incapacitated")), "Sommeil : Neutralisé");
      await next();   // tour du Bandit
      await next();   // fin de son tour : la seconde sauvegarde
      await pause(2500);
      const fx = await ctx.effectsFrom(bandit, "sleep");
      const unconscious = fx.some(e => (e.statuses ?? []).includes("unconscious"));
      ctx.expect(!fx.length || unconscious, `Sommeil : seconde sauvegarde → ${!fx.length ? "réussie, l'effet tombe" : unconscious ? "ratée, Inconscient" : "rien (défaut)"}`);
    });

    await part("Hâte", async () => {
      const id = await lend(mage, "phbsplHaste00000");
      if ( !ctx.expect(await fight([mage, fighter]), "Hâte : tour du Magicien") ) return;
      await settled(await ctx.use({ tokenId: mage.id, itemId: id, activityType: "utility", targetTokenIds: [fighter.id], consume: false }));
      await pause(1500);
      ctx.expect((await ctx.effectsFrom(fighter, "haste")).length > 0, "Hâte : l'effet est sur le Guerrier");
      await next();
      const b = await ctx.engine("budget", { tokenId: fighter.id });
      ctx.expect(b?.limited === 1, `Hâte : début du tour du Guerrier, action limitée (${b?.limited}), action ${b?.action}`);
    });

    await part("Bouclier contre Projectile magique", async () => {
      await lend(mage, "phbsplShield0000").then(() => null);
      const shieldId = await ctx.itemId(mage.id, "shield");
      await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.method": "spell" }, match: { path: "_id", value: shieldId } }).catch(() => {});
      const slot0 = (await ctx.call("get-actor", { actorId: mage.actorId })).system?.spells?.spell1?.value ?? 0;
      await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.spells.spell1.value": Math.max(1, slot0) } });
      ctx.restore(() => ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.spells.spell1.value": slot0 } }).catch(() => {}));
      const mm = await lend(zombi, "phbsplMagicMissi");
      const hp = await ctx.hp(mage);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: zombi.id, itemId: mm, targetTokenIds: [mage.id], consume: false, usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      await pause(12000);
      ctx.expect((await ctx.effectsFrom(mage, "shield")).length > 0, "Bouclier : pris en réaction, l'effet est sur le Magicien");
      ctx.expect((await ctx.hp(mage)) === hp, `Bouclier : aucun dégât de Projectile magique (${hp} → ${await ctx.hp(mage)})`);
      const usages = (await ctx.messagesSince(since)).filter(m => m.type === "usage").length;
      ctx.log(`${usages} carte(s) d'utilisation (projectiles et Bouclier)`);
    });
  }
};
