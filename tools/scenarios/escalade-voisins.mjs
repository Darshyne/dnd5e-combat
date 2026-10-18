/**
 * §196 (lot 4 de l'escalade) : ce que le moteur publie pour les voisins, sur la scène « Escalade » de `dnd-6` (mur vertical en x = 700,
 * plafond à 20 ft sur la moitié ouest ; le Guerrier contre le mur, le Zombi juste au sud de lui).
 *  1. `api.climb.state` d'un grimpeur à 10 ft : en escalade, hauteur 10, ×2 sans vitesse d'escalade, peut lâcher.
 *  2. `api.climb.holds` : le long du mur oui, une case à l'ouest (loin du mur) non.
 *  3. L'A* : marcher loin du mur à 10 ft est refusé (aucun chemin) ; le long du mur, à la même hauteur, permis.
 *  4. Glissé loin du mur par le MJ : il lâche prise et tombe (« plus de mur »).
 *  5. `api.climb.toward` : le Zombi, au pied du mur sous le Guerrier perché à 15 ft (hors d'allonge), grimpe juste assez pour l'atteindre.
 * Remet modes, élévations, PV et états ; le filet du lanceur reprend le reste.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "Escalade",
  name: "escalade-voisins — api.climb (état, tenue au mur, rejoindre une cible), marche loin du mur refusée",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const home = await ctx.position(hero);
    const zhome = await ctx.position(zombi);
    const hp0 = await ctx.hp(hero);
    const zhp0 = await ctx.hp(zombi);
    const resetOne = async (token, at, hp) => {
      await ctx.call("update-scene-object", { type: "Token", objectId: token.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: token.id, x: at.x, y: at.y, elevation: 0 }).catch(() => {});
      await ctx.call("set-status", { tokenId: token.id, statusId: "prone", active: false }).catch(() => {});
      await ctx.setHp(token, hp).catch(() => {});
    };
    const reset = async () => {
      await resetOne(hero, home, hp0);
      await resetOne(zombi, zhome, zhp0);
      await pause(800);
    };
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    ctx.restore(reset);
    const state = token => ctx.engine("climbState", { tokenId: token.id });

    // 1. L'état publié.
    const up = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
    if ( !ctx.expect(up.done && (up.after.elevation === home.elevation + 10), `le Guerrier monte de 2 cases (${up.after.elevation} ft)`) ) return;
    await pause(1200);
    let s = await state(hero);
    ctx.expect(s.api?.climbing && !s.api.onCeiling && (s.api.height === 10) && (s.api.multiplier === 2) && s.api.canDrop && !s.api.native,
      `api.climb.state : en escalade ${s.api?.climbing}, hauteur ${s.api?.height}, ×${s.api?.multiplier}, peut lâcher ${s.api?.canDrop}`);

    // 2. Tenir au mur, case par case.
    const cell = up.after.cell;
    const west = { i: cell.i, j: cell.j - 1 };
    const south = { i: cell.i + 1, j: cell.j };
    const holdsWest = (await ctx.engine("climbHolds", { tokenId: hero.id, cell: west })).holds;
    const holdsSouth = (await ctx.engine("climbHolds", { tokenId: hero.id, cell: south })).holds;
    ctx.expect(!holdsWest && holdsSouth, `api.climb.holds : loin du mur ${holdsWest}, le long du mur ${holdsSouth}`);

    // 3. L'A* garde le grimpeur contre le mur.
    const away = await ctx.engine("move", { tokenId: hero.id, cell: west });
    ctx.expect((away.after.cell.j === cell.j) && (away.after.elevation === up.after.elevation),
      `marcher loin du mur à 10 ft : refusé (case (${away.after.cell.i}, ${away.after.cell.j}), ${away.after.elevation} ft)`);
    const along = await ctx.engine("move", { tokenId: hero.id, cell: south });
    ctx.expect((along.after.cell.i === south.i) && (along.after.elevation === up.after.elevation), `le long du mur : permis (${along.after.cell.i}, ${along.after.cell.j}), ${along.after.elevation} ft`);
    await ctx.engine("move", { tokenId: hero.id, cell });

    // 4. Glissé loin du mur par le MJ : il tombe.
    await pause(1200);
    const p = await ctx.position(hero);
    await ctx.call("move-token", { tokenId: hero.id, x: p.x - 100, y: p.y, elevation: p.elevation });
    let fell = null;
    for ( let i = 0; (i < 30) && !fell; i++ ) { await pause(500); const now = await state(hero); if ( !now.climbing && (now.position.elevation === home.elevation) ) fell = now; }
    ctx.expect(!!fell, `glissé loin du mur par le MJ : il lâche prise et tombe (élévation ${fell?.position.elevation ?? "—"}, mode ${fell?.position.movementAction ?? "—"})`);
    await reset();

    // 5. Rejoindre une cible perchée : le Zombi grimpe juste assez.
    const perch = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    if ( !ctx.expect(perch.done && (perch.after.elevation === home.elevation + 15), `le Guerrier se perche à ${perch.after.elevation} ft`) ) return;
    await pause(1200);
    const check = await ctx.engine("reachCheck", { tokenId: zombi.id, targetId: hero.id });
    ctx.expect(check.tooHigh === true, `le Zombi au pied du mur : hors d'allonge (écart ${check.gap}, vide ${check.vertical})`);
    const t = await ctx.engine("climbToward", { tokenId: zombi.id, targetId: hero.id, reachCells: 1 });
    ctx.expect(t.result.arrived && (t.result.climbed >= 1) && (t.after.gap <= 1) && t.climbing,
      `api.climb.toward : ${t.result.arrived ? "arrivé" : t.result.reason}, ${t.result.climbed} case(s) grimpée(s), écart ${t.before.gap} → ${t.after.gap}, à ${t.after.elevation} ft`);
    const again = await ctx.engine("climbToward", { tokenId: zombi.id, targetId: hero.id, reachCells: 1 });
    ctx.expect(again.result.arrived && (again.result.climbed === 0), `déjà à portée : rien de plus (${again.result.climbed} case)`);
  }
};
