/**
 * Relevé des sorts, lot 5a (SPEC §161), monde `dnd-6`, arène. Sorts prêtés du Manuel des joueurs (à volonté).
 *  - Détection de l'invisibilité : le Zombi Invisible — le Désavantage du Magicien contre lui disparaît une fois le sort lancé ;
 *  - Injonction (Compulsion) : Charmé sur un échec ; à la fin du tour du Zombi, la sauvegarde est rejouée ;
 *  - Télékinésie : Entravé sur un échec, jusqu'à la fin du prochain tour du lanceur ;
 *  - Sphère résiliente d'Otiluke : le Zombi enfermé ne perd aucun PV ;
 *  - Globe d'invulnérabilité : le Paladin et le Guerrier dedans, le Zombi dehors lance Flamme sacrée sur le Guerrier → hors d'atteinte ;
 *  - Clignotement : l'effet ne porte plus Éthéré ; en fin de tour, sur 4–6, Éthéré, retiré au début du tour suivant ;
 *  - Invocation d'élémentaires mineurs : l'attaque du Magicien contre le Zombi à 4,50 m reçoit 2d8 de plus.
 * Remet positions, PV, effets, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 5a — invisibilité, Injonction, Télékinésie, Otiluke, Globe, Clignotement, élémentaires mineurs",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Paladin", "Guerrier", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, pal, fighter, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, pal, fighter, zombi];
    const grid = await ctx.gridSize();
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
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const t of all ) {
        await clearNew(t);
        for ( const s of ["invisible", "charmed", "restrained", "ethereal"] ) await ctx.removeStatusEffects(t, s).catch(() => {});
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
    const lend = (t, id) => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
    const settled = async used => { const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null; await pause(1500); return r; };
    const statuses = async t => (await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
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
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3000); };
    const weaponOf = async t => ((await ctx.call("get-actor", { actorId: t.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"))?._id ?? null;
    /** Jusqu'à une sauvegarde ratée (15 essais) ; rend la résolution. */
    const untilFailed = async (caster, itemId, target, activityType="save") => {
      for ( let n = 1; n <= 15; n++ ) {
        await clearNew(target); await clearNew(caster);
        const r = await settled(await ctx.use({ tokenId: caster.id, itemId, activityType, targetTokenIds: [target.id], consume: false }));
        if ( r?.targets?.find(x => x.name === target.name)?.save?.success === false ) return r;
      }
      return null;
    };

    await part("Détection de l'invisibilité", async () => {
      const id = await lend(mage, "phbsplSeeInvisib");
      const weapon = await weaponOf(mage);
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: true });
      await pause(1000);
      const before = (await ctx.engine("attackReasons", { attackerId: mage.id, targetId: zombi.id, itemId: weapon })).disadvantage;
      await settled(await ctx.use({ tokenId: mage.id, itemId: id, targetTokenIds: [mage.id], consume: false }));
      const after = (await ctx.engine("attackReasons", { attackerId: mage.id, targetId: zombi.id, itemId: weapon })).disadvantage;
      ctx.expect(before.some(r => /invisible|unseen|vu/i.test(r)) && !after.some(r => /invisible|unseen|vu/i.test(r)),
        `Détection de l'invisibilité : ${before.join(", ") || "aucun Désavantage"} → ${after.join(", ") || "aucun Désavantage"}`);
    });

    await part("Injonction", async () => {
      const id = await lend(mage, "phbsplCompulsion");
      if ( !ctx.expect(await fight([mage, zombi]), "Injonction : tour du Magicien") ) return;
      const r = await untilFailed(mage, id, zombi);
      if ( !ctx.expect(!!r && (await statuses(zombi)).includes("charmed"), "Injonction : Charmé sur un échec") ) return;
      await next(); await next();   // fin du tour du Zombi
      const log = (await ctx.engineLog()).filter(l => /repeats the saving throw/.test(l) && /Zombi/.test(l));
      ctx.expect(log.length > 0, `Injonction : sauvegarde rejouée à la fin du tour du Zombi (${log.at(-1) ?? "rien"})`);
    });

    await part("Télékinésie", async () => {
      const id = await lend(mage, "phbsplTelekinesi");
      if ( !ctx.expect(await fight([mage, zombi]), "Télékinésie : tour du Magicien") ) return;
      const r = await untilFailed(mage, id, zombi);
      if ( !ctx.expect(!!r, "Télékinésie : une sauvegarde ratée") ) return;
      const restrained = async () => (await statuses(zombi)).includes("restrained");
      ctx.expect(await restrained(), "Télékinésie : Entravé");
      await next(); ctx.expect(await restrained(), "Télékinésie : tour du Zombi → toujours Entravé");
      await next(); ctx.expect(await restrained(), "Télékinésie : tour suivant du Magicien → toujours Entravé");
      await next(); ctx.expect(!(await restrained()), "Télékinésie : fin du tour suivant du Magicien → plus Entravé");
    });

    await part("Sphère résiliente d'Otiluke", async () => {
      const id = await lend(mage, "phbsplOtilukesRe");
      const r = await untilFailed(mage, id, zombi);
      if ( !ctx.expect(!!r, "Otiluke : une sauvegarde ratée") ) return;
      const hp = await ctx.hp(zombi);
      await ctx.engine("hurt", { tokenId: zombi.id, amount: 8, type: "fire" });
      await pause(1000);
      ctx.expect((await ctx.hp(zombi)) === hp, `Otiluke : 8 dégâts de feu → ${hp} → ${await ctx.hp(zombi)} PV`);
    });

    await part("Globe d'invulnérabilité", async () => {
      const id = await lend(pal, "phbsplGlobeofInv");
      const p = await ctx.position(pal);
      await ctx.call("move-token", { tokenId: fighter.id, x: p.x - grid, y: p.y, elevation: 0 }); await pause(1000);
      await settled(await ctx.use({ tokenId: pal.id, itemId: id, targetTokenIds: [pal.id], consume: false }));
      const flame = await lend(zombi, "phbsplSacredFlam");
      const hp = await ctx.hp(fighter);
      await settled(await ctx.use({ tokenId: zombi.id, itemId: flame, targetTokenIds: [fighter.id], consume: false }));
      const log = (await ctx.engineLog()).filter(l => /unaffected/.test(l) && /globe/i.test(l));
      ctx.expect(log.length > 0 && ((await ctx.hp(fighter)) === hp), `Globe : Flamme sacrée lancée du dehors → ${log.at(-1) ?? "rien au journal"}, PV ${hp} → ${await ctx.hp(fighter)}`);
    });

    await part("Clignotement", async () => {
      const id = await lend(mage, "phbsplBlink00000");
      if ( !ctx.expect(await fight([mage, zombi]), "Clignotement : tour du Magicien") ) return;
      await settled(await ctx.use({ tokenId: mage.id, itemId: id, targetTokenIds: [mage.id], consume: false }));
      ctx.expect(!(await statuses(mage)).includes("ethereal"), "Clignotement : l'effet ne porte plus Éthéré d'office");
      let seen = false;
      for ( let round = 1; (round <= 8) && !seen; round++ ) {
        await next();   // fin du tour du Magicien : le d6
        if ( (await statuses(mage)).includes("ethereal") ) {
          seen = true;
          await next();   // début de son tour suivant
          ctx.expect(!(await statuses(mage)).includes("ethereal"), "Clignotement : de retour au début de son tour");
        }
        else await next();
      }
      ctx.expect(seen, "Clignotement : un 4–6 en huit rounds → Éthéré");
    });

    await part("Invocation d'élémentaires mineurs", async () => {
      const id = await lend(mage, "phbsplConjureMin");
      const weapon = await weaponOf(mage);
      const m = await ctx.position(mage);
      await ctx.call("move-token", { tokenId: zombi.id, x: m.x + grid, y: m.y, elevation: 0 }); await pause(1000);
      await settled(await ctx.use({ tokenId: mage.id, itemId: id, activityId: "VSwMJFQoi3KU3Ais", targetTokenIds: [mage.id], consume: false }));
      for ( let n = 1; n <= 10; n++ ) {
        const r = await settled(await ctx.use({ tokenId: mage.id, itemId: weapon, activityType: "attack", targetTokenIds: [zombi.id] }));
        if ( r?.targets?.[0]?.hit !== true ) continue;
        const log = (await ctx.engineLog()).filter(l => /bonus damage: .*Minor Elementals|bonus damage: .*élémentaires/i.test(l));
        ctx.expect(log.length > 0, `Élémentaires mineurs : ${log.at(-1) ?? "pas de dés en plus"}`);
        return;
      }
      ctx.expect(false, "Élémentaires mineurs : aucune attaque touchée en 10 essais");
    });
  }
};
