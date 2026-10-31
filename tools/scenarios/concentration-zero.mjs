/**
 * §303 : 0 PV = fin de la Concentration (demande de l'utilisateur, 2026-10-31 : « le Mur de feu ne disparaît pas quand le token meurt ou tombe à
 * 0 PV »). Arène de test, Magicien et Zombi. Pour chaque cas, le Magicien se concentre puis tombe à 0 PV par de vrais dégâts (`applyDamage`) :
 *  - Mur de feu posé par points : la Concentration tombe, la région du mur, sa face brûlante, ses murs du cœur et ses lumières aussi ;
 *  - Rayon de lune (zone posée par l'outil du connecteur) : la Concentration et la zone tombent ;
 *  - PV mis à 0 sur la fiche (sans dégâts), un PNJ (token non lié) tué, mort sur le coup (dégâts ≥ PV + PV max) : idem avec un Mur de feu ;
 *  - aucune erreur « ActiveEffect … does not exist » : la carte « fin » de dnd5e et la sauvegarde des mêmes dégâts ne la retirent plus deux fois.
 * Remet PV, états, positions ; retire ce qui resterait.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "0 PV = fin de la Concentration (Mur de feu, Rayon de lune, mort sur le coup)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien ou Zombi absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const grid = await ctx.gridSize();
    const home = { pos: await ctx.position(mage), hp: await ctx.hp(mage) };
    const sceneObjects = async type => (await ctx.call("list-scene-objects", { types: [type] })).objects?.[type] ?? [];
    const regionIds = async () => new Set((await sceneObjects("Region")).map(r => r.id));
    const wallCount = async () => (await sceneObjects("Wall")).length;
    const lightCount = async () => (await sceneObjects("AmbientLight")).length;
    const concentrating = async () => ((await ctx.call("get-actor", { actorId: mage.actorId })).effects ?? []).filter(e => (e.statuses ?? []).includes("concentrating")).length;
    const revive = async () => {
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) {
        await ctx.removeStatusEffects?.(mage, s).catch?.(() => {});
        await ctx.call("set-status", { tokenId: mage.id, statusId: s, active: false }).catch(() => {});
      }
      await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } }).catch(() => {});
      await ctx.setHp(mage, home.hp);
      await pause(800);
    };
    const baseRegions = await regionIds();
    const baseWalls = await wallCount(), baseLights = await lightCount();
    ctx.restore(async () => {
      for ( const id of await regionIds() ) if ( !baseRegions.has(id) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await revive();
      await ctx.call("move-token", { tokenId: mage.id, x: home.pos.x, y: home.pos.y, elevation: home.pos.elevation }).catch(() => {});
    });
    const fire = await ctx.ensureItem(mage, PHB + "phbsplWallofFire", { system: { method: "atwill" } });
    const beam = await ctx.ensureItem(mage, PHB + "phbsplMoonbeam00", { system: { method: "atwill" } });
    await ctx.call("move-token", { tokenId: mage.id, x: 12 * grid, y: 30 * grid, elevation: 0 });
    await pause(800);
    const P = (gx, gy) => ({ x: gx * grid, y: gy * grid });
    /** Attend que la condition tienne (12 s au plus). */
    const until = async test => { for ( let i = 0; i < 24; i++ ) { if ( await test() ) return true; await pause(500); } return false; };
    const checkGone = async (label) => {
      ctx.expect(await until(async () => (await concentrating()) === 0), `${label} : la Concentration tombe`);
      ctx.expect(await until(async () => [...await regionIds()].every(id => baseRegions.has(id))), `${label} : plus aucune zone du sort (${[...await regionIds()].filter(id => !baseRegions.has(id)).length} restante(s))`);
      ctx.expect(await until(async () => (await wallCount()) === baseWalls), `${label} : murs du cœur retirés (${await wallCount()} / ${baseWalls})`);
      ctx.expect(await until(async () => (await lightCount()) === baseLights), `${label} : lumières retirées (${await lightCount()} / ${baseLights})`);
    };

    // 1. Mur de feu, puis 0 PV.
    await ctx.setHp(mage, 20);
    const placed = await ctx.engine("wall", { tokenId: mage.id, itemId: fire, points: [P(11, 33), P(17, 33)] });
    if ( ctx.expect(!!placed?.regionId, "Mur de feu posé") ) {
      ctx.expect(await until(async () => (await concentrating()) === 1), "le Magicien se concentre");
      await pause(2000);
      const r = await ctx.engine("hurt", { tokenId: mage.id, amount: 25 });

      ctx.log(`dégâts : ${r.before} → ${r.after} PV`);
      await checkGone("Mur de feu, 0 PV");
    }
    await revive();

    // 2. Rayon de lune, puis 0 PV.
    await ctx.setHp(mage, 20);
    const used = await ctx.use({ tokenId: mage.id, itemId: beam, activityType: "save", consume: false, area: { shape: "circle", ...P(20, 30), radius: grid } });
    if ( ctx.expect(!!used?.regionId, "Rayon de lune posé") ) {
      await ctx.settle(used.usageMessageId).catch(() => null);
      ctx.expect(await until(async () => (await concentrating()) === 1), "le Magicien se concentre");
      await ctx.engine("hurt", { tokenId: mage.id, amount: 25 });
      await checkGone("Rayon de lune, 0 PV");
    }
    await revive();

    // 2 bis. PV mis à 0 directement (fiche, HUD), sans dégâts.
    await ctx.setHp(mage, 20);
    const direct = await ctx.engine("wall", { tokenId: mage.id, itemId: fire, points: [P(11, 37), P(17, 37)] });
    if ( ctx.expect(!!direct?.regionId, "Mur de feu posé (PV mis à 0 sur la fiche)") ) {
      await until(async () => (await concentrating()) === 1);
      await pause(2000);
      await ctx.setHp(mage, 0);
      await checkGone("Mur de feu, PV mis à 0 sur la fiche");
    }
    await revive();

    // 2 ter. Un PNJ (token non lié) qui se concentre, tué.
    const zombi = await ctx.token("Zombi");
    const zHome = { pos: await ctx.position(zombi), hp: await ctx.hp(zombi) };
    ctx.restore(async () => {
      for ( const s of ["dead", "unconscious", "prone"] ) await ctx.call("set-status", { tokenId: zombi.id, statusId: s, active: false }).catch(() => {});
      await ctx.setHp(zombi, zHome.hp);
      await ctx.call("move-token", { tokenId: zombi.id, x: zHome.pos.x, y: zHome.pos.y, elevation: zHome.pos.elevation }).catch(() => {});
    });
    const zFire = await ctx.ensureItem(zombi, PHB + "phbsplWallofFire", { system: { method: "atwill" } });
    const zConc = async () => ((await ctx.effects(zombi)) ?? []).filter(e => (e.statuses ?? []).includes("concentrating")).length;
    await ctx.call("move-token", { tokenId: zombi.id, x: 24 * grid, y: 30 * grid, elevation: 0 });
    await ctx.setHp(zombi, 20);
    const zWall = await ctx.engine("wall", { tokenId: zombi.id, itemId: zFire, points: [P(23, 33), P(29, 33)] });
    if ( ctx.expect(!!zWall?.regionId, "Mur de feu du Zombi posé") ) {
      ctx.expect(await until(async () => (await zConc()) === 1), "le Zombi se concentre");
      await pause(2000);
      await ctx.engine("hurt", { tokenId: zombi.id, amount: 50 });
      ctx.expect(await until(async () => (await zConc()) === 0), "PNJ tué : la Concentration tombe");
      ctx.expect(await until(async () => [...await regionIds()].every(id => baseRegions.has(id))), `PNJ tué : plus aucune zone du sort`);
      ctx.expect(await until(async () => (await wallCount()) === baseWalls), `PNJ tué : murs du cœur retirés (${await wallCount()} / ${baseWalls})`);
    }

    // 3. Mur de feu, mort sur le coup.
    await ctx.setHp(mage, 10);
    const again = await ctx.engine("wall", { tokenId: mage.id, itemId: fire, points: [P(11, 35), P(17, 35)] });
    if ( ctx.expect(!!again?.regionId, "Mur de feu posé (2)") ) {
      await until(async () => (await concentrating()) === 1);
      await pause(2000);
      await ctx.engine("hurt", { tokenId: mage.id, amount: 200 });
      await checkGone("Mur de feu, mort sur le coup");
    }
  }
};
