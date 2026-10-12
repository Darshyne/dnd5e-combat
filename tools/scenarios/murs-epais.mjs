/**
 * Murs épais posés sur les cases (SPEC §172), monde `dnd-6`, arène, coin libre au nord-ouest. Le Magicien (sorts prêtés du Manuel des
 * joueurs, à volonté) pose les murs par `api.mcp.wall` (la visée par points, les clics remplacés par les centres de case) :
 *  - Mur d'épines : la rangée de cases (un point hors de l'axe redressé, bouts prolongés d'une demi-case), un mur du cœur qui arrête la
 *    vue, le coût de déplacement ×4 ; le Zombi, dans une case du mur, fait la sauvegarde à l'apparition ; à son tour, sorti puis rentré
 *    dans le mur : la sauvegarde de traversée (une fois par tour) ; en anneau : une bande à l'intérieur du cercle, ses murs ;
 *  - Barrière de lames : la rangée de cases, terrain difficile ; le Guerrier et le Bandit de part et d'autre : abri aux trois quarts.
 * Remet positions, PV, combat.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "murs épais — Mur d'épines, Barrière de lames : sur les cases, ×4, traversée, anneau, abri",

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
    const C = (gx, gy) => ({ x: (gx + 0.5) * grid, y: (gy + 0.5) * grid });
    const place = async (t, gx, gy) => { await ctx.call("move-token", { tokenId: t.id, x: gx * grid, y: gy * grid, elevation: 0 }); await pause(800); };
    const lend = id => ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
    const state = id => ctx.engine("wallSide", { regionId: id });
    const hits = async re => (await ctx.engineLog()).filter(l => re.test(l));
    const remove = async id => { await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); await pause(1500); };

    await place(mage, 12, 30);
    await place(zombi, 14, 33);
    await place(fighter, 22, 30);
    await place(bandit, 22, 36);
    await ctx.setHp(zombi, 100);
    await ctx.startCombat([mage, zombi]);
    const current = async () => { const s = await ctx.combat(); const c = s.combat ?? s.combats?.[0] ?? s; return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => {
      for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await pause(1200); }
      return (await current()) === token.id;
    };
    if ( !ctx.expect(await turnOf(mage), "tour du Magicien") ) return;

    // 1. Mur d'épines, en ligne.
    const thorns = await lend("phbsplWallofThor");
    await ctx.engineLog();
    const placed = await ctx.engine("wall", { tokenId: mage.id, itemId: thorns, points: [C(11, 33), { x: 16.5 * grid, y: 33.8 * grid }] });
    if ( !ctx.expect(!!placed?.regionId, "Mur d'épines : région posée") ) return;
    regions.push(placed.regionId);
    await pause(3000);
    let s = await state(placed.regionId);
    const [line] = s.shapes;
    ctx.expect((s.shapes.length === 1) && (line.type === "line") && (Math.round(line.x) === 11 * grid) && (Math.round(line.y) === 33.5 * grid)
      && (Math.round(line.length) === 6 * grid) && (Math.round(line.width) === grid),
      `sur les cases : ${line.type} de (${Math.round(line.x / grid)}, ${(line.y / grid).toFixed(1)}) sur ${Math.round(line.length / grid)} cases, ${Math.round(line.width / grid)} d'épaisseur`);
    ctx.expect((s.walls.length === 1) && (s.walls[0].sight === 20) && (s.walls[0].move === 0), `vue arrêtée : ${s.walls.length} mur(s), vue ${s.walls.map(w => w.sight).join("/")}`);
    const cost = s.behaviors.find(b => b.type === "modifyMovementCost");
    ctx.expect(cost?.system?.difficulties?.walk === 4, `déplacement ×4 (${JSON.stringify(cost?.system?.difficulties ?? null)})`);
    const posed = await hits(/area placed: \d+ token\(s\) covered, \d+ affected/);
    ctx.expect(posed.some(l => /covered, 1 affected/.test(l)), `apparition : le Zombi, dans le mur, sauvegarde (${posed.at(-1) ?? "rien"})`);
    await pause(2500);
    let hp = await ctx.hp(zombi);
    ctx.expect(hp < 100, `apparition : dégâts (${100 - hp} PV)`);

    if ( !ctx.expect(await turnOf(zombi), "tour du Zombi") ) return;
    await ctx.engineLog();
    let before = await ctx.hp(zombi);
    // Contre le mur : une case d'épines coûte 6 m (×4), toute la vitesse du Zombi.
    await place(zombi, 14, 34);
    const moved = await ctx.engine("move", { tokenId: zombi.id, point: C(14, 33) });
    ctx.log(`déplacement : ${JSON.stringify(moved?.cost ?? moved?.after ?? null)}`);
    await pause(4500);
    hp = await ctx.hp(zombi);
    const entered = await hits(/Zombi \(enter\)/);
    ctx.expect((entered.length === 1) && (hp < before), `rentré dans le mur : sauvegarde de traversée (${entered.length} rejeu, ${before - hp} PV)`);
    before = hp;
    await ctx.nextTurn();
    await pause(3500);
    hp = await ctx.hp(zombi);
    ctx.expect(hp === before, `fin de tour dans le mur, même tour : rien de plus (${before - hp} PV)`);
    await remove(placed.regionId);

    // 2. Mur d'épines en anneau autour du Zombi.
    if ( !ctx.expect(await turnOf(mage), "tour du Magicien (anneau)") ) return;
    const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === thorns);
    const ring = Object.entries(item?.system?.activities ?? {}).find(([, a]) => ["cylinder", "ring"].includes(a.target?.template?.type))?.[0];
    const used = await ctx.use({ tokenId: mage.id, itemId: thorns, activityId: ring, consume: false, area: { shape: "circle", ...C(14, 33), radius: 2 * grid } });
    if ( ctx.expect(!!used.regionId, "anneau d'épines : région posée") ) {
      regions.push(used.regionId);
      await pause(3000);
      s = await state(used.regionId);
      const r = s.shapes[0];
      ctx.expect((s.shapes.length === 1) && (r.type === "ring") && (Math.round(r.innerWidth) === grid) && !r.outerWidth,
        `anneau : bande d'une case à l'intérieur du cercle (${r.type} ${Math.round(r.radius)} − ${Math.round(r.innerWidth ?? 0)})`);
      ctx.expect(s.walls.length === 24, `anneau : ${s.walls.length} murs`);
      await remove(used.regionId);
    }

    // 3. Barrière de lames : abri aux trois quarts derrière elle.
    const blades = await lend("phbsplBladeBarri");
    await place(zombi, 30, 36);
    const barrier = await ctx.engine("wall", { tokenId: mage.id, itemId: blades, points: [C(18, 33), C(26, 33)] });
    if ( !ctx.expect(!!barrier?.regionId, "Barrière de lames : région posée") ) return;
    regions.push(barrier.regionId);
    await pause(3000);
    s = await state(barrier.regionId);
    ctx.expect((s.shapes.length === 1) && (Math.round(s.shapes[0].length) === 9 * grid), `sur les cases : ${Math.round(s.shapes[0].length / grid)} cases`);
    ctx.expect(s.behaviors.some(b => b.type === "dnd5e.difficultTerrain"), "terrain difficile");
    const cover = await ctx.engine("cover", { attackerId: fighter.id, targetId: bandit.id });
    ctx.expect(cover?.degree === "threeQuarters", `le Bandit derrière la Barrière : abri ${cover?.degree ?? "aucun"} (+${cover?.bonus ?? 0})`);
    await place(bandit, 22, 33);
    const inside = await ctx.engine("cover", { attackerId: fighter.id, targetId: bandit.id });
    ctx.expect(!inside || (inside.degree !== "threeQuarters"), `le Bandit dans la Barrière : pas d'abri par elle (${inside?.degree ?? "aucun"})`);
  }
};
