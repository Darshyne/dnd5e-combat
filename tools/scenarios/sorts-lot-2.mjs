/**
 * Sorts de Clerc et de Druide de niveau 1 à 3 couverts mais jamais rejoués (SPEC §37.6), second lot : invocations, objets pilotés,
 * zones, monde `dnd-6`. Le Clerc reçoit les sorts (Manuel des joueurs, à volonté, rien de consommé) ; colonne libre de Restored Keep :
 * Clerc 3080 × 4900, Zombi 3080 × 5180, Guerrier 2800 × 5180. Invocations par `api.mcp.summonAt` (le placement interactif de dnd5e
 * remplacé par une case). Contrôles :
 *  - Convocation de bêtes : l'esprit entre au combat juste après le Clerc ; la concentration retirée, il disparaît ;
 *  - Arme spirituelle : posée au contact du Zombi, le lancement offre sa commande (« vous pouvez immédiatement faire une attaque » :
 *    `onCast: "use"`, sans action Bonus) ; juste après le Clerc au combat ;
 *  - Sphère de feu : posée sous le Zombi (hors de portée du Clerc — le lanceur y serait pris aussi, conforme), le Zombi finit son tour
 *    à 1,50 m → sauvegarde de Dextérité (areaTick `pulse`) ;
 *  - Invocation d'animaux : le Zombi finit son tour à 3 m de la meute → sauvegarde (areaTick `pulse`) ;
 *  - Appel de la foudre : l'éclair frappe 1,50 m autour du point — le Zombi sauvegarde, le Guerrier à 3 cases non ;
 *  - Nappe de brouillard : le Zombi dans la brume, le Guerrier dehors l'attaque sans le voir (raison `target.unseen`).
 * Remet positions, PV, effets, zones, combat ; retire les invocations et les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = { beast: "phbsplSummonBeas", weapon: "phbsplSpiritualW", sphere: "phbsplFlamingSph", animals: "phbsplConjureAni",
  lightning: "phbsplCallLightn", fog: "phbsplFogCloud00" };

export default {
  name: "sorts, second lot — Convocation de bêtes, Arme spirituelle, Sphère de feu, Invocation d'animaux, Appel de la foudre, Nappe de brouillard",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Clerc", "Guerrier", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const ids = {};
    for ( const [k, id] of Object.entries(SPELLS) ) ids[k] = await ctx.ensureItem(cleric, PHB + id, { system: { method: "atwill" } });
    const all = [cleric, fighter, zombi];
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const tokens0 = new Set(tokens.map(t => t.id));
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const added = async t => (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id));
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of await added(t) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
    };
    const regions = [];
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };
    const reset = async () => {
      await endCombat();
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const t of all ) await clearNew(t);   // la concentration du Clerc : ses invocations partent avec
      await pause(1500);
      const now = await ctx.liveTokens();
      for ( const t of now.filter(t => !tokens0.has(t.id)) ) await ctx.call("delete-scene-object", { type: "Token", objectId: t.id }).catch(() => {});
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(700);
    };
    ctx.restore(reset);
    const place = async () => {
      for ( const [t, x, y] of [[cleric, 3080, 4900], [zombi, 3080, 5180], [fighter, 2800, 5180]] ) {
        await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 });
      }
      await pause(800);
    };
    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await reset(); await place(); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const fight = async () => {
      await ctx.startCombat([cleric, zombi]);
      const c = await ctx.combat();
      for ( const [t, value] of [[cleric, 20], [zombi, 10]] ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
    };
    const summon = async (key, x, y) => {
      const s = await ctx.engine("summonAt", { tokenId: cleric.id, itemId: ids[key], x, y });
      await pause(2500);
      return s?.tokens?.[0] ?? null;
    };
    const initiativeOf = async t => ((await ctx.combat()).combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name))?.initiative ?? null;
    /** Tours suivants jusqu'à une sauvegarde d'objet ou de meute (areaTick `pulse`) sur le Zombi ; rend la résolution. */
    const pulseOnZombi = async () => {
      for ( let i = 0; i < 6; i++ ) {
        const since = await ctx.lastMessageId();
        await ctx.nextTurn();
        await pause(2500);
        if ( process.env.DEBUG ) {
          const cb = await ctx.combat();
          ctx.log(`tour ${i} : ${cb?.combatant?.name ?? cb?.turn} — ${(await ctx.messagesSince(since)).map(m => `${m.type}:${JSON.stringify(m.flags?.[MODULE_ID]?.areaTick ?? null)}`).join(" | ")}`);
          ctx.log(`trace : ${(await ctx.engineLog()).slice(-6).join(" / ")}`.slice(0, 600));
        }
        const tick = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.event === "pulse")
          && String(m.flags?.[MODULE_ID]?.areaTick?.token ?? "").endsWith(zombi.id));
        if ( tick ) return ctx.settle(tick.id, { timeoutMs: 45000 }).catch(() => null);
      }
      return null;
    };

    await part("Convocation de bêtes", async () => {
      await fight();
      const beast = await summon("beast", 3220, 4900);
      if ( !ctx.expect(!!beast, `un esprit bestial est invoqué (${beast?.name ?? "rien"})`) ) return;
      const init = await initiativeOf(beast);
      ctx.expect((init !== null) && (init < 20) && (init > 10), `il entre au combat juste après le Clerc (initiative ${init})`);
      await clearNew(cleric);
      await pause(2500);
      ctx.expect(!(await ctx.liveTokens()).some(t => t.id === beast.id), "fin de la concentration : l'esprit est retiré");
    });

    await part("Arme spirituelle", async () => {
      await fight();
      const weapon = await summon("weapon", 3080, 5040);
      if ( !ctx.expect(!!weapon, `l'arme spirituelle est invoquée (${weapon?.name ?? "rien"})`) ) return;
      const offered = (await ctx.engineLog()).slice(-30).some(l => /commande offerte au lancement \(use\)/.test(l));
      ctx.expect(offered, "le lancement offre sa commande d'attaque (onCast « use », sans action Bonus)");
      const init = await initiativeOf(weapon);
      ctx.expect((init !== null) && (init < 20) && (init > 10), `juste après le Clerc au combat (initiative ${init})`);
    });

    await part("Sphère de feu", async () => {
      await fight();
      const sphere = await summon("sphere", 3080, 5320);
      if ( process.env.DEBUG && sphere ) {
        const s = (await ctx.call("get-scene-object", { type: "Token", objectId: sphere.id })).data;
        const z = (await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id })).data;
        ctx.log(`sphère ${s.x} × ${s.y} (élév. ${s.elevation}, niveau ${s.level}, ${s.width}×${s.height}) ; Zombi ${z.x} × ${z.y} (élév. ${z.elevation}, niveau ${z.level})`);
      }
      if ( !ctx.expect(!!sphere, `la sphère est invoquée (${sphere?.name ?? "rien"})`) ) return;
      const r = await pulseOnZombi();
      const t = r?.targets?.find(x => x.name === "Zombi");
      if ( process.env.DEBUG ) ctx.log(`résolution : ${JSON.stringify({ step: r?.step, plan: r?.plan?.save, targets: r?.targets }).slice(0, 900)}`);
      ctx.expect(Number.isFinite(t?.save?.total), `fin du tour du Zombi à 1,50 m : sauvegarde ${t?.save?.total} contre DD ${r?.plan?.save?.dc}`);
    });

    await part("Invocation d'animaux", async () => {
      await fight();
      const pack = await summon("animals", 3220, 5040);
      if ( !ctx.expect(!!pack, `la meute est invoquée (${pack?.name ?? "rien"})`) ) return;
      const r = await pulseOnZombi();
      const t = r?.targets?.find(x => x.name === "Zombi");
      ctx.expect(!!t?.save, `fin du tour du Zombi à 3 m de la meute : sauvegarde ${t?.save?.total} contre DD ${r?.plan?.save?.dc}`);
    });

    await part("Appel de la foudre", async () => {
      // §70 : l'incantation pose le NUAGE par la pose de dnd5e (`placeRegionAt` joue le clic), qui ne résout rien ; l'éclair se
      // vise ensuite dessous (`stormStrike`). Le paramètre `area` du connecteur créerait la zone sans cette pose : pas de visée.
      const z = await ctx.position(zombi);
      const center = { x: z.x + grid / 2, y: z.y + grid / 2 };
      await ctx.call("call-module-api", { moduleId: "dnd5e-combat", fn: "use", args: { tokenId: cleric.id, itemId: ids.lightning }, waitMs: 500 });
      await pause(1500);
      const placed = await ctx.engine("placeRegionAt", center).catch(err => ({ error: err.message }));
      ctx.expect(placed?.placed, `le nuage est posé (${JSON.stringify(placed)})`);
      await pause(2500);
      const storm = await ctx.engine("storm", { tokenId: cleric.id, itemId: ids.lightning }).catch(() => null);
      if ( storm?.cloud?.id ) regions.push(storm.cloud.id);
      const since = await ctx.lastMessageId();
      const struck = await ctx.engine("stormStrike", center).catch(err => ({ error: err.message }));
      ctx.expect(struck?.struck, `l'éclair est posé sous le nuage (${JSON.stringify(struck)})`);
      await pause(7000);
      const saves = (await ctx.messagesSince(since)).filter(m => /Dextérité|Dexterity/i.test(m.flavor ?? ""));
      const names = [...new Set(saves.map(m => m.alias))];
      ctx.expect(names.includes("Zombi") && !names.includes("Guerrier"), `l'éclair frappe 1,50 m autour du point : ${names.join(", ") || "personne"}`);
    });

    await part("Nappe de brouillard", async () => {
      const z = await ctx.position(zombi);
      const used = await ctx.use({ tokenId: cleric.id, itemId: ids.fog, activityType: "utility", consume: false,
        area: { shape: "circle", x: z.x + grid / 2, y: z.y + grid / 2, radius: grid } });
      if ( used.regionId ) regions.push(used.regionId);
      if ( !ctx.expect(!!used.regionId, "la brume est posée sur le Zombi") ) return;
      await pause(1500);
      const sword = await ctx.itemId(fighter.id, "greatsword");
      const reasons = await ctx.engine("attackReasons", { attackerId: fighter.id, targetId: zombi.id, itemId: sword });
      ctx.expect(reasons.disadvantage.includes("target.unseen"), `le Guerrier dehors ne voit pas le Zombi dans la brume : ${JSON.stringify(reasons)}`);
    });
  }
};
