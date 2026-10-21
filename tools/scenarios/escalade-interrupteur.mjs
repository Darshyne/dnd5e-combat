/**
 * §224 : l'interrupteur du système d'escalade et de chute, sur la scène « Escalade » de `dnd-6` (le Guerrier contre le mur, le Zombi
 * juste au sud, contre le mur aussi).
 *  1. Système allumé : le Guerrier grimpe de 2 cases (10 ft, mode `climb`) ; le menu propose l'escalade.
 *  2. Coupé (réglage `climbSystem`) : le bouton du MJ est éteint ; personne ne bouge — le Guerrier reste au mur à 10 ft, sans chute ;
 *     le menu ne propose plus rien d'escalade, ni au Guerrier ni au Zombi.
 *  3. Coupé : le Zombi (marche, sans vol) monte sur place à 15 ft, comme par le champ d'élévation du HUD — gardé, sans « En chute » ;
 *     il avance d'une case à cette hauteur (glisser) puis d'une autre au clic (A* du moteur) — toujours à 15 ft.
 *  4. Rallumé : personne ne bouge (Zombi à 15 ft, Guerrier au mur) ; le menu propose de nouveau l'escalade ; le déplacement suivant du
 *     Zombi est aligné sur le sol (le MJ n'est pas retenu : posé au sol, sans chute).
 * Remet le réglage, les modes, les élévations, les états ; le filet du lanceur reprend le reste.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "Escalade",
  name: "escalade — l'interrupteur du MJ : hauteur libre, rien ne tombe, puis le sol de nouveau",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const heroHome = await ctx.position(hero);
    const zombiHome = await ctx.position(zombi);
    const before = await ctx.engine("setting", { key: "climbSystem" });
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    const setSystem = async on => { await ctx.engine("setting", { key: "climbSystem", value: on }); await pause(1200); };
    const reset = async () => {
      await setSystem(true);
      for ( const [t, home] of [[hero, heroHome], [zombi, zombiHome]] ) {
        await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
        await ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation ?? 0 }).catch(() => {});
        for ( const statusId of ["prone", "falling"] ) await ctx.call("set-status", { tokenId: t.id, statusId, active: false }).catch(() => {});
      }
      await pause(600);
    };
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    ctx.restore(() => ctx.engine("setting", { key: "climbSystem", value: before?.before ?? true }));
    ctx.restore(reset);
    const state = t => ctx.engine("climbState", { tokenId: t.id });
    const menu = t => ctx.engine("controls", { tokenId: t.id });

    // 1. Allumé : grimper.
    await setSystem(true);
    let m = await menu(hero);
    ctx.expect(m.climbSystem && (m.climbEntries?.length > 0), `allumé : le menu du Guerrier propose l'escalade (${(m.climbEntries ?? []).join(", ") || "rien"})`);
    if ( m.climb ) ctx.expect(m.climb.present && m.climb.active, `bouton « Escalade et chutes » dans la barre du MJ, allumé (${JSON.stringify(m.climb)})`);
    const up = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
    if ( !ctx.expect(up.done && (up.after.elevation === (heroHome.elevation ?? 0) + 10) && (up.after.movementAction === "climb"),
      `grimpe de 2 cases : élévation ${up.after.elevation}, mode ${up.after.movementAction}`) ) return;
    await pause(1200);

    // 2. Coupé : rien ne bouge, plus d'escalade au menu.
    await setSystem(false);
    m = await menu(hero);
    ctx.expect(m.climbSystem === false, "coupé : `api.climb.enabled()` faux");
    ctx.expect(m.climb.present && !m.climb.active, `bouton présent, éteint (${JSON.stringify(m.climb)})`);
    let s = await state(hero);
    ctx.expect((s.position.elevation === up.after.elevation) && (s.position.movementAction === "climb") && !s.falling,
      `le Guerrier reste au mur : ${s.position.elevation} ft, mode ${s.position.movementAction}, ${s.falling ? "En chute" : "pas de chute"}`);
    ctx.expect((m.climbEntries?.length === 0) && (s.api?.enabled === false) && !s.api?.canClimb && !s.api?.canDrop,
      `aucune entrée d'escalade pour le Guerrier (${(m.climbEntries ?? []).join(", ") || "aucune"}), api.climb.state : enabled ${s.api?.enabled}`);
    const mz = await menu(zombi);
    ctx.expect(mz.climbEntries?.length === 0, `aucune entrée d'escalade pour le Zombi non plus (${(mz.climbEntries ?? []).join(", ") || "aucune"})`);

    // 3. Coupé : hauteur libre pour le Zombi, en marche.
    const raise = await ctx.engine("rawMove", { tokenId: zombi.id, elevation: 15, action: "walk" });
    ctx.expect((raise.after.elevation === 15) && (raise.after.movementAction === "walk") && !raise.falling,
      `le Zombi monte sur place à 15 ft en marche : ${raise.after.elevation} ft, mode ${raise.after.movementAction}, ${raise.falling ? "En chute !" : "sans chute"}`);
    const zc = raise.after.cell;
    const away = { i: zc.i, j: zc.j - 1 };   // à l'ouest : le mur est à l'est
    const drag = await ctx.engine("rawMove", { tokenId: zombi.id, cell: away });
    ctx.expect((drag.after.cell.j === away.j) && (drag.after.elevation === 15) && !drag.falling,
      `glissé d'une case à cette hauteur : case (${drag.after.cell.i}, ${drag.after.cell.j}), ${drag.after.elevation} ft, ${drag.falling ? "En chute !" : "sans chute"}`);
    const click = await ctx.engine("move", { tokenId: zombi.id, cell: { i: away.i, j: away.j - 1 } });
    await pause(1200);
    const zs = await state(zombi);
    ctx.expect((click.after.cell.j === away.j - 1) && (click.after.elevation === 15) && !zs.falling,
      `au clic (A* du moteur), une case de plus : ${click.after.elevation} ft, case (${click.after.cell.i}, ${click.after.cell.j}), ${zs.falling ? "En chute !" : "sans chute"}`);

    // 4. Rallumé : personne ne bouge ; l'escalade revient ; le déplacement suivant suit le sol.
    await setSystem(true);
    const z1 = await state(zombi);
    s = await state(hero);
    ctx.expect((z1.position.elevation === 15) && (s.position.elevation === up.after.elevation) && (s.position.movementAction === "climb"),
      `rallumé, personne ne bouge : Zombi à ${z1.position.elevation} ft, Guerrier au mur à ${s.position.elevation} ft (${s.position.movementAction})`);
    m = await menu(hero);
    ctx.expect(m.climbEntries?.length > 0, `le menu du Guerrier propose de nouveau l'escalade (${(m.climbEntries ?? []).join(", ")})`);
    const next = await ctx.engine("rawMove", { tokenId: zombi.id, cell: drag.after.cell, settleMs: 2500 });
    const ground = (zombiHome.elevation ?? 0);
    ctx.expect((next.after.elevation === ground) || next.falling,
      `déplacement suivant aligné : ${next.after.elevation} ft (sol ${ground})${next.falling ? ", En chute" : ""}`);
  }
};
