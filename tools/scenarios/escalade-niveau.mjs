/**
 * §209 : se hisser d'un mur sur un rebord, et le chemin d'un grimpeur, sur Restored Keep (cour du rez-de-chaussée, mur sud de l'écurie,
 * dont le toit est une Surface à 20 ft ; un plancher d'étage à 20 ft couvre la cour, le grimpeur s'arrête donc pieds à 15 ft).
 *  1. Le Guerrier grimpe le mur depuis la cour : 3 cases, pieds à 15 ft.
 *  2. Le rebord du toit est à portée au nord (sol 20 ft, au niveau du dessus) ; « Se hisser » : il prend pied sur le toit, à 20 ft, au
 *     niveau du dessus, en mode marche, plus en escalade.
 *  3. Le chemin d'un grimpeur ne fait plus le tour du bâtiment par une porte : la case de l'écurie, de l'autre côté du mur, est hors d'atteinte.
 *  4. En combat : l'escalade de 3 cases a pris tout son déplacement (30 ft, ×2 sans vitesse d'escalade) ; se hisser est refusé.
 * Remet position, niveau, mode, drapeau d'escalade ; le filet du lanceur reprend le reste.
 */
const MODULE_ID = "dnd5e-combat";
const FIRST = "rcWKCTvbgKJhN2DV";
const COURTYARD = { x: 4340, y: 5180 };   // contre le mur sud de l'écurie
const STABLE = { i: 36, j: 31 };          // la case de l'écurie, au nord, sous son toit
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "keep",
  name: "escalade — se hisser sur le toit de l'écurie (niveau du dessus), chemin d'un grimpeur, coût en combat",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const home = await ctx.position(hero);
    const toCourtyard = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, ...COURTYARD, elevation: 0, levelId: FIRST });
      await pause(800);
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: home.elevation ?? 0, levelId: home.level }).catch(() => {});
    });
    const state = () => ctx.engine("climbState", { tokenId: hero.id });

    // 1. Grimper depuis la cour.
    await toCourtyard();
    let s = await state();
    if ( !ctx.expect(s.canClimb && (s.room?.max === 3), `au pied du mur de l'écurie : peut grimper, 3 cases au plus (${s.room?.max})`) ) return;
    let up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    ctx.expect(up.done && (up.after.elevation === 15), `grimpe 3 cases : pieds à ${up.after.elevation} ft`);

    // 2. Le rebord du toit, au nord ; se hisser.
    s = await state();
    const north = (s.api?.ledges ?? []).find(l => l.dir === "n");
    ctx.expect(!!north && (north.ground === 20) && (north.level !== FIRST), `rebord au nord : sol ${north?.ground} ft, niveau ${north?.level}`);
    const h = await ctx.engine("hoist", { tokenId: hero.id, dir: "n" });
    ctx.expect(h.done && (h.after.elevation === 20) && (h.after.level !== FIRST) && (h.after.cell.i === STABLE.i) && (h.after.cell.j === STABLE.j),
      `se hisse sur le toit : case (${h.after.cell.i}, ${h.after.cell.j}), ${h.after.elevation} ft, niveau ${h.after.level}`);
    ctx.expect(!h.climbing && (h.after.movementAction !== "climb"), `sur le toit, plus en escalade (mode ${h.after.movementAction})`);

    // 3. Le chemin d'un grimpeur ne contourne pas le bâtiment par une porte.
    await toCourtyard();
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    const plan = await ctx.engine("plan", { tokenId: hero.id, cell: STABLE });
    ctx.expect(!plan.found || ((plan.waypoints?.length ?? 0) <= 12), `vers la case de l'écurie en escalade : ${plan.found ? `${plan.waypoints.length} points` : "pas de chemin"} (avant : une cinquantaine, par une porte)`);

    // 4. En combat : plus de déplacement après 3 cases d'escalade, se hisser est refusé.
    await toCourtyard();
    await ctx.startCombat([hero]);
    await pause(1500);
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    const left = (await ctx.engine("movement", { tokenId: hero.id })).combat;
    const refused = await ctx.engine("hoist", { tokenId: hero.id, dir: "n" });
    ctx.expect(!refused.done && (refused.after.elevation === up.after.elevation), `en combat, déplacement dépensé ${left?.spent} sur ${left?.speed} : se hisser refusé (${refused.after.elevation} ft)`);
  }
};
