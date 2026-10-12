/**
 * Murs posés par points (SPEC §162), monde `dnd-6`, arène, coin libre au nord-ouest. Le Magicien (sorts prêtés du Manuel des joueurs, à
 * volonté) pose les murs par `api.mcp.wall` — le chemin de la visée par points de l'interface, les clics remplacés par les points :
 *  - Mur de force, trois points : une région de deux segments « line », deux murs qui arrêtent le déplacement mais pas la vue ; la
 *    concentration retirée, région et murs disparaissent ;
 *  - Mur de feu, trois points sur 80 ft : la ligne coupée à 60 ft (sa longueur) ;
 *  - Mur prismatique : des murs qui arrêtent la vue, pas le déplacement ;
 *  - Cage de force (cube, pas une ligne) : les murs sur son pourtour.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "murs posés par points — Mur de force, Mur de feu, Mur prismatique, Cage de force",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const grid = await ctx.gridSize();
    const effects0 = new Set((await ctx.effects(mage)).map(e => e._id ?? e.id));
    const clear = async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => !effects0.has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: mage.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
      await pause(1500);
    };
    const regions = [];
    ctx.restore(async () => {
      await clear();
      for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const w of await zoneWalls() ) await ctx.call("delete-scene-object", { type: "Wall", objectId: w.id ?? w._id }).catch(() => {});
    });
    const allWalls = async () => {
      const r = await ctx.call("list-scene-objects", { types: ["Wall"] });
      return r.objects?.Wall ?? [];
    };
    async function zoneWalls(regionId=null) {
      const walls = await allWalls();
      const full = await Promise.all(walls.map(w => ctx.call("get-scene-object", { type: "Wall", objectId: w.id ?? w._id }).then(r => r.data).catch(() => null)));
      return full.filter(w => w?.flags?.[MODULE_ID]?.zone && (!regionId || (w.flags[MODULE_ID].zone === regionId)));
    }
    const lend = id => ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
    const P = (gx, gy) => ({ x: gx * grid, y: gy * grid });
    const shapesOf = async id => (await ctx.call("get-scene-object", { type: "Region", objectId: id })).data?.shapes ?? [];
    const exists = async id => !!(await ctx.call("get-scene-object", { type: "Region", objectId: id }).catch(() => null));
    const W = { move: 20, sight: 20, none: 0 };   // CONST.WALL_MOVEMENT_TYPES.NORMAL, EDGE_SENSE_TYPES.NORMAL : 20 ; NONE : 0

    // Mur de force : trois points, deux panneaux.
    const force = await lend("phbsplWallofForc");
    const placed = await ctx.engine("wall", { tokenId: mage.id, itemId: force, activityId: "O3uhE0OLzsAhHoAg", points: [P(15, 30), P(15, 34), P(18, 34)] });
    await pause(2500);
    if ( ctx.expect(!!placed?.regionId, `Mur de force : région posée (${placed?.shapes?.join(", ") ?? "rien"})`) ) {
      regions.push(placed.regionId);
      const shapes = await shapesOf(placed.regionId);
      ctx.expect((shapes.length === 2) && shapes.every(s => s.type === "line"), `Mur de force : deux segments « line » (${shapes.map(s => `${s.type} ${Math.round(s.length / grid * 5)} ft`).join(", ")})`);
      const walls = await zoneWalls(placed.regionId);
      ctx.expect((walls.length === 2) && walls.every(w => (w.move === W.move) && (w.sight === W.none)),
        `Mur de force : ${walls.length} murs, déplacement ${walls.map(w => w.move).join("/")}, vue ${walls.map(w => w.sight).join("/")}`);
      await clear();
      ctx.expect(!(await exists(placed.regionId)) && !(await zoneWalls(placed.regionId)).length, "Mur de force : la concentration retirée, la région et ses murs disparaissent");
    }

    // Mur de feu : 80 ft dessinés, 60 ft posés.
    const fire = await lend("phbsplWallofFire");
    const fp = await ctx.engine("wall", { tokenId: mage.id, itemId: fire, points: [P(10, 28), P(18, 28), P(18, 36)] });
    await pause(2500);
    if ( ctx.expect(!!fp?.regionId, "Mur de feu : région posée") ) {
      regions.push(fp.regionId);
      const total = (await shapesOf(fp.regionId)).reduce((sum, s) => sum + (s.length ?? 0), 0) / grid * 5;
      ctx.expect(Math.abs(total - 60) < 1, `Mur de feu : ${Math.round(total)} ft posés sur 80 dessinés (sa longueur : 60)`);
    }
    await clear();

    // Mur prismatique : la vue arrêtée, pas le déplacement.
    const prism = await lend("phbsplPrismaticW");
    const pp = await ctx.engine("wall", { tokenId: mage.id, itemId: prism, activityId: "5f0JerdDSOQQXiTe", points: [P(12, 30), P(12, 34)] });
    await pause(2500);
    if ( ctx.expect(!!pp?.regionId, "Mur prismatique : région posée") ) {
      regions.push(pp.regionId);
      const walls = await zoneWalls(pp.regionId);
      ctx.expect(walls.length && walls.every(w => (w.move === W.none) && (w.sight === W.sight)), `Mur prismatique : ${walls.length} mur(s), déplacement ${walls.map(w => w.move).join("/")}, vue ${walls.map(w => w.sight).join("/")}`);
    }

    // Cage de force : un cube, les murs sur son pourtour.
    const cage = await lend("phbsplForcecage0");
    const used = await ctx.use({ tokenId: mage.id, itemId: cage, activityId: "gacP7LGiwvQBdnfU", consume: false,
      area: { shape: "rectangle", x: 20 * grid, y: 28 * grid, width: 4 * grid, height: 4 * grid } });
    await pause(2500);
    if ( ctx.expect(!!used.regionId, "Cage de force : région posée") ) {
      regions.push(used.regionId);
      const walls = await zoneWalls(used.regionId);
      ctx.expect(walls.length === 4, `Cage de force : ${walls.length} murs sur le pourtour`);
    }
  }
};
