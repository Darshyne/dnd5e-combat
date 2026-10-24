/**
 * §239 (issue #14) : une case coupée par un mur qui ne suit pas la grille (grotte) ne donne plus d'abri contre tout le monde.
 * Arène : un mur en diagonale coupe le coin de la case du Zombi opposé à l'Ensorceleur — le coin est dans la « roche », derrière
 * le Zombi. Avant le §239, la ligne vers ce coin était toujours bloquée : demi-abri. Attendu : aucun abri. Puis un vrai mur entre
 * les deux : l'abri reste (total). Remet les murs.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "abri — case coupée par un mur de grotte : pas d'abri derrière soi",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const g = await ctx.gridSize();
    const a = await ctx.position(sorc);
    const z = await ctx.position(zombi);
    const sx = (z.x >= a.x) ? 1 : -1;
    const sy = (z.y >= a.y) ? 1 : -1;
    if ( Math.max(Math.abs(z.x - a.x), Math.abs(z.y - a.y)) < 2 * g ) { ctx.log("Ensorceleur trop près du Zombi : non applicable"); return; }

    // Le coin de la case du Zombi du côté opposé à l'Ensorceleur, et une coupe à 40 % de case sur chacun des deux bords.
    const c = { x: z.x + (sx > 0 ? g : 0), y: z.y + (sy > 0 ? g : 0) };
    const p = { x: c.x - (sx * 0.4 * g), y: c.y };
    const q = { x: c.x, y: c.y - (sy * 0.4 * g) };
    const cut = [p.x + (p.x - q.x), p.y + (p.y - q.y), q.x + (q.x - p.x), q.y + (q.y - p.y)].map(Math.round);
    // Un vrai mur, au milieu entre les deux, perpendiculaire à la ligne qui les joint, long de six cases.
    const m = { x: (a.x + z.x + g) / 2, y: (a.y + z.y + g) / 2 };
    const len = Math.hypot(z.x - a.x, z.y - a.y);
    const n = { x: -(z.y - a.y) / len, y: (z.x - a.x) / len };
    const between = [m.x - (n.x * 3 * g), m.y - (n.y * 3 * g), m.x + (n.x * 3 * g), m.y + (n.y * 3 * g)].map(Math.round);

    const wallIds = [];
    const addWall = async coords => {
      const created = await ctx.call("create-walls", { walls: [{ c: coords }] });
      const id = (created?.walls ?? []).map(w => w.id ?? w._id).find(Boolean);
      if ( !id ) throw new Error(`mur non créé (${JSON.stringify(created).slice(0, 200)})`);
      wallIds.push(id);
      await pause(800);
      return id;
    };
    ctx.restore(async () => { for ( const id of wallIds ) await ctx.call("delete-scene-object", { type: "Wall", objectId: id }).catch(() => {}); });

    const open = await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id });
    const label = c => c ? `${c.degree}${c.byCreature ? " (créature)" : " (mur)"}` : "aucun abri";
    ctx.log(`sans mur : ${label(open)}`);

    await addWall(cut);
    const cave = await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id });
    ctx.log(`coin de la case coupé derrière le Zombi (${cut.join(", ")}) : ${label(cave)}`);
    // Sans le §239, une ligne bloquée par le mur : demi-abri « (mur) », même quand une créature en donnait déjà un.
    ctx.expect(label(cave) === label(open), `le coin dans la roche ne change rien (${label(open)} → ${label(cave)})`);

    const id = await addWall(between);
    const walled = await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id });
    ctx.log(`mur entre les deux (${between.join(", ")}) : ${walled?.degree ?? "aucun abri"}`);
    ctx.expect(walled?.degree === "total", "un vrai mur entre les deux : abri total");
    await ctx.call("delete-scene-object", { type: "Wall", objectId: id });
    wallIds.splice(wallIds.indexOf(id), 1);
  }
};
