/**
 * §18.21 — compléter Avaler / Engloutir. `dnd-6` (Zombi, Guerrier) ou `ravenloft` (Zombi, Bramo) : capacités du Monster Manual
 * prêtées au Zombi, un personnage joueur pour cible (il reçoit l'action de base S'échapper en combat).
 *  1. Engloutissement du Cube gélatineux : l'action utilisée, le Zombi marche à travers la case du PJ → une carte de
 *     sauvegarde pour lui ; ratée : englouti (dans l'espace du Zombi) ; réussie : il n'est pas dans l'espace du Zombi.
 *  2. Englouti : S'échapper (action de base) → test d'Athlétisme contre le DD du cube ; réussi : libre, hors du Zombi, debout.
 *  3. Avalement du Béhir sur le PJ qui n'est PAS agrippé par le Zombi : sauvegarde ratée, mais l'effet est refusé.
 *  4. Engloutissement du Blob d'annihilation : englouti, puis à la fin de son tour, une sauvegarde répétée ; réussie → sorti.
 * Les jets sont aléatoires : on rejoue (20 essais au plus).
 */
const CUBE = "Compendium.dnd-monster-manual.actors.Actor.mmGelatinousCube";
const BEHIR = "Compendium.dnd-monster-manual.actors.Actor.mmBehir000000000";
const BLOB = "Compendium.dnd-monster-manual.actors.Actor.mmBlobOfAnnihila";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "engloutir — en marchant, s'échapper, cible non agrippée, sauvegarde répétée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const pcName = ["Guerrier", "Bramo"].find(n => tokens.some(t => t.name === n));
    if ( !pcName || !tokens.some(t => t.name === "Zombi") ) { ctx.log("Zombi ou personnage (Guerrier, Bramo) absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const pc = await ctx.token(pcName);
    const grid = await ctx.gridSize();
    for ( const t of [zombi, pc] ) {
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
      for ( const s of ["prone", "restrained", "blinded", "grappled", "suffocation"] ) ctx.restore(() => ctx.removeStatusEffects(t, s));
    }
    // Assez de PV pour survivre à l'Engloutissement : à 13 PV, un jet de 13 le mettait à 0, À terre, et « s'échappe : debout »
    // échouait sur un dé (vu le 2026-09-28). +30 PV max le temps du scénario.
    const { data: pcTok } = await ctx.call("get-scene-object", { type: "Token", objectId: pc.id });
    if ( pcTok.actorLink ) {
      const bonus0 = (await ctx.call("get-actor", { actorId: pc.actorId })).system?.attributes?.hp?.bonuses?.overall ?? "";
      await ctx.call("update-actor", { actorId: pc.actorId, actorData: { "system.attributes.hp.bonuses.overall": "30" } });
      ctx.restore(() => ctx.call("update-actor", { actorId: pc.actorId, actorData: { "system.attributes.hp.bonuses.overall": bonus0 } }).catch(() => {}));
      await ctx.setHp(pc, (await ctx.hp(pc)) + 30);
    }
    const { data: zTok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const lend = async (uuid, identifier) => {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === identifier);
      const up = await ctx.call("upsert-actor-item", { actorId: zTok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(zombi.id, identifier));
      // Retirer de l'acteur de base ne suffit pas : dès que le moteur a touché l'item par le token, le delta en garde une copie
      // (même id) — qui garderait l'Engloutissement au Zombi pour la suite du scénario.
      const remove = async () => {
        await ctx.call("remove-embedded-item", { documentType: "Actor", id: zTok.actorId, itemId }).catch(() => {});
        await ctx.call("remove-embedded-item", { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${zombi.id}.Actor.${zTok.actorId}`, itemId }).catch(() => {});
      };
      ctx.restore(remove);
      return { itemId, remove, activities: Object.fromEntries(Object.entries(itemData.system.activities).map(([id, a]) => [a.type, id])) };
    };
    const swallowedEffect = async () => (await ctx.effects(pc)).find(e => !e.disabled && (e.statuses ?? []).some(s => ["coverTotal"].includes(s))) ?? null;
    const statuses = async () => new Set((await ctx.effects(pc)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []));
    const inside = async () => {
      const z = await ctx.position(zombi), p = await ctx.position(pc);
      return (p.x >= z.x) && (p.x < z.x + grid) && (p.y >= z.y) && (p.y < z.y + grid);
    };
    const free = async () => {
      for ( const s of ["prone", "restrained", "blinded", "suffocation"] ) await ctx.removeStatusEffects(pc, s);
      const e = await swallowedEffect();
      if ( e ) await ctx.call("remove-embedded-effect", (await ctx.call("get-scene-object", { type: "Token", objectId: pc.id })).data.actorLink
        ? { documentType: "Actor", id: pc.actorId, effectId: e._id } : { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${pc.id}.Actor.${pc.actorId}`, effectId: e._id }).catch(() => {});
      await sleep(600);
    };

    await ctx.startCombat([zombi, pc]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[zombi, 20], [pc, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === token.id).id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => { for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await sleep(1200); } return (await current()) === token.id; };
    const cards = async (since, event) => (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.areaTick?.event === event);

    // 1. Engloutir en marchant.
    const cube = await lend(CUBE, "engulf");
    if ( !ctx.expect(await turnOf(zombi), "tour du Zombi") ) return;
    const at = await ctx.position(zombi);
    // Une ligne de quatre cases où seul le PJ se trouvera (la scène de `dnd-6` a d'autres créatures : le Bandit était sur le trajet).
    const others = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.filter(t => ![zombi.id, pc.id].includes(t.id));
    const occupied = (x, y) => others.some(t => (x < t.x + (t.width ?? 1) * grid) && (x + grid > t.x) && (y < t.y + (t.height ?? 1) * grid) && (y + grid > t.y));
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => [1, 2, 3, 4].every(k => !occupied(at.x + k * dx * grid, at.y + k * dy * grid))) ?? [1, 0];
    const cell = k => ({ x: at.x + k * dir[0] * grid, y: at.y + k * dir[1] * grid });
    let engulfed = false;
    for ( let i = 0; (i < 15) && !engulfed; i++ ) {
      await free();
      await ctx.call("move-token", { tokenId: pc.id, ...cell(2), elevation: at.elevation });
      await ctx.call("move-token", { tokenId: zombi.id, x: at.x, y: at.y, elevation: at.elevation });
      await sleep(600);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: zombi.id, itemId: cube.itemId, activityId: cube.activities.save, targetTokenIds: [] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      // `move-token` (displace) : l'engloutissement suit le trajet, quel que soit le mode. Un pas `walk` par écriture de x/y
      // plante dans le cœur sur Restored Keep (« setting 'last' », token.mjs:3831 : tous les points intermédiaires).
      await ctx.call("move-token", { tokenId: zombi.id, ...cell(4), elevation: at.elevation });
      await sleep(2500);
      const card = (await cards(since, "engulf"))[0];
      if ( i === 0 ) ctx.expect(!!card, "le Zombi traverse la case du PJ : une carte de sauvegarde pour lui");
      if ( !card ) break;
      const r = await ctx.settle(card.id).catch(() => null);
      const t = r?.targets?.find(x => x.token?.endsWith(pc.id));
      await sleep(1500);
      if ( t?.save?.success === false ) {
        engulfed = true;
        const eff = await swallowedEffect(), z = await ctx.position(zombi), q = await ctx.position(pc);
        ctx.expect(!!eff && (await inside()), `sauvegarde ratée (${t.save.total}) : englouti, dans l'espace du Zombi (effet ${eff?.name ?? "aucun"} ; Zombi ${z.x},${z.y} ; ${pcName} ${q.x},${q.y})`);
      } else if ( t?.save?.success === true && (i === 0) ) {
        ctx.expect(!(await swallowedEffect()) && !(await inside()), `sauvegarde réussie (${t.save.total}) : pas englouti, pas dans l'espace du Zombi`);
      }
    }
    if ( !ctx.expect(engulfed, "englouti au moins une fois") ) return;

    // 2. S'échapper, au tour du PJ.
    if ( !ctx.expect(await turnOf(pc), `tour de ${pcName}`) ) return;
    const actor = await ctx.call("get-actor", { actorId: pc.actorId });
    const escape = (actor.items ?? []).find(i => i.flags?.[MODULE_ID]?.basicAction === "escape");
    if ( ctx.expect(!!escape, `${pcName} a l'action de base S'échapper`) ) {
      let out = false;
      for ( let i = 0; (i < 20) && !out; i++ ) {
        const used = await ctx.use({ tokenId: pc.id, itemId: escape._id });
        await ctx.settle(used.usageMessageId).catch(() => null);
        await sleep(2000);
        out = !(await swallowedEffect());
      }
      ctx.expect(out && !(await inside()) && !(await statuses()).has("prone"), "s'échappe : libre, hors du Zombi, debout");
    }
    await cube.remove();
    await sleep(800);

    // 3. Avalement du Béhir sur une cible qui n'est pas agrippée par le Zombi.
    await free();
    await ctx.call("move-token", { tokenId: pc.id, x: (await ctx.position(zombi)).x + grid, y: (await ctx.position(zombi)).y });
    const behir = await lend(BEHIR, "swallow");
    let refused = false;
    for ( let i = 0; (i < 20) && !refused; i++ ) {
      const used = await ctx.use({ tokenId: zombi.id, itemId: behir.itemId, activityId: "YorssyWMumAsvzx3", targetTokenIds: [pc.id],
        usageConfig: { [MODULE_ID]: { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      await sleep(1500);
      if ( r?.targets?.[0]?.save?.success === false ) refused = !(await swallowedEffect());
    }
    ctx.expect(refused, "Avalement du Béhir, cible non agrippée : sauvegarde ratée, mais pas avalée");
    await behir.remove();
    await sleep(800);

    // 4. Blob : sauvegarde répétée à la fin du tour de l'englouti.
    await free();
    const blob = await lend(BLOB, "engulf");
    let held = false;
    for ( let i = 0; (i < 20) && !held; i++ ) {
      const used = await ctx.use({ tokenId: zombi.id, itemId: blob.itemId, activityId: blob.activities.save, targetTokenIds: [pc.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await sleep(1500);
      held = !!(await swallowedEffect());
    }
    if ( !ctx.expect(held, "Blob : englouti") ) return;
    if ( !ctx.expect(await turnOf(pc), `tour de ${pcName}`) ) return;
    const since = await ctx.lastMessageId();
    await ctx.nextTurn(); await sleep(3000);
    const resave = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.resave);
    if ( ctx.expect(!!resave, `fin du tour de ${pcName} : sauvegarde répétée`) ) {
      const r = await ctx.settle(resave.id).catch(() => null);
      const saved = r?.targets?.[0]?.save?.success;
      await sleep(1500);
      if ( saved === true ) ctx.expect(!(await swallowedEffect()) && !(await inside()), "réussie : sorti du Blob");
      else ctx.expect(!!(await swallowedEffect()), `ratée (${r?.targets?.[0]?.save?.total}) : toujours englouti`);
    }
  }
};
