/**
 * Prendre un escalier d'un seul geste (SPEC §41.2), sur une scène à niveaux et escaliers (Restored Keep) : ce que fait un
 * clic sur l'escalier, ou « Monter / Descendre » de son menu.
 *  1. Sous un point de l'escalier, le moteur dit où il mène (`stairsAt` : ce que lisent le curseur et le menu).
 *  2. `takeStairs` : le token marche jusqu'à l'escalier et se retrouve sur l'autre niveau, SANS le dialogue « Change Level »
 *     du cœur, et la vue du MJ suit.
 *  3. Depuis l'escalier de l'autre niveau, le même point ramène au niveau de départ.
 * Remet la vue du MJ ; le filet de sécurité replace le token. Sans escalier à deux niveaux, non applicable.
 */
const NAMES = ["Paladin", "Guerrier"];

export default {
  name: "escalier direct — un clic sur l'escalier change de niveau, sans dialogue",

  async run(ctx) {
    const { levels } = await ctx.call("list-levels", {});
    if ( !(levels?.length > 1) ) { ctx.log("scène à un seul niveau : non applicable"); return; }
    const { tokens } = await ctx.scene();
    const name = NAMES.find(n => tokens.some(t => t.name === n));
    if ( !name ) { ctx.log(`aucun de ${NAMES.join(", ")} sur la scène : non applicable`); return; }
    const walker = await ctx.token(name);
    const levelName = id => levels.find(l => l.id === id)?.name ?? id;
    const size = await ctx.gridSize();
    const start = await ctx.engine("movement", { tokenId: walker.id });
    const home = start.position;
    if ( start.viewedLevel ) ctx.restore(() => ctx.engine("view", { levelId: start.viewedLevel }));

    const stairs = (await ctx.engine("stairs", { tokenId: walker.id })).filter(s => s.levels.includes(home.level) && (s.levels.length > 1) && s.cells.length);
    if ( !stairs.length ) { ctx.log(`aucun escalier au niveau « ${levelName(home.level)} » : non applicable`); return; }

    // Un escalier que le token atteint : on essaie les premiers jusqu'à ce que l'un d'eux mène à l'autre niveau.
    let taken = null;
    for ( const s of stairs.slice(0, 6) ) {
      const cell = s.cells[Math.floor(s.cells.length / 2)];
      const point = { x: (cell.j * size) + (size / 2), y: (cell.i * size) + (size / 2) };
      const here = await ctx.engine("stairsAt", { tokenId: walker.id, point });
      if ( !here.length ) continue;
      const dest = here[0];
      const known = new Set((await ctx.engine("windows")).map(w => w.id));
      const r = await ctx.engine("takeStairs", { tokenId: walker.id, point, levelId: dest.id }, { timeoutMs: 120000 });
      if ( r.after.level !== dest.id ) { ctx.log(`escalier « ${s.name ?? s.regionId} » : pas de chemin, on en essaie un autre`); continue; }
      taken = { s, point, dest, here, r, known };
      break;
    }
    if ( !ctx.expect(!!taken, "un escalier que le token peut prendre") ) return;
    const { point, dest, here, r, known } = taken;
    ctx.expect(here.every(d => d.id !== home.level) && ["up", "down", "level"].includes(dest.direction),
      `sous le point, l'escalier mène à : ${here.map(d => `${d.name} (${d.direction})`).join(", ")}`);
    ctx.expect(r.after.level === dest.id, `le token est passé de « ${levelName(home.level)} » à « ${levelName(dest.id)} »`);
    const dialogs = r.newWindows.filter(w => !known.has(w.id) && /Dialog/i.test(w.className ?? ""));
    ctx.expect(!dialogs.length, `aucun dialogue du cœur ne s'ouvre (${dialogs.map(w => w.title).join(", ") || "aucun"})`);
    ctx.expect(r.viewedLevel === dest.id, `la vue du MJ suit (${levelName(r.viewedLevel)})`);

    // 3. Retour par le même escalier.
    const back = await ctx.engine("stairsAt", { tokenId: walker.id, point });
    const homeward = back.find(d => d.id === home.level);
    if ( !ctx.expect(!!homeward, `depuis l'autre niveau, le même point ramène à « ${levelName(home.level)} » (${back.map(d => d.name).join(", ") || "rien"})`) ) return;
    const r2 = await ctx.engine("takeStairs", { tokenId: walker.id, point, levelId: home.level }, { timeoutMs: 120000 });
    ctx.expect(r2.after.level === home.level, `retour : le token est revenu sur « ${levelName(home.level)} »`);
    ctx.expect(r2.viewedLevel === home.level, "retour : la vue du MJ suit");
  }
};
