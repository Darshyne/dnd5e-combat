/**
 * §210 : assommer (coups non létaux) et surprise — Paladin de `dnd-6` contre le Bandit (CA 5, 1 PV le temps du test).
 *  1. Coups non létaux activés : un coup d'épée longue qui ferait tomber le Bandit à 0 PV le laisse à 1 PV, Inconscient, « assommé ».
 *  2. Des PV regagnés le réveillent : plus Inconscient, plus « assommé ».
 *  3. Coups non létaux coupés : le même coup le fait tomber à 0 PV.
 *  4. Surprise : le Paladin caché (Furtivité du moteur), l'initiative du Bandit se lance avec le Désavantage ; l'état « Surpris » posé
 *     sur le Bandit disparaît une fois son initiative lancée.
 * Remet drapeau, CA, PV, états, positions, Furtivité.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "assommer — coups non létaux, réveil, surprise à l'initiative",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Paladin", "Bandit"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Paladin et Bandit requis : non applicable"); return; }
    const pal = await ctx.token("Paladin");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [pal, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(pal.id).pos;

    const palActor = await ctx.call("get-actor", { actorId: pal.actorId });
    const flag0 = palActor.flags?.[MODULE_ID]?.nonLethal ?? null;
    const setNonLethal = on => ctx.call("update-actor", { actorId: pal.actorId, actorData: { [`flags.${MODULE_ID}.nonLethal`]: on } });
    ctx.restore(() => ctx.call("update-actor", { actorId: pal.actorId,
      actorData: { [`flags.${MODULE_ID}.nonLethal`]: flag0 } }).catch(() => {}));

    const banditData = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id })).data;
    const ac0 = (await banditData()).delta?.system?.attributes?.ac ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: { "delta.system.attributes.ac": ac0 } }).catch(() => {}));
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { [`delta.flags.${MODULE_ID}.knockedOut`]: null } }).catch(() => {}));
    ctx.restore(() => ctx.removeEffectsNamed(pal, /Furtivité \(scénario assommer\)/));
    const knockedOut = async () => !!(await banditData()).delta?.flags?.[MODULE_ID]?.knockedOut;
    const statuses = async () => new Set((await ctx.effects(bandit)).flatMap(e => e.statuses ?? []));

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of ["unconscious", "prone", "dead", "surprised"] ) {
          await ctx.removeStatusEffects(t, s);
          await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {});
        }
        await ctx.setHp(t, h.hp);
      }
      await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { [`delta.flags.${MODULE_ID}.knockedOut`]: null } }).catch(() => {});
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
      await ctx.startCombat([pal, bandit]);
      const combat = await state();
      for ( const [t, v] of [[pal, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== pal.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === pal.id;
    };
    const weak = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.ac": { calc: "flat", flat: 5 } } });
      await ctx.setHp(bandit, 1);
    };
    const sword = await ctx.itemId(pal.id, "longsword");
    /** Frappe le Bandit jusqu'à toucher (10 essais au plus, en passant le tour pour retrouver l'action). */
    const hit = async () => {
      for ( let n = 0; n < 10; n++ ) {
        const u = await ctx.use({ tokenId: pal.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === bandit.name)?.hit === true ) { await pause(2500); return true; }
        await ctx.nextTurn(); await pause(1200); await ctx.nextTurn(); await pause(1500);
      }
      return false;
    };
    const place = async () => { await ctx.call("move-token", { tokenId: bandit.id, x: g.x + grid, y: g.y, elevation: 0 }); await pause(700); };

    await part("Assommer puis réveiller", async () => {
      await setNonLethal(true); await place(); await weak();
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      if ( !ctx.expect(await hit(), "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const hp = await ctx.hp(bandit);
      const s = await statuses();
      ctx.expect(hp === 1, `coup non létal : le Bandit reste à 1 PV (${hp})`);
      ctx.expect(s.has("unconscious") && !s.has("dead"), `Inconscient, pas mort (${[...s].join(", ")})`);
      ctx.expect(await knockedOut(), "drapeau « assommé » posé");
      // Un vrai soin (applyDamage → mise à jour de la fiche) : écrire les PV dans le token ne passe pas par `updateActor`.
      await ctx.engine("heal", { tokenId: bandit.id, amount: 4 });
      await pause(2500);
      const after = await statuses();
      ctx.expect(!after.has("unconscious"), `PV regagnés : réveillé (${[...after].join(", ") || "aucun état"})`);
      ctx.expect(!(await knockedOut()), "drapeau « assommé » retiré");
    });

    await part("Coups létaux", async () => {
      await setNonLethal(false); await place(); await weak();
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      if ( !ctx.expect(await hit(), "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const hp = await ctx.hp(bandit);
      ctx.expect(hp === 0, `coup létal : le Bandit tombe à 0 PV (${hp})`);
      ctx.expect(!(await knockedOut()), "pas de drapeau « assommé »");
    });

    /** L'initiative du Bandit dans un combat neuf : rend la formule du jet. */
    const banditInitiative = async () => {
      await ctx.startCombat([pal, bandit]);
      const cid = (await state()).combatants.find(x => x.tokenId === bandit.id).id;
      const since = await ctx.lastMessageId();
      await ctx.call("roll-initiative", { combatId: ctx.ownCombat, combatantIds: [cid] });
      await pause(3000);
      return (await ctx.messagesSince(since)).flatMap(m => m.rolls ?? []).find(r => /d20/.test(r.formula ?? ""))?.formula ?? "aucun jet";
    };
    const disadvantage = formula => /kl|dis/.test(formula);

    await part("Surprise par la Furtivité", async () => {
      await setNonLethal(false); await place();
      await ctx.call("upsert-embedded-effect", { documentType: "Actor", id: pal.actorId, effectData: {
        name: "Furtivité (scénario assommer)", img: "icons/svg/cowled.svg", transfer: false, disabled: false, changes: [],
        flags: { [MODULE_ID]: { hidden: { dc: 20 } } } } });
      await pause(500);
      const st = await ctx.engine("stealth", { tokenId: pal.id });
      if ( !ctx.expect(st.hidden, "Paladin caché") ) return;
      const formula = await banditInitiative();
      ctx.expect(disadvantage(formula), `Paladin caché : initiative du Bandit avec le Désavantage (${formula})`);
      await ctx.removeEffectsNamed(pal, /Furtivité \(scénario assommer\)/);
    });

    await part("État Surpris", async () => {
      await place();
      await ctx.call("set-status", { tokenId: bandit.id, statusId: "surprised", active: true });
      const formula = await banditInitiative();
      ctx.expect(disadvantage(formula), `Surpris : initiative avec le Désavantage (${formula})`);
      const s = await statuses();
      ctx.expect(!s.has("surprised"), `« Surpris » retiré après l'initiative (${[...s].join(", ") || "aucun état"})`);
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null;
      const plain = await banditInitiative();
      ctx.expect(!disadvantage(plain), `sans surprise : initiative normale (${plain})`);
    });
  }
};
