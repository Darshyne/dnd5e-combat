/**
 * Bottes d'arme (SPEC §21), monde `dnd-6`. Le Guerrier maîtrise l'épée à deux mains (Écorchure), le fléau (Sape) et la javeline
 * (Ralentissement) ; l'épée change de botte le temps d'une partie (Enchaînement, Poussée, Renversement, Ouverture). Le Bandit reçoit
 * 300 PV. Vérifie :
 *  - Écorchure : sur un raté, le Bandit perd le modificateur de Force du Guerrier ;
 *  - Sape : touché, le Bandit porte la marque ; sa prochaine attaque a le Désavantage, et la marque tombe ;
 *  - Ouverture : touché et blessé, la prochaine attaque du Guerrier contre lui a l'Avantage, et la marque tombe ;
 *  - Ralentissement : la Vitesse du Bandit baisse de 10 ft, une seule fois ;
 *  - Renversement : la sauvegarde de Constitution du Bandit (DD 8 + For + maîtrise), À terre ⇔ ratée ;
 *  - Poussée : la question s'ouvre ; « Repousser » l'éloigne de 10 ft ;
 *  - Enchaînement : la seconde attaque (drapeau `cleave`, sans coût) lance ses dégâts sans le modificateur de Force ;
 *  - en combat : Sape tombe au début du tour suivant du Guerrier, Ouverture à la fin de son tour suivant.
 * Remet l'épée, positions, PV, états.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "bottes — Écorchure, Sape, Ouverture, Ralentissement, Renversement, Poussée, Enchaînement",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const zombi = tokens.find(t => (t.name === "Zombi") && (t.level === fighter.level) && !t.hidden) ?? null;
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [fighter, bandit, zombi].filter(Boolean) ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(fighter.id).pos;

    const sword = await ctx.itemId(fighter.id, "greatsword");
    const flail = await ctx.itemId(fighter.id, "flail");
    const javelin = await ctx.itemId(fighter.id, "javelin");
    const setMastery = m => ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.mastery": m }, match: { path: "_id", value: sword } });
    ctx.restore(() => setMastery("graze").catch(() => {}));

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    // `move-token` (déplacement « displace ») : un update de x/y est contraint par les murs de la scène.
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of ["prone"] ) { await ctx.removeStatusEffects(t, s); await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {}); }
        await ctx.removeEffectsNamed(t, /^(Sape|Sap|Ouverture|Vex|Ralentissement|Slow) /i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
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

    /** Une attaque ; rend la résolution, les messages, le mode et le verdict. */
    const attack = async (attacker, itemId, target, usage={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: usage } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const att = msgs.find(m => m.type === "attack");
      return { r, msgs, since, usage: u.usageMessageId, hit: r?.targets?.find(t => t.name === target.name)?.hit ?? null,
        mode: att?.rolls?.[0]?.options?.advantageMode ?? null, mastery: att?.flags?.dnd5e?.mastery ?? null };
    };
    const until = async (want, fn, tries=20) => { for ( let i = 0; i < tries; i++ ) { const a = await fn(); if ( a.hit === want ) return a; } return null; };
    const effects = async t => (await ctx.effects(t)).filter(e => e.flags?.[MODULE_ID]?.mastery);
    const stats = t => ctx.engine("stats", { tokenId: t.id });
    const right = () => place(bandit, g.x + grid, g.y);

    await part("Écorchure", async () => {
      await tough(); await right();
      const str = (await stats(fighter))?.mods?.str ?? 0;
      let before = 300;
      const a = await until(false, async () => { await tough(); before = 300; return attack(fighter, sword, bandit); });
      if ( !ctx.expect(!!a, "épée à deux mains : raté (20 essais au plus)") ) return;
      const card = a.msgs.find(m => m.flags?.[MODULE_ID]?.mastery?.kind === "graze");
      ctx.expect(!!card, "carte d'Écorchure");
      const after = await ctx.hp(bandit);
      ctx.expect(before - after === Math.max(0, str), `raté : le Bandit perd ${before - after} PV (For ${str})`);
    });

    await part("Sape", async () => {
      await tough(); await right();
      const a = await until(true, () => attack(fighter, flail, bandit));
      if ( !ctx.expect(!!a, "fléau : touché (20 essais au plus)") ) return;
      ctx.expect((await effects(bandit)).some(e => e.flags[MODULE_ID].mastery.kind === "sap"), "le Bandit porte la Sape");
      const b = await attack(bandit, await ctx.itemId(bandit.id, "scimitar"), fighter);
      ctx.expect(b.mode === -1, `l'attaque suivante du Bandit a le Désavantage (mode ${b.mode})`);
      ctx.expect(!(await effects(bandit)).some(e => e.flags[MODULE_ID].mastery.kind === "sap"), "la Sape tombe à ce jet");
    });

    await part("Ouverture", async () => {
      await tough(); await right(); await setMastery("vex");
      const a = await until(true, () => attack(fighter, sword, bandit));
      if ( !ctx.expect(!!a, "épée (Ouverture) : touché (20 essais au plus)") ) return;
      ctx.expect((await effects(fighter)).some(e => e.flags[MODULE_ID].mastery.kind === "vex"), "le Guerrier porte l'Ouverture contre le Bandit");
      const b = await attack(fighter, sword, bandit);
      ctx.expect(b.mode === 1, `sa prochaine attaque contre lui a l'Avantage (mode ${b.mode})`);
      const left = (await effects(fighter)).filter(e => e.flags[MODULE_ID].mastery.kind === "vex");
      ctx.expect(!left.length || (b.hit === true), `l'Ouverture consommée tombe (${left.length} restante${b.hit ? ", reposée par ce nouveau coup" : ""})`);
    });

    await part("Ralentissement", async () => {
      await tough(); await right();
      const speed0 = (await stats(bandit))?.speed?.walk ?? null;
      const a = await until(true, () => attack(fighter, javelin, bandit));
      if ( !ctx.expect(!!a, "javeline : touché (20 essais au plus)") ) return;
      const speed1 = (await stats(bandit))?.speed?.walk ?? null;
      ctx.expect(speed1 === speed0 - 10, `Vitesse du Bandit ${speed0} → ${speed1}`);
      await until(true, () => attack(fighter, javelin, bandit));
      const speed2 = (await stats(bandit))?.speed?.walk ?? null;
      ctx.expect(speed2 === speed0 - 10, `touché deux fois : toujours −10 (${speed2})`);
    });

    await part("Renversement", async () => {
      await tough(); await right(); await setMastery("topple");
      const a = await until(true, () => attack(fighter, sword, bandit));
      if ( !ctx.expect(!!a, "épée (Renversement) : touché (20 essais au plus)") ) return;
      const save = (await ctx.messagesSince(a.since)).find(m => m.flags?.[MODULE_ID]?.mastery?.kind === "topple");
      if ( !ctx.expect(!!save, "la sauvegarde de Constitution du Bandit est lancée") ) return;
      const dc = save.flags[MODULE_ID].mastery.dc;
      const total = save.rolls?.[0]?.total;
      const prone = (await stats(bandit))?.statuses?.includes("prone");
      ctx.expect(prone === (total < dc), `À terre ⇔ ratée (${total} contre DD ${dc}, à terre : ${prone})`);
    });

    await part("Poussée", async () => {
      // Vers le bas : à droite du Guerrier, un mur arrête la poussée dans Restored Keep.
      await tough(); await place(bandit, g.x, g.y + grid); await setMastery("push");
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const since = await ctx.lastMessageId();
      let answered = false;
      for ( let i = 0; (i < 20) && !answered; i++ ) {
        const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
        for ( const stop = Date.now() + 12000; Date.now() < stop; ) {
          const r = await ctx.resolution(u.usageMessageId);
          if ( r?.step === "missed" ) break;
          const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 2000 }).catch(() => null))?.windows?.[0];
          if ( d ) {
            const b = (d.buttons ?? []).find(x => /Repousser|Push 10/i.test(x.label ?? ""));
            await ctx.call("answer-dialog", { id: d.id, button: b?.action ?? b?.label });
            answered = true;
            break;
          }
        }
        await ctx.settle(u.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      }
      if ( !ctx.expect(answered, "touché : la question de Poussée s'ouvre et on repousse") ) return;
      await pause(3000);
      const p = await ctx.position(bandit);
      ctx.expect(p.y === g.y + 3 * grid, `le Bandit recule de 10 ft (${(p.y - g.y) / grid} cases du Guerrier)`);
      void since;
    });

    if ( zombi ) await part("Enchaînement", async () => {
      await tough(); await right(); await setMastery("cleave");
      await place(zombi, g.x + grid, g.y - grid);
      const str = (await stats(fighter))?.mods?.str ?? 0;
      const first = `Scene.${(await ctx.scene()).sceneId}.Token.${bandit.id}`;
      const a = await until(true, () => attack(fighter, sword, zombi, { cost: "free", cleave: first }));
      if ( !ctx.expect(!!a, "seconde attaque d'Enchaînement : touché (20 essais au plus)") ) return;
      const dmg = a.msgs.find(m => m.type === "damage");
      const formula = (dmg?.rolls ?? []).map(r => r.formula).join(" | ");
      ctx.expect(!new RegExp(`\\+ ${str}(\\D|$)`).test(formula) && (str > 0), `dégâts sans le modificateur de Force (+${str}) : « ${formula} »`);
    });

    await part("marques en combat", async () => {
      await tough(); await right(); await setMastery("vex");
      await ctx.startCombat([fighter, bandit]);
      const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
      const combat = await state();
      for ( const [t, v] of [[fighter, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
      for ( let i = 0; (i < 3) && ((await current()) !== fighter.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      const s = await until(true, () => attack(fighter, flail, bandit));
      const v = await until(true, () => attack(fighter, sword, bandit));
      if ( !ctx.expect(!!s && !!v, "fléau et épée (Ouverture) : touché") ) return;
      const kinds = async () => [...(await effects(bandit)), ...(await effects(fighter))].map(e => e.flags[MODULE_ID].mastery.kind).sort().join(",");
      ctx.expect((await kinds()) === "sap,vex", `marques posées : ${await kinds()}`);
      await ctx.nextTurn(); await pause(2500);   // fin du tour du Guerrier (celui de la pose), tour du Bandit
      ctx.expect((await kinds()) === "sap,vex", `tour du Bandit : toujours ${await kinds()}`);
      await ctx.nextTurn(); await pause(2500);   // début du tour suivant du Guerrier
      ctx.expect((await kinds()) === "vex", `début du tour suivant du Guerrier : la Sape tombe (${await kinds() || "rien"})`);
      await ctx.nextTurn(); await pause(2500);   // fin du tour suivant du Guerrier
      ctx.expect((await kinds()) === "", `fin de son tour suivant : l'Ouverture tombe (${await kinds() || "rien"})`);
    });
  }
};
