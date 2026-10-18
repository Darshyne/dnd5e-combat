/**
 * §195 (lot 3 de l'escalade) : le contenu par identifiant, sur la scène « Escalade » de `dnd-6` (mur vertical en x = 700, plafond en
 * Surface à 20 ft sur la moitié ouest, sol en Surface ; le Guerrier contre le mur, le Zombi au sud, le Paladin au nord).
 *  1. Athlète prêté au Guerrier : le MJ actif lui tient un effet de vitesse d'escalade égale à sa Vitesse ; vraie vitesse d'escalade
 *     (coût ×1) — en combat, 2 cases montées coûtent 10 ft. L'item retiré, l'effet tombe.
 *  2. Pattes d'araignée lancée sur lui-même : la vitesse d'escalade de l'effet est sa Vitesse (les données disaient 1).
 *  3. Mouvement acrobatique prêté au Zombi (sans armure) : « Courir sur le mur » hors combat et à son tour, pas au tour d'un autre ; il
 *     court 2 cases à son tour, puis tombe à la fin de son tour.
 *  4. Pantoufles d'araignée portées par le Guerrier : vitesse d'escalade et plafond ; une zone de Graisse lancée sur lui (le Paladin) :
 *     surface glissante, « Grimper au plafond » n'est plus proposé ; la Graisse retirée, il l'est de nouveau. Au plafond, glissé par le MJ
 *     au-dessus d'une flaque d'Huile, il tombe (« surface glissante »).
 * Remet les règles, les positions, le mode, l'échelle, les PV ; le filet du lanceur reprend le reste (items prêtés, effets).
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgSlippersOfSpi";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "Escalade",
  name: "escalade-contenu — Athlète, Pattes d'araignée, Mouvement acrobatique, Pantoufles et surface glissante",

  async run(ctx) {
    const packs = JSON.stringify(await ctx.call("list-compendiums", {}).catch(() => null) ?? "");
    if ( !packs.includes("dnd-players-handbook.spells") || !packs.includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Manuel des joueurs ou Guide du maître absent : non applicable");
      return;
    }
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const paladin = await ctx.token("Paladin");
    const homes = new Map();
    for ( const t of [hero, zombi] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const state = t => ctx.engine("climbState", { tokenId: t.id });
    const waitFor = async (fn, tries=20) => { for ( let i = 0; i < tries; i++ ) { const v = await fn(); if ( v ) return v; await pause(400); } return null; };
    // dnd5e retire lui-même « En chute » après une chute : on attend qu'il l'ait fait, et on n'y touche pas (le retirer par le connecteur
    // en même temps que lui donne « ActiveEffect dnd5efalling0000 does not exist »).
    const reset = async t => {
      const h = homes.get(t.id);
      await waitFor(async () => !(await state(t)).falling, 15);
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { movementAction: "walk", "texture.scaleY": 1,
        [`flags.${MODULE_ID}.climb`]: null, [`flags.${MODULE_ID}.ceilingFlip`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: 0 }).catch(() => {});
      for ( const statusId of ["prone", "climbing", "ceiling"] ) await ctx.call("set-status", { tokenId: t.id, statusId, active: false }).catch(() => {});
      await ctx.setHp(t, h.hp).catch(() => {});
      await pause(600);
    };
    const endFight = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await pause(800);
    };
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    const facing = await ctx.engine("setting", { key: "faceMovement", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "faceMovement", value: facing?.before ?? true }));
    ctx.restore(() => reset(hero));
    ctx.restore(() => reset(zombi));
    ctx.restore(endFight);
    const removeItem = async (token, itemId) => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      await ctx.call("remove-embedded-item", { documentType: "Actor", id: data.actorId, itemId }).catch(() => {});
    };
    const fight = async order => {
      await ctx.startCombat(order);
      const read = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
      const c = await read();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 10 * i, combatId: ctx.ownCombat });
      }
      const current = async () => { const now = await read(); return now.combatants?.find(x => x.id === now.currentCombatantId)?.tokenId; };
      for ( let i = 0; (i < 4) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      return (await current()) === order[0].id;
    };

    // 1. Athlète : une vraie vitesse d'escalade, égale à la Vitesse.
    let s = await state(hero);
    const walk = s.speed?.speed;
    if ( !ctx.expect(!s.speed?.native && (s.room?.multiplier === 2), `sans capacité : pas de vitesse d'escalade (×${s.room?.multiplier}, Vitesse ${walk})`) ) return;
    const athleteId = await ctx.ensureItem(hero, `${PHB}feats.Item.phbftAthlete0000`);
    s = await waitFor(async () => { const now = await state(hero); return now.speed?.native ? now : null; });
    ctx.expect(!!s && (s.grants.length === 1) && (s.speed.speed === walk) && (s.room?.multiplier === 1),
      `Athlète : effet « ${s?.grants?.[0]?.name ?? "—"} », vitesse d'escalade ${s?.speed?.speed ?? "—"} ft (Vitesse ${walk}), coût ×${s?.room?.multiplier ?? "—"}`);
    if ( await fight([hero]) ) {
      const up = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
      const m = await ctx.engine("movement", { tokenId: hero.id });
      ctx.expect(up.done && (up.after.elevation === 10) && (m.combat?.spent === 10), `en combat, 2 cases d'escalade : élévation ${up.after.elevation}, ${m.combat?.spent} ft dépensés (×1)`);
    }
    await endFight();
    await reset(hero);
    await removeItem(hero, athleteId);
    s = await waitFor(async () => { const now = await state(hero); return now.grants.length ? null : now; });
    ctx.expect(!!s && !s.speed?.native, `Athlète retiré : l'effet tombe (${s ? "plus de vitesse d'escalade" : "effet resté"})`);

    // 2. Pattes d'araignée : la vitesse d'escalade de l'effet est la Vitesse.
    const spiderId = await ctx.ensureItem(hero, `${PHB}spells.Item.phbsplSpiderClim`, { system: { method: "atwill" } });
    await ctx.use({ tokenId: hero.id, itemId: spiderId, targetTokenIds: [hero.id], collectMs: 1500 });
    s = await waitFor(async () => { const now = await state(hero); return now.walksCeilings ? now : null; });
    ctx.expect(!!s && s.speed?.native && (s.speed.speed === walk), `Pattes d'araignée : vitesse d'escalade ${s?.speed?.speed ?? "—"} ft (Vitesse ${walk})`);
    await ctx.removeEffectsFrom(hero, "spider-climb");
    await removeItem(hero, spiderId);
    await pause(800);

    // 3. Mouvement acrobatique : courir sur le mur à son tour, tomber à la fin de son tour.
    const acroId = await ctx.ensureItem(zombi, `${PHB}classes.Item.phbmnkAcrobaticM`);
    s = await waitFor(async () => { const now = await state(zombi); return now.canRun ? now : null; });
    if ( ctx.expect(!!s && s.walls.length, `Mouvement acrobatique, hors combat, contre le mur : « Courir sur le mur » proposé (${!!s})`) ) {
      if ( ctx.expect(await fight([zombi, hero]), "combat : tour du Zombi") ) {
        s = await state(zombi);
        ctx.expect(s.canRun, `à son tour : « Courir sur le mur » proposé (${s.canRun})`);
        const run = await ctx.engine("climb", { tokenId: zombi.id, cells: 2, acrobatic: true });
        await pause(1200);
        s = await state(zombi);
        ctx.expect(run.done && (run.after.elevation === 10) && s.acrobatic && s.climbing, `court 2 cases sur le mur : élévation ${run.after.elevation}, drapeau acrobatique ${s.acrobatic}`);
        await ctx.nextTurn();
        const fell = await waitFor(async () => { const now = await state(zombi); return (now.position.elevation === 0) && !now.climbing && !now.falling ? now : null; }, 30);
        const why = (await ctx.engineLog()).filter(l => /Zombi: falls off the wall \(acrobatic/.test(l)).at(-1);
        ctx.expect(!!fell && !!why, `fin de son tour au mur : il tombe (élévation ${fell?.position.elevation ?? "—"} ; ${why ?? "raison absente du journal"})`);
        s = await state(zombi);
        ctx.expect(!s.canRun, `au tour du Guerrier : plus de « Courir sur le mur » pour le Zombi (${s.canRun})`);
      }
      await endFight();
    }
    await reset(zombi);
    await removeItem(zombi, acroId);

    // 4. Pantoufles d'araignée et surface glissante.
    const slippersId = await ctx.ensureItem(hero, DMG, { system: { equipped: true, attuned: true } });
    s = await waitFor(async () => { const now = await state(hero); return (now.walksCeilings && now.speed?.native) ? now : null; });
    if ( !ctx.expect(!!s && s.canCeiling && !s.slippery, `Pantoufles portées : vitesse d'escalade ${s?.speed?.speed ?? "—"}, plafond proposé ${s?.canCeiling ?? "—"}`) ) return;
    const greaseId = await ctx.ensureItem(paladin, `${PHB}spells.Item.phbsplGrease0000`, { system: { method: "atwill" } });
    const b = await ctx.box(hero);
    const used = await ctx.use({ tokenId: paladin.id, itemId: greaseId, activityType: "save", consume: false,
      area: { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: b.width * 0.6 } });
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(1500);
    await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: false }).catch(() => {});   // la Graisse a pu le renverser
    await pause(800);
    s = await state(hero);
    ctx.expect(!!used.regionId && s.slippery && !s.walksCeilingsHere && !s.canCeiling,
      `dans la Graisse : surface glissante ${s.slippery}, plafond par les Pantoufles ${s.walksCeilingsHere}, « Grimper au plafond » ${s.canCeiling ? "proposé" : "refusé"}`);
    if ( used.regionId ) await ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {});
    s = await waitFor(async () => { const now = await state(hero); return now.canCeiling ? now : null; });
    ctx.expect(!!s && !s.slippery, `la Graisse retirée : « Grimper au plafond » de nouveau proposé (${!!s})`);
    // Au plafond, glissé par le MJ au-dessus d'une flaque d'Huile (une région de l'item Huile, sans bornes de hauteur) : il tombe.
    const up = await ctx.engine("climbCeiling", { tokenId: hero.id });
    if ( ctx.expect(up.done && up.onCeiling, `gagne le plafond par les Pantoufles (${up.after.elevation} ft)`) ) {
      await pause(1500);
      const oilId = await ctx.ensureItem(paladin, `${PHB}equipment.Item.phbagOil00000000`).catch(() => null);
      const { data: pal } = await ctx.call("get-scene-object", { type: "Token", objectId: paladin.id });
      const grid = await ctx.gridSize();
      const spot = { x: homes.get(hero.id).pos.x - grid, y: homes.get(hero.id).pos.y };
      const region = oilId ? await ctx.call("create-region", { sceneId: (await ctx.scene()).sceneId, name: "Flaque d'huile (essai)", color: "#333333",
        shapes: [{ type: "rectangle", x: spot.x, y: spot.y, width: grid, height: grid }],
        regionData: { flags: { dnd5e: { item: `Actor.${pal.actorId}.Item.${oilId}` } } } }).catch(err => ({ error: err.message })) : null;
      const regionId = region?.id ?? region?.regionId ?? region?.region?.id;
      if ( regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {}));
      if ( ctx.expect(!!regionId, `flaque d'huile posée (${regionId ?? region?.error ?? "Huile introuvable"})`) ) {
        await ctx.call("move-token", { tokenId: hero.id, x: spot.x, y: spot.y, elevation: up.after.elevation });
        const fell = await waitFor(async () => { const now = await state(hero); return (now.position.elevation === 0) && !now.climbing && !now.falling ? now : null; }, 30);
        ctx.expect(!!fell && !fell.onCeiling, `au-dessus de l'huile, les Pantoufles lâchent : il tombe (élévation ${fell?.position.elevation ?? "—"})`);
      }
    }
    await reset(hero);
    await removeItem(hero, slippersId);
  }
};
