/**
 * Relevé des sorts, lot 4 : soins, états guéris, seuils de PV (SPEC §160), monde `dnd-6`, arène. Sorts prêtés du Manuel des joueurs
 * (à volonté) ; les dés de soins ou de dégâts laissés au système passent par `api.mcp.rollCard`.
 *  - Mot de pouvoir mortel : Zombi à 22 PV → Mort, PV 0 ; à 300 PV → les dégâts, pas Mort ;
 *  - Mot de pouvoir étourdissant : à 22 PV → Étourdi, pas « No Movement » ; à 300 → l'inverse ;
 *  - Parole divine (sauvegarde ratée) : à 15 PV → Mort ; à 35 → Aveuglé et Assourdi ; à 300 → rien ;
 *  - Guérison : Aveuglé et Empoisonné cessent ; Guérison de groupe : Empoisonné cesse sur deux cibles ;
 *  - Restauration suprême : Épuisement 2 → 1 ;
 *  - Délivrance des malédictions : le Maléfice du Magicien sur le Zombi cesse ;
 *  - Régénération (combat) : +1 PV au début du tour du Guerrier ;
 *  - Mot de pouvoir fortifiant : 60 PV temporaires à chacune de deux cibles ;
 *  - Résurrection : le Guerrier mort revient à ses PV max.
 * Remet PV, PV max, effets, états, Épuisement, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 4 — soins, états, seuils de PV",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Clerc", "Guerrier", "Paladin", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, cleric, fighter, pal, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, cleric, fighter, pal, zombi];
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { hp: await ctx.hp(t), stats: await ctx.engine("stats", { tokenId: t.id }) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const exhaustion0 = (await ctx.call("get-actor", { actorId: fighter.actorId })).system?.attributes?.exhaustion ?? 0;
    const temps0 = new Map();
    const sceneId = (await ctx.scene()).sceneId;
    const linked = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.actorLink;
    const targetOf = async t => (await linked(t)) ? { documentType: "Actor", id: t.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${t.actorId}` };
    const setTemp = async (t, v) => (await linked(t))
      ? ctx.call("update-actor", { actorId: t.actorId, actorData: { "system.attributes.hp.temp": v } })
      : ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.temp": v } });
    const temp = async t => (await ctx.engine("stats", { tokenId: t.id }))?.hp?.temp ?? (await linked(t)
      ? (await ctx.call("get-actor", { actorId: t.actorId })).system?.attributes?.hp?.temp ?? 0
      : (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.delta?.system?.attributes?.hp?.temp ?? 0);
    for ( const t of all ) temps0.set(t.id, await temp(t));
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const { data: zdata } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const zmax0 = zdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
      data: zmax0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": zmax0 } }).catch(() => {}));
    const zombiAt = hp => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": hp } });
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const t of all ) {
        await clearNew(t);
        for ( const s of ["dead", "unconscious", "prone", "stunned", "blinded", "deafened", "poisoned"] ) await ctx.removeStatusEffects(t, s).catch(() => {});
        await ctx.setHp(t, homes.get(t.id).hp);
        await setTemp(t, temps0.get(t.id)).catch(() => {});
      }
      await ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.exhaustion": exhaustion0 } });
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const lend = (t, id) => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
    /** Utilise, clique les dés laissés au système, attend la résolution. */
    const cast = async (caster, itemId, targets, extra={}) => {
      const used = await ctx.use({ tokenId: caster.id, itemId, targetTokenIds: targets.map(t => t.id), consume: false, ...extra });
      await pause(1500);
      if ( used.usageMessageId ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null);
      const r = used.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(2500);
      return r;
    };
    const statuses = async t => (await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const has = async (t, s) => (await statuses(t)).includes(s);
    const status = (t, s, active=true) => ctx.call("set-status", { tokenId: t.id, statusId: s, active });

    await part("Mot de pouvoir mortel", async () => {
      const id = await lend(mage, "phbsplPowerWordK");
      await zombiAt(22);
      await cast(mage, id, [zombi]);
      ctx.expect((await has(zombi, "dead")) && ((await ctx.hp(zombi)) === 0), `Mot de pouvoir mortel, 22 PV : Mort (${await ctx.hp(zombi)} PV)`);
      await clearNew(zombi); await ctx.removeStatusEffects(zombi, "dead").catch(() => {});
      await zombiAt(300);
      await cast(mage, id, [zombi]);
      const hp = await ctx.hp(zombi);
      ctx.expect(!(await has(zombi, "dead")) && (hp < 300), `Mot de pouvoir mortel, 300 PV : ${300 - hp} dégâts, pas Mort`);
    });

    await part("Mot de pouvoir étourdissant", async () => {
      const id = await lend(mage, "phbsplPowerWordS");
      await zombiAt(22);
      await cast(mage, id, [zombi]);
      const low = (await ctx.effectsFrom(zombi, "power-word-stun")).map(e => e.effect);
      ctx.expect((await has(zombi, "stunned")) && !low.some(n => /Movement|déplacement/i.test(n)), `Mot de pouvoir étourdissant, 22 PV : Étourdi seul (${low.join(", ")})`);
      await clearNew(zombi);
      await zombiAt(300);
      await cast(mage, id, [zombi]);
      const high = (await ctx.effectsFrom(zombi, "power-word-stun")).map(e => e.effect);
      ctx.expect(!(await has(zombi, "stunned")) && (high.length === 1), `Mot de pouvoir étourdissant, 300 PV : Vitesse 0 seule (${high.join(", ")})`);
    });

    await part("Parole divine", async () => {
      const id = await lend(cleric, "phbsplDivineWord");
      const tier = async (hp, check, label) => {
        for ( let n = 1; n <= 15; n++ ) {
          await clearNew(zombi); await ctx.removeStatusEffects(zombi, "dead").catch(() => {});
          await zombiAt(hp);
          const r = await cast(cleric, id, [zombi]);
          if ( r?.targets?.[0]?.save?.success !== false ) continue;
          ctx.expect(await check(), `Parole divine, ${hp} PV (sauvegarde ratée) : ${label} — ${(await statuses(zombi)).join(", ") || "rien"}`);
          return;
        }
        ctx.expect(false, `Parole divine, ${hp} PV : aucune sauvegarde ratée en 15 essais`);
      };
      await tier(15, () => has(zombi, "dead"), "Mort");
      await tier(35, async () => (await has(zombi, "blinded")) && (await has(zombi, "deafened")) && !(await has(zombi, "stunned")), "Aveuglé et Assourdi");
      await tier(300, async () => !(await statuses(zombi)).some(s => ["dead", "blinded", "deafened", "stunned"].includes(s)), "rien");
    });

    await part("Guérison", async () => {
      const id = await lend(cleric, "phbsplHeal000000");
      await status(fighter, "blinded"); await status(fighter, "poisoned");
      await cast(cleric, id, [fighter]);
      ctx.expect(!(await has(fighter, "blinded")) && !(await has(fighter, "poisoned")), `Guérison : Aveuglé et Empoisonné cessent (${(await statuses(fighter)).join(", ") || "aucun état"})`);
    });

    await part("Guérison de groupe", async () => {
      const id = await lend(cleric, "phbsplMassHeal00");
      await status(fighter, "poisoned"); await status(pal, "poisoned");
      await cast(cleric, id, [fighter, pal]);
      ctx.expect(!(await has(fighter, "poisoned")) && !(await has(pal, "poisoned")), "Guérison de groupe : Empoisonné cesse sur les deux cibles");
    });

    await part("Restauration suprême", async () => {
      const id = await lend(cleric, "phbsplGreaterRes");
      await ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.exhaustion": 2 } });
      await pause(1000);
      const ids = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const used = await ctx.use({ tokenId: cleric.id, itemId: id, targetTokenIds: [fighter.id], consume: false });
      for ( const stop = Date.now() + 8000; Date.now() < stop; ) {
        const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null))?.windows?.[0];
        if ( !d ) continue;
        const b = (d.buttons ?? []).find(x => /puis|xhaust/i.test(x.label ?? ""));
        await ctx.call("answer-dialog", { id: d.id, button: b ? (b.action ?? b.label) : (d.buttons?.[0]?.action ?? d.buttons?.[0]?.label) }).catch(() => {});
        break;
      }
      await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(2000);
      const level = (await ctx.call("get-actor", { actorId: fighter.actorId })).system?.attributes?.exhaustion;
      ctx.expect(level === 1, `Restauration suprême : Épuisement 2 → ${level}`);
    });

    await part("Délivrance des malédictions", async () => {
      const hex = await lend(mage, "phbsplHex0000000");
      // Le moteur demande la caractéristique visée (fenêtre « Hex — … », effets au choix) : la première.
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const casting = cast(mage, hex, [zombi]);
      for ( let i = 0, answered = false; (i < 8) && !answered; i++ ) {
        const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 1500, details: true }).catch(() => null))?.windows?.[0];
        if ( d?.buttons?.length ) { await ctx.call("answer-dialog", { id: d.id, button: d.buttons[0].action ?? d.buttons[0].label }).catch(() => {}); answered = true; }
      }
      await casting;
      const hexed = (await ctx.effectsFrom(zombi, "hex")).length > 0;
      if ( !ctx.expect(hexed, "Maléfice posé sur le Zombi") ) return;
      const id = await lend(cleric, "phbsplRemoveCurs");
      await cast(cleric, id, [zombi]);
      ctx.expect(!(await ctx.effectsFrom(zombi, "hex")).length, "Délivrance des malédictions : le Maléfice cesse sur le Zombi");
    });

    await part("Régénération", async () => {
      const id = await lend(cleric, "phbsplRegenerate");
      await ctx.startCombat([cleric, fighter]);
      const st = await ctx.combat(); const c = st.combat ?? st.combats?.[0] ?? st;
      await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === cleric.id).id, value: 20, combatId: ctx.ownCombat });
      await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === fighter.id).id, value: 10, combatId: ctx.ownCombat });
      for ( let i = 0; i < 3; i++ ) {
        const s = await ctx.combat(); const cc = s.combat ?? s.combats?.[0] ?? s;
        if ( cc.combatants?.find(x => x.id === cc.currentCombatantId)?.tokenId === cleric.id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200);
      }
      await cast(cleric, id, [fighter]);
      await ctx.setHp(fighter, 1);   // le soin de la pose l'a remis au maximum : de la marge pour le PV du début de tour
      await pause(1000);
      const after = await ctx.hp(fighter);
      await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3500);
      ctx.expect((await ctx.hp(fighter)) === after + 1, `Régénération : début du tour du Guerrier ${after} → ${await ctx.hp(fighter)} PV`);
    });

    await part("Mot de pouvoir fortifiant", async () => {
      const id = await lend(cleric, "phbsplPowerWordF");
      await setTemp(fighter, 0); await setTemp(pal, 0);
      await cast(cleric, id, [fighter, pal]);
      ctx.expect(((await temp(fighter)) === 60) && ((await temp(pal)) === 60), `Mot de pouvoir fortifiant : ${await temp(fighter)} et ${await temp(pal)} PV temporaires`);
    });

    await part("Résurrection", async () => {
      const id = await lend(cleric, "phbsplResurrecti");
      await ctx.setHp(fighter, 0); await status(fighter, "dead");
      await pause(1000);
      await cast(cleric, id, [fighter], { activityType: "utility" });
      const max = homes.get(fighter.id).stats?.hp?.max;
      ctx.expect(!(await has(fighter, "dead")) && ((await ctx.hp(fighter)) === max), `Résurrection : ${await has(fighter, "dead") ? "toujours Mort" : "vivant"}, ${await ctx.hp(fighter)}/${max} PV`);
    });
  }
};
