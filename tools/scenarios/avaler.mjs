/**
 * M8 (SPEC §18.17) — Avaler. Monde `ravenloft` : l'Avalement du Béhir (Monster Manual) prêté à l'Ours brun, la Morsure de la
 * Tarasque prêtée au Zombi (4d12 : de quoi dépasser le seuil de 30 dégâts de l'intérieur). Initiative : Ours, Zombi, Kaalisti.
 *  1. Étreinte (le Béhir n'avale que ce qu'il agrippe), puis sauvegarde de Dextérité ratée : le Zombi est avalé (Aveuglé, Entravé, abri total), posé dans l'espace de l'Ours.
 *  2. Kaalisti tire sur le Zombi avalé : abri total, raté.
 *  3. L'Ours marche : le Zombi suit.
 *  4. Début du tour de l'Ours : une carte de dégâts d'acide pour le Zombi.
 *  5. Tour du Zombi : il mord l'Ours de l'intérieur jusqu'à 30 dégâts ; à la fin de son tour, l'Ours sauvegarde (Con DD 14) —
 *     ratée : le Zombi est régurgité, À terre, hors de l'Ours ; réussie : il reste avalé.
 *  6. L'Ours meurt : un Zombi encore avalé est libéré, À terre.
 */
const BEHIR = "Compendium.dnd-monster-manual.actors.Actor.mmBehir000000000";
const TARRASQUE = "Compendium.dnd-monster-manual.actors.Actor.mmTarrasque00000";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "avaler — Béhir : avalé, abri total, emporté, dégâts, régurgité, libéré",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ours brun", "Zombi", "Kaalisti"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ours brun, Zombi ou Kaalisti absent : non applicable"); return; }
    const bear = await ctx.token("Ours brun");
    const zombi = await ctx.token("Zombi");
    const warlock = await ctx.token("Kaalisti");
    const grid = await ctx.gridSize();
    for ( const t of [bear, zombi] ) {
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
      for ( const s of ["dead", "unconscious", "prone", "incapacitated", "blinded", "restrained", "grappled"] ) ctx.restore(() => ctx.removeStatusEffects(t, s));
    }
    const lend = async (uuid, identifier, token) => {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === identifier);
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(token.id, identifier));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));
      return itemId;
    };
    const swallowItem = await lend(BEHIR, "swallow", bear);
    // §18.21 : le Béhir n'avale que la créature qu'il agrippe — son Étreinte d'abord.
    const constrictItem = await lend(BEHIR, "constrict", bear);
    const biteItem = await lend(TARRASQUE, "bite", zombi);
    const swallowedEffect = async () => (await ctx.effects(zombi)).find(e => !e.disabled && (e.statuses ?? []).includes("coverTotal")) ?? null;
    const inside = async () => {
      const b = await ctx.position(bear);
      const z = await ctx.position(zombi);
      return (z.x >= b.x) && (z.x < b.x + 2 * grid) && (z.y >= b.y) && (z.y < b.y + 2 * grid);
    };
    const statuses = async t => new Set((await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []));

    const at = await ctx.position(bear);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + 2 * grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: warlock.id, x: at.x + 5 * grid, y: at.y, elevation: at.elevation });

    // 1. Agrippé par l'Étreinte, puis avalé.
    const grappled = async () => (await ctx.effects(zombi)).some(e => !e.disabled && (e.statuses ?? []).includes("grappled"));
    for ( let i = 0; (i < 20) && !(await grappled()); i++ ) {
      const used = await ctx.use({ tokenId: bear.id, itemId: constrictItem, activityId: "IgOMjRxAt7UISkJq", targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { legendary: "never" } } });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await sleep(1000);
    }
    if ( !ctx.expect(await grappled(), "Étreinte : le Zombi est agrippé par l'Ours") ) return;
    for ( let i = 0; (i < 20) && !(await swallowedEffect()); i++ ) {
      const used = await ctx.use({ tokenId: bear.id, itemId: swallowItem, activityId: "YorssyWMumAsvzx3", targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { legendary: "never" } } });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await sleep(1500);
    }
    if ( !ctx.expect(!!(await swallowedEffect()), "sauvegarde ratée : le Zombi est avalé (abri total)") ) return;
    const st = await statuses(zombi);
    ctx.expect(st.has("blinded") && st.has("restrained"), `Aveuglé et Entravé (${[...st].join(", ")})`);
    ctx.expect(!st.has("grappled"), "« no longer Grappled » : l'Étreinte a cessé");
    ctx.expect(await inside(), "posé dans l'espace de l'Ours");

    // 2. Abri total.
    const bolt = await ctx.use({ tokenId: warlock.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
    const shot = await ctx.settle(bolt.usageMessageId).catch(() => null);
    const t = shot?.targets?.find(x => x.token?.endsWith(zombi.id));
    ctx.expect(t && !t.hit, `Trait de feu sur le Zombi avalé : raté (${t?.reason ?? (t?.hit ? "touché" : "?")})`);

    // 3. Emporté.
    await ctx.call("move-token", { tokenId: bear.id, x: at.x, y: at.y + 2 * grid, elevation: at.elevation });
    await sleep(2000);
    ctx.expect(await inside(), "l'Ours se déplace : le Zombi suit, toujours dans son espace");

    // 4. Dégâts au début du tour de l'Ours.
    await ctx.startCombat([bear, zombi, warlock]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[bear, 30], [zombi, 20], [warlock, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === token.id).id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => { for ( let i = 0; (i < 4) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await sleep(1500); } return (await current()) === token.id; };
    const cards = async since => (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.areaTick?.event === "swallow");
    await turnOf(warlock);
    await ctx.setHp(zombi, 100);
    let mark = await ctx.lastMessageId();
    if ( !ctx.expect(await turnOf(bear), "tour de l'Ours") ) return;
    await sleep(2000);
    const acid = (await cards(mark))[0];
    if ( ctx.expect(!!acid, "début du tour de l'Ours : une carte de dégâts pour le Zombi avalé") ) {
      await ctx.settle(acid.id).catch(() => null);
      await sleep(800);
      ctx.expect((await ctx.hp(zombi)) < 100, `le Zombi subit l'acide (${await ctx.hp(zombi)} PV)`);
    }

    // 5. De l'intérieur : 30 dégâts, puis la sauvegarde de l'Ours à la fin du tour du Zombi.
    if ( !ctx.expect(await turnOf(zombi), "tour du Zombi") ) return;
    // De quoi encaisser 30 dégâts et plus sans mourir : dnd5e plafonne les PV au maximum (une trentaine pour l'Ours).
    const { data: bearTok } = await ctx.call("get-scene-object", { type: "Token", objectId: bear.id });
    const max0 = bearTok.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bear.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    await ctx.call("update-scene-object", { type: "Token", objectId: bear.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    let dealt = 0;
    for ( let i = 0; (i < 12) && (dealt < 30); i++ ) {
      const before = await ctx.hp(bear);
      const used = await ctx.use({ tokenId: zombi.id, itemId: biteItem, activityType: "attack", targetTokenIds: [bear.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await sleep(800);
      dealt += Math.max(0, before - (await ctx.hp(bear)));
    }
    if ( !ctx.expect(dealt >= 30, `le Zombi inflige ${dealt} dégâts à l'Ours de l'intérieur`) ) return;
    await ctx.nextTurn(); await sleep(3000);
    const log = (await ctx.engineLog()).filter(l => /de l'intérieur ce tour-ci — sauvegarde/.test(l)).at(-1) ?? "";
    ctx.expect(!!log, `fin du tour du Zombi : sauvegarde de l'Ours contre la régurgitation (${log.replace(/^.*\| /, "")})`);
    const kept = /: garde/.test(log);
    if ( !kept ) {
      ctx.expect(!(await swallowedEffect()) && !(await inside()) && (await statuses(zombi)).has("prone"), "régurgité : libéré, hors de l'Ours, À terre");
      return;
    }
    ctx.expect(!!(await swallowedEffect()), "sauvegarde réussie : le Zombi reste avalé");

    // 6. L'Ours meurt.
    await ctx.setHp(bear, 0);
    await sleep(3000);
    ctx.expect(!(await swallowedEffect()) && !(await inside()) && (await statuses(zombi)).has("prone"), "l'Ours meurt : le Zombi est libéré, À terre, hors de l'Ours");
  }
};
