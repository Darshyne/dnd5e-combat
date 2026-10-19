/**
 * §208 : le saut des règles 2024 et la chute automatique, sur l'Arène de test de `dnd-6` avec le Guerrier (Force 17 : 17 ft en longueur
 * avec élan, 8 ft sans ; la grille est en cases de 5 ft). Vérifie :
 *  1. hors combat (élan toujours possible) : un saut de 3 cases passe, un saut de 4 cases est refusé ;
 *  2. en combat, sans élan : 2 cases refusées ; après 2 cases de marche, un saut de 3 cases passe, et coûte 15 ft ;
 *  3. Bottes de saut et de célérité prêtées (équipées, liées) : sans élan, 6 cases (30 ft) pour 10 ft de déplacement — saut fixe pris,
 *     20 ft rendus ; un second saut fixe le même tour est refusé ;
 *  4. arrivée dans une région de terrain difficile : le test d'Acrobaties est lancé (À terre ⇔ total < 10) ;
 *  5. chute automatique en combat : vitesse de vol prêtée, à 20 ft, mis À terre → dnd5e pose « En chute », le moteur le fait tomber
 *     (au sol, dégâts appliqués) ; Agrippé en vol → il tombe aussi (règles 2024, Vitesse 0).
 * Remet position, élévation, mode, PV, états, vitesse de vol, réglages ; retire l'objet prêté et la région.
 */
