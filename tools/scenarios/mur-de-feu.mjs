/**
 * Mur de feu (SPEC §169), monde `dnd-6`, arène, coin libre au nord-ouest. Le Magicien (sort prêté du Manuel des joueurs, à volonté) pose
 * le mur par `api.mcp.wall` (la visée par points, les clics remplacés par les points) :
 *  - en L, un point hors de l'axe : la ligne redressée (pas de diagonale), deux segments, des murs du cœur qui arrêtent la vue, pas le
 *    déplacement ; le côté brûlant à l'opposé du Magicien (au sud), sa face brûlante posée (3 m) ;
 *  - le Zombi, au sud contre le mur, fait la sauvegarde à l'apparition ;
 *  - à son tour, il traverse le mur vers le nord : dégâts sans sauvegarde ; il repasse au sud : rien (une fois par tour) ; il finit son
 *    tour au sud : dégâts sans sauvegarde ;
 *  - la face retournée passe au nord ;
 *  - en anneau autour du Zombi, le Magicien dehors : le disque posé devient un anneau fin (forme « ring »), ses murs sur le rayon,
 *    la face brûlante à l'intérieur ; le Zombi y finit son tour : dégâts.
 * Remet positions, PV, combat ; les régions et murs posés tombent avec la remise en état du lanceur.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Mur de feu — sans diagonale, opaque, face brûlante, traversée, anneau",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien ou Zombi absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [mage, zombi] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const regions = [];
    const sceneObjects = async type => (await ctx.call("list-scene-objects", { types: [type] })).objects?.[type] ?? [];
    ctx.restore(async () => {
      for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await pause(1000);
      for ( const t of [mage, zombi] ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
    });
    const P = (gx, gy) => ({ x: gx * grid, y: gy * grid });
    const place = async (t, gx, gy) => { await ctx.call("move-token", { tokenId: t.id, ...P(gx, gy), elevation: 0 }); await pause(800); };
    const fire = await ctx.ensureItem(mage, PHB + "phbsplWallofFire", { system: { method: "atwill" } });
    const state = async id => ctx.engine("wallSide", { regionId: id });
    const hits = async (re) => (await ctx.engineLog()).filter(l => re.test(l));

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

    // 1. En L, un point hors de l'axe.
    await ctx.engineLog();
    const placed = await ctx.engine("wall", { tokenId: mage.id, itemId: fire, points: [P(11, 33), { x: 17 * grid, y: 33.4 * grid }, P(17, 35)] });
    if ( !ctx.expect(!!placed?.regionId, "Mur de feu : région posée") ) return;
    regions.push(placed.regionId);
    let s = null;
    for ( let i = 0; (i < 20) && !s?.burning; i++ ) { await pause(500); s = await state(placed.regionId); }
    const lines = s.shapes.filter(x => x.type === "line");
    ctx.expect((lines.length === 2) && lines.every(l => (Math.round(l.rotation) % 90) === 0) && (Math.round(lines[0].y) === 33 * grid),
      `sans diagonale : ${lines.map(l => `${Math.round(l.rotation)}° ${Math.round(l.length / grid * 5)} ft`).join(", ")}`);
    ctx.expect((s.walls.length === 2) && s.walls.every(w => (w.move === 0) && (w.sight === 20)), `opaque : ${s.walls.length} murs, déplacement ${s.walls.map(w => w.move).join("/")}, vue ${s.walls.map(w => w.sight).join("/")}`);
    ctx.expect(s.side === -1, `côté brûlant à l'opposé du Magicien (côté ${s.side})`);
    const south = (s.burning?.shapes ?? []).find(x => x.type === "polygon" && x.points.some((v, i) => (i % 2) && (v > 33 * grid)));
    ctx.expect(!!south && (Math.max(...south.points.filter((_, i) => i % 2)) === 35 * grid), `face brûlante au sud, 10 ft (${JSON.stringify(s.burning?.shapes?.map(x => x.points))})`);
    await pause(2500);
    const posed = await hits(/area placed: \d+ token\(s\) covered, \d+ affected/);
    ctx.expect(posed.some(l => /covered, 1 affected/.test(l)), `apparition : le Zombi, contre le mur, est dans la zone (${posed.at(-1) ?? "rien"})`);
    await pause(2500);
    let hp = await ctx.hp(zombi);
    ctx.expect(hp < 100, `apparition : le Zombi subit le feu (${100 - hp} PV)`);

    // 2. Traversée, une fois par tour ; fin de tour du côté brûlant.
    if ( !ctx.expect(await turnOf(zombi), "tour du Zombi") ) return;
    await ctx.engineLog();
    let before = await ctx.hp(zombi);
    await ctx.engine("move", { tokenId: zombi.id, point: { x: 14.5 * grid, y: 31.5 * grid } });
    await pause(4000);
    hp = await ctx.hp(zombi);
    const crossed = await hits(/Zombi \(enter\)/);
    ctx.expect(crossed.length && (hp < before), `traversée vers le nord : dégâts (${before - hp} PV, ${crossed.length} rejeu)`);
    before = hp;
    await ctx.engine("move", { tokenId: zombi.id, point: { x: 14.5 * grid, y: 33.5 * grid } });
    await pause(3000);
    hp = await ctx.hp(zombi);
    ctx.expect(hp === before, `traversée retour, même tour : rien (${before - hp} PV)`);
    const cards = (await ctx.call("list-chat-messages", { limit: 6, flagScope: MODULE_ID })).messages ?? [];
    const noSave = cards.map(m => m.flags?.[MODULE_ID]?.resolution).filter(r => r?.targets?.length)
      .flatMap(r => r.targets).filter(t => t.save?.auto === "noSave");
    ctx.expect(noSave.length > 0, `la traversée : sans sauvegarde, dégâts pleins (${noSave.map(t => t.damage?.applied).join(", ")})`);
    await ctx.nextTurn();
    await pause(4500);
    hp = await ctx.hp(zombi);
    const ended = await hits(/face brûlante|burning side.*Zombi \(turnEnd\)|Zombi \(turnEnd\)/);
    ctx.expect(ended.length && (hp < before), `fin de tour du côté brûlant : dégâts (${before - hp} PV)`);

    // 3. Retournée.
    s = await ctx.engine("wallSide", { regionId: placed.regionId, flip: true });
    const north = (s.burning?.shapes ?? []).some(x => x.type === "polygon" && x.points.some((v, i) => (i % 2) && (v < 33 * grid)));
    ctx.expect((s.side === 1) && north, `retournée : la face brûlante au nord (côté ${s.side})`);
    await ctx.call("delete-scene-object", { type: "Region", objectId: placed.regionId }).catch(() => {});
    await pause(1500);
    ctx.expect(!(await sceneObjects("Region")).some(r => [placed.regionId, s.burning?.id].includes(r.id ?? r._id)), "le mur retiré, sa face brûlante aussi");

    // 4. En anneau autour du Zombi, le Magicien dehors.
    if ( !ctx.expect(await turnOf(mage), "tour du Magicien (anneau)") ) return;
    await place(zombi, 14, 34);
    const centre = { x: 14.5 * grid, y: 34.5 * grid };
    const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === fire);
    // Le Manuel des joueurs pose un disque (« cylinder »), dnd5e un anneau (« ring ») ; la pose par coordonnées, un disque.
    const ring = Object.entries(item?.system?.activities ?? {}).find(([, a]) => ["cylinder", "ring"].includes(a.target?.template?.type))?.[0];
    if ( !ctx.expect(!!ring, "anneau : activité trouvée") ) return;
    const used = await ctx.use({ tokenId: mage.id, itemId: fire, activityId: ring, consume: false, area: { shape: "circle", ...centre, radius: 2 * grid } });
    if ( !ctx.expect(!!used.regionId, "anneau : région posée") ) return;
    regions.push(used.regionId);
    s = null;
    for ( let i = 0; (i < 20) && !s?.burning; i++ ) { await pause(500); s = await state(used.regionId); }
    const ringShape = s.shapes.find(x => x.type === "ring");
    ctx.expect((s.shapes.length === 1) && !!ringShape && (ringShape.innerWidth + ringShape.outerWidth < grid),
      `anneau fin : ${s.shapes.map(x => `${x.type} ${Math.round(x.radius)} (${Math.round(x.innerWidth ?? 0)} + ${Math.round(x.outerWidth ?? 0)})`).join(", ")}`);
    ctx.expect((s.walls.length === 24) && s.walls.every(w => w.sight === 20), `anneau : ${s.walls.length} murs sur le rayon`);
    ctx.expect((s.side === 1) && (s.burning?.shapes?.length === 1), `anneau : la face brûlante à l'intérieur (côté ${s.side})`);
    await pause(3000);
    if ( !ctx.expect(await turnOf(zombi), "tour du Zombi (anneau)") ) return;
    before = await ctx.hp(zombi);
    await ctx.nextTurn();
    await pause(4500);
    hp = await ctx.hp(zombi);
    ctx.expect(hp < before, `anneau : le Zombi finit son tour dedans — dégâts (${before - hp} PV)`);
  }
};
