/**
 * Murs fins posés par points (SPEC §173), monde `dnd-6`, arène, coin libre au nord-ouest. Le Magicien (sorts prêtés du Manuel des
 * joueurs, à volonté) pose les murs par `api.mcp.wall` (la visée par points, les clics remplacés par les points) :
 *  - Mur de vent : un point hors de l'axe redressé ; le Zombi, contre le mur, fait la sauvegarde à l'apparition ; l'arc du Guerrier sur
 *    le Bandit, derrière le mur : abri total ; son fléau : rien ;
 *  - Mur de glace : le Zombi, contre le mur, fait la sauvegarde ; le déplacement arrêté ;
 *  - Mur de pierre : la vue et le déplacement arrêtés ;
 *  - Mur de force : en globe (pose par coordonnées), un anneau fin ;
 *  - Mur prismatique : sa lumière (30 m), sa zone d'aveuglement à 6 m des deux côtés, abri total au travers ; le Zombi qui le traverse :
 *    les couches à la fois.
 * Remet positions, PV, combat.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const BOW = "2Qu6b1ILyNRgXXfR", FLAIL = "z2c5wcJfxlGg83xo";   // l'arc court et le fléau d'armes du Guerrier de `dnd-6`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "murs fins — vent, glace, pierre, force, prismatique : sans diagonale, apparition, abri, anneau, couches",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Zombi", "Guerrier", "Bandit"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, zombi, fighter, bandit] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [mage, zombi, fighter, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const regions = [];
    ctx.restore(async () => {
      for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await pause(1000);
      for ( const t of [mage, zombi, fighter, bandit] ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
    });
    const P = (gx, gy) => ({ x: gx * grid, y: gy * grid });
    const place = async (t, gx, gy) => { await ctx.call("move-token", { tokenId: t.id, ...P(gx, gy), elevation: 0 }); await pause(800); };
    const lend = id => ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
    const state = id => ctx.engine("wallSide", { regionId: id });
    const hits = async re => (await ctx.engineLog()).filter(l => re.test(l));
    const remove = async id => { await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); await pause(1500); };
    const pose = async (label, id, points) => {
      await ctx.engineLog();
      const placed = await ctx.engine("wall", { tokenId: mage.id, itemId: id, points });
      if ( !ctx.expect(!!placed?.regionId, `${label} : région posée`) ) return null;
      regions.push(placed.regionId);
      await pause(3000);
      return placed.regionId;
    };
    const straight = s => s.shapes.every(x => (x.type !== "line") || ((Math.round(x.rotation) % 90) === 0));

    await place(mage, 12, 30);
    await place(zombi, 14, 33);
    await ctx.setHp(zombi, 100);
    await ctx.startCombat([mage, zombi]);
    const current = async () => { const s = await ctx.combat(); const c = s.combat ?? s.combats?.[0] ?? s; return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => {
      for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await pause(1200); }
      return (await current()) === token.id;
    };
    if ( !ctx.expect(await turnOf(mage), "tour du Magicien") ) return;

    // 1. Mur de vent.
    let id = await pose("Mur de vent", await lend("phbsplWindWall00"), [P(11, 33), { x: 17 * grid, y: 33.4 * grid }]);
    if ( id ) {
      const s = await state(id);
      ctx.expect(straight(s) && (Math.round(s.shapes[0].y) === 33 * grid), `Mur de vent : sans diagonale (${s.shapes.map(x => `${Math.round(x.rotation)}°`).join(", ")})`);
      const posed = await hits(/area placed: \d+ token\(s\) covered, \d+ affected/);
      ctx.expect(posed.some(l => /covered, 1 affected/.test(l)), `Mur de vent : le Zombi, contre le mur, sauvegarde (${posed.at(-1) ?? "rien"})`);
      await place(fighter, 14, 30);
      await place(bandit, 15, 36);
      const bow = await ctx.engine("cover", { attackerId: fighter.id, targetId: bandit.id, itemId: BOW });
      const flail = await ctx.engine("cover", { attackerId: fighter.id, targetId: bandit.id, itemId: FLAIL });
      ctx.expect(bow?.degree === "total", `Mur de vent : l'arc au travers → abri ${bow?.degree ?? "aucun"}`);
      ctx.expect(flail?.degree !== "total", `Mur de vent : le fléau, sans abri par le mur (${flail?.degree ?? "aucun"})`);
      await remove(id);
    }

    // 2. Mur de glace.
    id = await pose("Mur de glace", await lend("phbsplWallofIce0"), [P(11, 33), P(17, 33)]);
    if ( id ) {
      const s = await state(id);
      const posed = await hits(/area placed: \d+ token\(s\) covered, \d+ affected/);
      ctx.expect(posed.some(l => /covered, 1 affected/.test(l)), `Mur de glace : le Zombi sauvegarde (${posed.at(-1) ?? "rien"})`);
      ctx.expect(s.walls.length && s.walls.every(w => w.move === 20), `Mur de glace : ${s.walls.length} mur(s), déplacement arrêté`);
      await remove(id);
    }

    // 3. Mur de pierre.
    id = await pose("Mur de pierre", await lend("phbsplWallofSton"), [P(11, 28), P(17, 28)]);
    if ( id ) {
      const s = await state(id);
      ctx.expect(straight(s) && s.walls.length && s.walls.every(w => (w.move === 20) && (w.sight === 20)), `Mur de pierre : ${s.walls.length} mur(s), vue et déplacement arrêtés`);
      await remove(id);
    }

    // 4. Mur de force, en globe.
    const force = await lend("phbsplWallofForc");
    const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === force);
    const globe = Object.entries(item?.system?.activities ?? {}).find(([, a]) => a.target?.template?.type === "sphere")?.[0];
    const used = await ctx.use({ tokenId: mage.id, itemId: force, activityId: globe, consume: false, area: { shape: "circle", x: 20.5 * grid, y: 28.5 * grid, radius: 2 * grid } });
    if ( ctx.expect(!!used.regionId, "Mur de force : globe posé") ) {
      regions.push(used.regionId);
      await pause(3000);
      const s = await state(used.regionId);
      ctx.expect((s.shapes.length === 1) && (s.shapes[0].type === "ring") && (s.walls.length === 24), `Mur de force : anneau fin, ${s.walls.length} murs (${s.shapes.map(x => x.type).join(", ")})`);
      await remove(used.regionId);
    }

    // 5. Mur prismatique : loin du Zombi, puis il le traverse.
    await place(zombi, 14, 37);
    id = await pose("Mur prismatique", await lend("phbsplPrismaticW"), [P(11, 35), P(18, 35)]);
    if ( id ) {
      const s = await state(id);
      ctx.expect(s.lights.length && s.lights.every(l => (l.bright === 100) && (l.dim === 200)), `Mur prismatique : ${s.lights.length} lumières, 100/200 ft`);
      const aura = (await ctx.call("list-scene-objects", { types: ["Region"] })).objects.Region.find(r => /abords|surroundings/.test(r.name));
      ctx.expect(!!aura, `Mur prismatique : sa zone d'aveuglement à 6 m (« ${aura?.name ?? "aucune"} »)`);
      if ( aura ) regions.push(aura.id ?? aura._id);
      await place(fighter, 14, 32);
      await place(bandit, 15, 38);
      const through = await ctx.engine("cover", { attackerId: fighter.id, targetId: bandit.id, itemId: FLAIL });
      ctx.expect(through?.degree === "total", `Mur prismatique : abri ${through?.degree ?? "aucun"} au travers`);
      await place(bandit, 30, 38);
      if ( ctx.expect(await turnOf(zombi), "tour du Zombi") ) {
        await ctx.engineLog();
        const before = await ctx.hp(zombi);
        await ctx.engine("move", { tokenId: zombi.id, point: { x: 14.5 * grid, y: 34.5 * grid } });
        // La résolution attend la fin des animations (les cinq impacts du prisme, à la suite) : on attend que les PV tombent.
        let hp = before;
        const log = [];
        for ( let i = 0; (i < 30) && (hp === before); i++ ) { await pause(1000); log.push(...(await ctx.engineLog())); hp = await ctx.hp(zombi); }
        await pause(1000);
        log.push(...(await ctx.engineLog()));
        ctx.expect(log.some(l => /Zombi \(enter\)/.test(l) && /Prismatic|prismatique/i.test(l)), `Mur prismatique : le Zombi le traverse (${log.filter(l => /\(enter\)/.test(l)).join(" ; ") || "aucun rejeu"})`);
        ctx.expect(log.some(l => /1 \+ 2 \+ 3 \+ 4 \+ 5 \+ 6 \+ 7/.test(l)), `Mur prismatique : toutes les couches (${log.find(l => / \+ /.test(l)) ?? "aucune"})`);
        ctx.expect(hp < before, `Mur prismatique : dégâts (${before - hp} PV)`);
      }
    }
  }
};
