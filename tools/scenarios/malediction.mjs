/**
 * Malédiction (SPEC §37), monde `dnd-6`. Le Clerc reçoit Malédiction et Rayon traçant (Manuel des joueurs, à volonté) et maudit le
 * Zombi, au contact, sur la colonne libre de Restored Keep (Clerc 3080 × 4900, Zombi 3080 × 5040, Guerrier 3080 × 5180). Chaque
 * partie relance la sauvegarde jusqu'à un échec (20 essais au plus). Vérifie :
 *  - Caractéristique : « Curse Ability » pose UN seul effet, la Force choisie (réserve `choice.pool`) ; sauvegarde de Force du
 *    Zombi au Désavantage ;
 *  - Attaques : le Zombi attaque le Clerc au Désavantage, le Guerrier sans ;
 *  - Actions : au combat, au début des tours du Zombi, sauvegarde de Sagesse rejouée ; ratée → action Esquiver (budget), réussie →
 *    la malédiction reste ;
 *  - Résilience : le Rayon traçant du Clerc sur le Zombi maudit porte 1d8 nécrotique de plus.
 * Remet positions, PV, effets ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const ACT = { ability: "PYFPZ4aLWjKJ1tLZ", attacks: "azVyTkiGPeIqMzxu", actions: "nWXSXy8ybiVolvEP", resilience: "fkQUKM8bxHgAUcg5" };
const FX = { strength: "m5aRx9iXnJi2WWPU", attacks: "u7Yc7mxHYPDvipS1", actions: "T3x6XvQbSkg6kW6u", resilience: "DRsQi8p3Zvhte2G0" };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rollOf = m => { const raw = m?.rolls?.[0]; return (typeof raw === "string") ? JSON.parse(raw) : raw; };
const fromFx = (e, id) => [e._stats?.duplicateSource, e._stats?.compendiumSource].some(u => typeof u === "string" && u.endsWith(`.ActiveEffect.${id}`));

export default {
  name: "malédiction — caractéristique, attaques, actions, résilience",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Zombi ou Guerrier absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const atWill = { system: { method: "atwill" } };
    const curseId = await ctx.ensureItem(cleric, PHB + "phbsplBestowCurs", atWill);
    await ctx.ensureItem(cleric, PHB + "phbsplGuidingBol", atWill);

    const all = [cleric, zombi, fighter];
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };
    const place = async () => {
      for ( const [t, y] of [[cleric, 4900], [zombi, 5040], [fighter, 5180]] ) await ctx.call("move-token", { tokenId: t.id, x: 3080, y, elevation: 0 });
      await pause(800);
    };
    const reset = async () => {
      await endCombat();
      for ( const t of all ) await clearNew(t);
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await place(); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
      await pause(800);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const curses = async () => (await ctx.effects(zombi)).filter(e => !effects0.get(zombi.id).has(e._id ?? e.id) && (e.statuses ?? []).includes("cursed"));

    /** Maudit le Zombi par cette activité jusqu'à une sauvegarde ratée ; rend les effets de malédiction posés. */
    const curse = async (activityId, usage={}) => {
      for ( let n = 1; n <= 20; n++ ) {
        await clearNew(zombi);
        const used = await ctx.use({ tokenId: cleric.id, itemId: curseId, activityId, consume: false, targetTokenIds: [zombi.id],
          usageConfig: { [MODULE_ID]: usage } });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1200);
        if ( r?.targets?.find(t => t.name === "Zombi")?.save?.success === false ) return curses();
      }
      return null;
    };

    await part("Caractéristique", async () => {
      const posed = await curse(ACT.ability, { choice: FX.strength });
      if ( !ctx.expect(!!posed, "le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
      ctx.expect((posed.length === 1) && fromFx(posed[0], FX.strength), `un seul effet, la Force (${posed.map(e => e.name).join(", ")})`);
      const save = await ctx.engine("rollSave", { tokenId: zombi.id, ability: "str" });
      ctx.expect(/dis|kl/.test(save?.formula ?? ""), `sauvegarde de Force du Zombi au Désavantage : ${save?.formula}`);
      const wis = await ctx.engine("rollSave", { tokenId: zombi.id, ability: "wis" });
      ctx.expect(!/dis|kl/.test(wis?.formula ?? ""), `sauvegarde de Sagesse sans Désavantage : ${wis?.formula}`);
    });

    await part("Attaques", async () => {
      const posed = await curse(ACT.attacks);
      if ( !ctx.expect(!!posed?.some(e => fromFx(e, FX.attacks)), "« Cursed Attacks » posé (20 essais au plus)") ) return;
      const zItems = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
      const weapon = zItems.find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
      const strike = async target => {
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [target.id] });
        await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        return rollOf((await ctx.messagesSince(since)).find(m => m.type === "attack"));
      };
      const vsCleric = await strike(cleric);
      ctx.expect(vsCleric?.options?.advantageMode === -1, `contre le Clerc (le lanceur) : Désavantage (${vsCleric?.formula})`);
      await ctx.setHp(cleric, homes.get(cleric.id).hp);
      const vsFighter = await strike(fighter);
      ctx.expect(vsFighter?.options?.advantageMode !== -1, `contre le Guerrier : pas de Désavantage (${vsFighter?.formula})`);
    });

    await part("Actions", async () => {
      const posed = await curse(ACT.actions);
      if ( !ctx.expect(!!posed?.some(e => fromFx(e, FX.actions)), "« Cursed Actions » posé (20 essais au plus)") ) return;
      await ctx.startCombat([cleric, zombi]);
      const c = await ctx.combat();
      for ( const [t, value] of [[cleric, 20], [zombi, 10]] ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      const seen = { failed: false, saved: false };
      for ( let turn = 0; (turn < 16) && !(seen.failed && seen.saved); turn++ ) {
        const since = await ctx.lastMessageId();
        await ctx.nextTurn();
        await pause(2500);
        const resave = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave);
        if ( !resave ) continue;
        const r = await ctx.settle(resave.id).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Zombi");
        await pause(1000);
        const budget = await ctx.engine("budget", { tokenId: zombi.id });
        const still = (await curses()).some(e => fromFx(e, FX.actions));
        if ( t?.save?.success === false ) {
          seen.failed = true;
          ctx.expect(budget?.dodging === true && (budget?.action ?? 1) < 1, `ratée (${t.save.total}) : Esquive imposée (action ${budget?.action}, esquive ${budget?.dodging})`);
        } else if ( t?.save?.success === true ) {
          seen.saved = true;
          ctx.expect(still && !budget?.dodging, `réussie (${t.save.total}) : la malédiction reste, pas d'Esquive (${still}, ${budget?.dodging})`);
        }
      }
      ctx.expect(seen.failed, "une sauvegarde ratée vue au début d'un tour du Zombi (8 rounds au plus)");
      ctx.expect(seen.saved, "une sauvegarde réussie vue (8 rounds au plus)");
    });

    await part("Résilience", async () => {
      const posed = await curse(ACT.resilience);
      if ( !ctx.expect(!!posed?.some(e => fromFx(e, FX.resilience)), "« Cursed Resilience » posé (20 essais au plus)") ) return;
      for ( let n = 1; n <= 20; n++ ) {
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: cleric.id, identifier: "guiding-bolt", consume: false, targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        if ( !r?.targets?.find(t => t.name === "Zombi")?.hit ) continue;
        const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
        const bonuses = (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
        ctx.expect(bonuses.includes("1d8 necrotic"), `Rayon traçant sur le Zombi maudit : ${bonuses.join(", ") || "aucun bonus"}`);
        return;
      }
      ctx.expect(false, "le Rayon traçant touche le Zombi (20 essais au plus)");
    });
  }
};