const MODULE_ID = "dnd5e-combat";
const BOOTS = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgBootsOfStridi";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "saut — longueur avec et sans élan, Bottes, atterrissage, chute automatique",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const home = await ctx.position(hero);
    const hp0 = await ctx.hp(hero);
    const actor0 = await ctx.call("get-actor", { actorId: hero.actorId });
    const fly0 = actor0.system?.attributes?.movement?.speeds?.fly ?? null;
    const cellOf = p => ({ i: Math.round(p.y / grid), j: Math.round(p.x / grid) });
    const start = cellOf(home);

    // Une ligne de 8 cases libres depuis le Guerrier (est, ouest, nord, sud).
    const taken = new Set(tokens.filter(t => t.id !== hero.id).map(t => { const c = cellOf(t); return `${c.i},${c.j}`; }));
    const dirs = [[0, 1], [0, -1], [-1, 0], [1, 0]];
    const dir = dirs.find(([di, dj]) => [1, 2, 3, 4, 5, 6, 7, 8].every(k => !taken.has(`${start.i + (di * k)},${start.j + (dj * k)}`)));
    if ( !ctx.expect(!!dir, "une ligne de 8 cases libres autour du Guerrier") ) return;
    const at = k => ({ i: start.i + (dir[0] * k), j: start.j + (dir[1] * k) });

    const goHome = async () => {
      await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: false }).catch(() => {});
      for ( const statusId of ["grappled", "unconscious", "dead"] ) await ctx.call("set-status", { tokenId: hero.id, statusId, active: false }).catch(() => {});
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk" } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      await pause(700);
    };
    const endCombat = async () => { if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; } };
    const fight = async () => {
      await ctx.startCombat([hero, zombi]);
      const s = await ctx.combat();
      const combat = s.combat ?? s.combats?.[0] ?? s;
      for ( const [t, v] of [[hero, 20], [zombi, 1]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; i < 3; i++ ) {
        const c = (await ctx.combat()).combat ?? (await ctx.combat());
        if ( c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId === hero.id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200);
      }
      await pause(800);
    };
    const jump = (k, high=false) => ctx.engine("jump", { tokenId: hero.id, cell: at(k), high });
    const spent = async () => (await ctx.engine("movement", { tokenId: hero.id })).combat?.spent ?? null;
    const auto = await ctx.engine("setting", { key: "autoFall", value: "combat" });
    ctx.restore(() => ctx.engine("setting", { key: "autoFall", value: auto.before }));
    ctx.restore(async () => { await endCombat(); await goHome(); await ctx.setHp(hero, hp0).catch(() => {}); });
    // La vitesse de vol prêtée : remise telle qu'elle était, ou retirée (une valeur nulle ne l'efface pas).
    ctx.restore(() => ctx.call("update-actor", { actorId: hero.actorId,
      actorData: (fly0 === null) ? { "system.attributes.movement.speeds.-=fly": null } : { "system.attributes.movement.speeds.fly": fly0 } }).catch(() => {}));

    // 1. Hors combat : 3 cases (15 ft) passent, 4 cases (20 ft) non.
    let r = await jump(3);
    ctx.expect((r.result === true) && ((r.after.x !== r.before.x) || (r.after.y !== r.before.y)), `hors combat, 3 cases : saute (limite ${r.options.long} ft, élan ${r.options.runningStart})`);
    await goHome();
    r = await jump(4);
    ctx.expect(r.after.x === r.before.x && r.after.y === r.before.y && r.warnings.some(w => /17/.test(w)), `4 cases : refusé (${r.warnings.join(" | ")})`);

    // 2. En combat, sans élan : 2 cases refusées ; après 2 cases de marche, 3 cases passent.
    await fight();
    r = await jump(2);
    ctx.expect(!r.options.runningStart && r.options.long === 8 && r.after.x === r.before.x && r.after.y === r.before.y,
      `sans élan : limite ${r.options.long} ft, 2 cases refusées (${r.warnings.join(" | ")})`);
    await ctx.engine("move", { tokenId: hero.id, cell: at(2) });
    const s0 = await spent();
    r = await jump(5);
    ctx.expect(r.result === true && r.options.runningStart && r.options.long === 17, `après 2 cases de marche : élan, saut de 3 cases (limite ${r.options.long} ft)`);
    const s1 = await spent();
    ctx.expect(Math.abs((s1 - s0) - 15) < 0.01, `le saut coûte 15 ft (${s0} → ${s1})`);
    await endCombat(); await goHome();

    // 3. Bottes : 6 cases (30 ft) sans élan pour 10 ft ; une fois par tour.
    const { data: boots } = await ctx.call("get-compendium-entry", { uuid: BOOTS });
    const { _id, folder, ownership, _stats, ...bootsData } = boots;
    bootsData.system = { ...bootsData.system, equipped: true, attuned: true };
    const lent = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: bootsData, match: { path: "name", value: bootsData.name } });
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: lent.id }).catch(() => {}));
    await fight();
    r = await jump(6);
    ctx.expect(r.result === true && r.options.fixed?.distance === 30 && r.budget?.fixedJump && Math.abs(r.budget.jumped - 20) < 0.01,
      `Bottes : 6 cases sans élan, saut fixe (rendu ${r.budget?.jumped} ft)`);
    ctx.expect(Math.abs((await spent()) - 10) < 0.01, `déplacement compté : ${await spent()} ft (10 attendus)`);
    r = await jump(9);
    ctx.expect(r.after.x === r.before.x && r.after.y === r.before.y && r.options.fixed === null, `second saut fixe le même tour : refusé (${r.warnings.join(" | ")})`);
    await endCombat(); await goHome();

    // 4. Terrain difficile à l'arrivée : le test d'Acrobaties.
    const land = at(2);
    const region = await ctx.call("create-region", { sceneId: (await ctx.scene()).sceneId, name: "DAS test terrain difficile", shapes: [{ type: "rectangle", x: land.j * grid, y: land.i * grid, width: grid, height: grid }],
      behaviors: [{ type: "dnd5e.difficultTerrain", system: { magical: false, types: [] } }] }).catch(err => ({ error: err.message }));
    const regionId = region?.id ?? region?.regionId ?? region?.region?._id;
    if ( regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {}));
    if ( ctx.expect(!!regionId, `région de terrain difficile posée (${region?.error ?? regionId})`) ) {
      const since = await ctx.lastMessageId();
      r = await jump(2);
      await pause(1500);
      const roll = (await ctx.messagesSince(since)).filter(m => (m.rolls ?? []).some(x => /d20/.test(x.formula ?? ""))).at(-1);
      const total = roll?.rolls?.[0]?.total;
      ctx.expect(r.result === true && Number.isFinite(total), `atterrissage en terrain difficile : test d'Acrobaties (${total})`);
      ctx.expect(r.statuses.includes("prone") === (total < 10), `À terre ⇔ total < 10 (${total}, À terre ${r.statuses.includes("prone")})`);
      await goHome();
    }

    // 5. Chute automatique en combat.
    await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.movement.speeds.fly": 30 } });
    await fight();
    const aloft = async () => {
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: 20 });
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "fly" } });
      await pause(800);
    };
    const landed = async () => {
      for ( let i = 0; i < 20; i++ ) { const p = await ctx.position(hero); if ( (p.elevation ?? 0) === 0 ) return true; await pause(500); }
      return false;
    };
    await aloft();
    await ctx.setHp(hero, hp0);
    await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: true });
    ctx.expect(await landed(), "volant mis À terre à 20 ft : il tombe tout seul (« En chute » de dnd5e)");
    await pause(2500);
    ctx.expect((await ctx.hp(hero)) < hp0, `dégâts de chute appliqués (${hp0} → ${await ctx.hp(hero)})`);
    await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: false });
    await ctx.setHp(hero, hp0);
    await aloft();
    await ctx.call("set-status", { tokenId: hero.id, statusId: "grappled", active: true });
    ctx.expect(await landed(), "volant Agrippé à 20 ft : il tombe aussi (Vitesse 0, règles 2024)");
  }
};
