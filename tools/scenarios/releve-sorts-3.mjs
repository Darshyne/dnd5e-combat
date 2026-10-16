/**
 * Relevé des sorts, lot 2 : zones qui durent (SPEC §158), monde `dnd-6`, arène. Le Magicien lance chaque sort (prêté du Manuel des
 * joueurs, à volonté) en une petite zone sur la cible seule, puis un combat (Magicien, cible) joue les tours :
 *  - la zone rejoue au moment dit (début ou fin du tour de la cible : un message d'utilisation `areaTick`) ;
 *  - Graisse : À terre ⇔ sauvegarde ratée ; Toile d'araignée : Entravé ⇔ ratée, pas de dégâts de feu, et un test pour s'en libérer ;
 *    Tentacules noirs d'Evard : Entravé, et le test pour s'en libérer ;
 *  - Brume mortelle : la zone s'éloigne de 3 m du lanceur au début de son tour ;
 *  - Tempête radieuse de Jallarzi : Aveuglé porté par la zone (retiré quand la cible en sort) ;
 *  - Nuage nauséabond (le Bandit : le Zombi est immunisé contre Empoisonné) : ratée au début de son tour → ni action ni action Bonus.
 * PV de la cible portés à 300 le temps du scénario. Remet positions, PV, effets, zones, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 2 — zones qui durent",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Zombi", "Bandit"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, zombi, bandit] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, zombi, bandit];
    const grid = await ctx.gridSize();
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    // Des PV pour encaisser une demi-douzaine de zones.
    for ( const t of [zombi, bandit] ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const max0 = data.delta?.system?.attributes?.hp?.max ?? null;
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id,
        data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    }
    const tough = t => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
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
    const regions = [];
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const t of all ) {
        await clearNew(t);
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
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId; };
    const fight = async order => {
      await ctx.startCombat(order);
      const c = await state();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 4) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      return (await current()) === order[0].id;
    };
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3500); };
    const statuses = async t => (await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    /** Pose le sort (`id` du Manuel) en une petite zone sur `target`, au tour du Magicien ; rend la résolution de la pose. */
    const cast = async (id, target, activityType="save") => {
      const itemId = await ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
      await tough(target);
      if ( !ctx.expect(await fight([mage, target]), `${id} : tour du Magicien`) ) return null;
      const b = await ctx.box(target);
      const used = await ctx.use({ tokenId: mage.id, itemId, activityType, consume: false,
        area: { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: b.width * 0.6 } });
      if ( used.regionId ) regions.push(used.regionId);
      ctx.expect(!!used.regionId, `${id} : zone posée`);
      const r = used.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      return { used, r };
    };
    /** Le rejeu de la zone sur la cible depuis `since` (message `areaTick`), sa résolution. */
    const replayOf = async (since, target) => {
      const m = (await ctx.messagesSince(since)).find(x => (x.type === "usage") && (x.flags?.[MODULE_ID]?.areaTick ?? x.flags?.areaTick));
      if ( !m ) return null;
      const r = await ctx.settle(m.id, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      return r?.targets?.find(t => t.name === target.name) ?? { none: true };
    };

    /** Rejeu en début (turnStart) ou en fin (turnEnd) du tour de la cible ; `status` : l'état posé sur une sauvegarde ratée. */
    const zoneCase = (label, id, target, { at, status=null, activityType="save", after=null }) => part(label, async () => {
      const c = await cast(id, target, activityType);
      if ( !c?.used?.usageMessageId ) return;
      if ( status ) await ctx.removeStatusEffects(target, status).catch(() => {});
      const hp = await ctx.hp(target);
      const since = await ctx.lastMessageId();
      await next();                              // tour de la cible (début : turnStart)
      if ( at === "turnEnd" ) await next();       // fin de son tour
      const t = await replayOf(since, target);
      if ( !ctx.expect(!!t && !t.none, `${label} : la zone rejoue au ${at === "turnStart" ? "début" : "fin"} du tour de la cible`) ) return;
      if ( status ) {
        const has = (await statuses(target)).includes(status);
        ctx.expect(has === (t.save?.success === false), `${label} : sauvegarde ${t.save?.total} ${t.save?.success ? "réussie" : "ratée"} → ${has ? status : `pas ${status}`}`);
      }
      if ( after ) await after({ t, hp, target });
    });

    await zoneCase("Graisse", "phbsplGrease0000", zombi, { at: "turnEnd", status: "prone" });
    await zoneCase("Toile d'araignée", "phbsplWeb0000000", zombi, { at: "turnStart", status: "restrained", after: async ({ t, hp, target }) => {
      ctx.expect((await ctx.hp(target)) === hp, `Toile d'araignée : pas de dégâts de feu au rejeu (${hp} → ${await ctx.hp(target)})`);
      if ( t.save?.success === false ) {
        const own = (await ctx.engine("endings", { tokenId: target.id })).own ?? [];
        ctx.expect(own.some(e => e.roll === "check" && Number.isFinite(e.dc)), `Toile d'araignée : un test pour se libérer (${own.map(e => `${e.name} DD ${e.dc}`).join(", ") || "aucun"})`);
      }
    } });
    await zoneCase("Tentacules noirs d'Evard", "phbsplEvardsBlac", zombi, { at: "turnEnd", after: async ({ t, target }) => {
      if ( t.save?.success !== false ) return;
      const own = (await ctx.engine("endings", { tokenId: target.id })).own ?? [];
      ctx.expect(own.some(e => e.roll === "check" && Number.isFinite(e.dc)), `Tentacules : Entravé, un test pour se libérer (${own.map(e => `${e.name} DD ${e.dc}`).join(", ") || "aucun"})`);
    } });
    await zoneCase("Fléau d'insectes", "phbsplInsectPlag", zombi, { at: "turnEnd" });
    await zoneCase("Barrière de lames", "phbsplBladeBarri", zombi, { at: "turnEnd" });
    await zoneCase("Nuage incendiaire", "phbsplIncendiary", zombi, { at: "turnEnd" });

    await part("Brume mortelle", async () => {
      const c = await cast("phbsplCloudkill0", zombi);
      if ( !c?.used?.regionId ) return;
      const centre = async () => {
        const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: c.used.regionId });
        const s = data.shapes?.[0] ?? {};
        return { x: s.x ?? (s.points ? (Math.min(...s.points.filter((_, i) => !(i % 2))) + Math.max(...s.points.filter((_, i) => !(i % 2)))) / 2 : null),
          y: s.y ?? (s.points ? (Math.min(...s.points.filter((_, i) => i % 2)) + Math.max(...s.points.filter((_, i) => i % 2))) / 2 : null) };
      };
      const before = await centre();
      const since = await ctx.lastMessageId();
      await next(); await next();   // fin du tour du Zombi (rejeu), puis début du tour du Magicien (dérive)
      const t = await replayOf(since, zombi);
      ctx.expect(!!t && !t.none, "Brume mortelle : la zone rejoue à la fin du tour du Zombi");
      const after = await centre();
      const moved = Math.hypot(after.x - before.x, after.y - before.y) / grid;
      ctx.expect(Math.abs(moved - 2) < 0.3, `Brume mortelle : la zone s'éloigne du Magicien de ${moved.toFixed(2)} case(s) (attendu 2)`);
    });

    await part("Tempête radieuse de Jallarzi", async () => {
      const c = await cast("phbsplJallarzisS", zombi);
      if ( !c?.used?.regionId ) return;
      const blind = async () => (await statuses(zombi)).includes("blinded");
      ctx.expect(await blind(), "Jallarzi : Aveuglé dans la zone");
      await ctx.call("move-token", { tokenId: zombi.id, x: homes.get(zombi.id).pos.x - 4 * grid, y: homes.get(zombi.id).pos.y, elevation: 0 });
      await pause(2500);
      ctx.expect(!(await blind()), "Jallarzi : plus Aveuglé hors de la zone");
    });

    await part("Nuage nauséabond", async () => {
      const c = await cast("phbsplStinkingCl", bandit);
      if ( !c?.used?.regionId ) return;
      for ( let n = 1; n <= 6; n++ ) {
        const since = await ctx.lastMessageId();
        await next();   // début du tour du Bandit : la sauvegarde
        const t = await replayOf(since, bandit);
        if ( !t || t.none ) { ctx.expect(false, "Nuage nauséabond : pas de rejeu au début du tour du Bandit"); return; }
        const b = await ctx.engine("budget", { tokenId: bandit.id });
        if ( t.save?.success === false ) {
          ctx.expect((b?.action === 0) && (b?.bonus === 0), `Nuage nauséabond : ratée → action ${b?.action}, action Bonus ${b?.bonus}`);
          return;
        }
        ctx.log(`Nuage nauséabond : réussie (${t.save?.total}), action ${b?.action}`);
        await next();   // tour du Magicien
      }
      ctx.log("Nuage nauséabond : six réussites, branche ratée non exercée");
    });
  }
};
