/**
 * §209, §216 : se hisser d'un mur sur un rebord, s'agripper au bord pour redescendre, et le chemin d'un grimpeur, sur Restored Keep.
 * Repères relus sur les images de la carte (marge de scène 1260 × 1540) : la cour herbeuse à l'est de l'écurie est à ciel ouvert ; le
 * toit de chaume de l'écurie est une Surface à 20 ft (Second Floor) ; au sud de l'écurie, un couloir couvert par le toit de pierre de
 * l'étage (à 20 ft).
 *  1. Dans la cour, contre le mur est de l'écurie, le Guerrier grimpe 3 cases (pieds à 15 ft) : le toit de chaume est à portée à
 *     l'ouest ; « Se hisser » : il prend pied sur le toit, à 20 ft, au niveau du dessus, plus en escalade.
 *  2. Du toit, « S'agripper au bord » vers l'est : il repasse le bord et se retrouve accroché au mur côté cour, pieds à 15 ft, en escalade.
 *  3. Dans le couloir couvert, contre le mur sud de l'écurie : grimper bute à 15 ft (le toit de pierre) et aucun rebord n'est proposé —
 *     se hisser sur le chaume traverserait son propre plafond (ce que la 0.250.0 laissait faire).
 *  4. Le chemin d'un grimpeur ne fait plus le tour du bâtiment par une porte.
 *  5. En combat : l'escalade de 3 cases a pris tout son déplacement (30 ft, ×2 sans vitesse d'escalade) ; se hisser est refusé.
 * Règles d'escalade 2024 le temps du test. Remet position, niveau, mode, drapeau d'escalade.
 */
const MODULE_ID = "dnd5e-combat";
const FIRST = "rcWKCTvbgKJhN2DV";
const COURTYARD = { x: 4760, y: 4760 };   // la cour, contre le mur est de l'écurie
const ROOF = { i: 34, j: 33 };            // la case du toit de chaume, à l'ouest
const CORRIDOR = { x: 4340, y: 5180 };    // le couloir couvert, contre le mur sud de l'écurie
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "keep",
  name: "escalade — se hisser sur un toit, s'agripper au bord, pas à travers un plafond, chemin et coût en combat",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const home = await ctx.position(hero);
    const place = async at => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, ...at, elevation: 0, levelId: FIRST });
      await pause(800);
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: home.elevation ?? 0, levelId: home.level }).catch(() => {});
    });
    // Règles 2024 le temps du test (en « maison », un test de DD 15 raté fait tomber le grimpeur : le résultat dépendrait du dé).
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    const state = () => ctx.engine("climbState", { tokenId: hero.id });

    // 1. Grimper dans la cour, se hisser sur le toit de chaume.
    await place(COURTYARD);
    let up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    if ( !ctx.expect(up.done && (up.after.elevation === 15), `dans la cour, grimpe 3 cases : pieds à ${up.after.elevation} ft`) ) return;
    let s = await state();
    const west = (s.api?.ledges ?? []).find(l => l.dir === "w");
    ctx.expect(!!west && (west.ground === 20) && (west.level !== FIRST), `toit de chaume à l'ouest : sol ${west?.ground} ft, niveau ${west?.level}`);
    const h = await ctx.engine("hoist", { tokenId: hero.id, dir: "w" });
    ctx.expect(h.done && (h.after.elevation === 20) && (h.after.level !== FIRST) && (h.after.cell.i === ROOF.i) && (h.after.cell.j === ROOF.j),
      `se hisse sur le toit : case (${h.after.cell.i}, ${h.after.cell.j}), ${h.after.elevation} ft, niveau ${h.after.level}`);
    ctx.expect(!h.climbing && (h.after.movementAction !== "climb"), `sur le toit, plus en escalade (mode ${h.after.movementAction})`);

    // 2. Du toit, s'agripper au bord vers l'est pour redescendre côté cour.
    const g = await ctx.engine("grab", { tokenId: hero.id, dir: "e" });
    ctx.expect(g.edges.some(e => e.dir === "e") && !g.edges.some(e => e.dir === "w"),
      `bords proposés depuis le toit : ${g.edges.map(e => `${e.dir} (${e.elevation} ft)`).join(", ") || "aucun"} (l'est, côté cour ; pas l'ouest, où le toit continue)`);
    ctx.expect(g.done && g.climbing && (g.after.elevation === 15) && (g.after.level === FIRST) && (g.after.x === COURTYARD.x) && (g.after.y === COURTYARD.y),
      `s'agrippe au bord : accroché au mur côté cour, ${g.after.elevation} ft, niveau ${g.after.level}, en escalade (${g.climbing})`);

    // 3. Dans le couloir couvert : grimper bute à 15 ft, et pas de rebord à travers son plafond.
    await place(CORRIDOR);
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    s = await state();
    ctx.expect(up.done && (up.after.elevation === 15), `dans le couloir couvert, grimpe jusqu'au plafond : pieds à ${up.after.elevation} ft`);
    ctx.expect(!(s.api?.ledges ?? []).length, `pas de rebord à travers le toit de pierre (${(s.api?.ledges ?? []).map(l => l.dir).join(", ") || "aucun"})`);

    // 4. Le chemin d'un grimpeur ne contourne pas le bâtiment par une porte.
    await place(COURTYARD);
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    const plan = await ctx.engine("plan", { tokenId: hero.id, cell: ROOF });
    ctx.expect(!plan.found || ((plan.waypoints?.length ?? 0) <= 12), `vers la case du toit en escalade : ${plan.found ? `${plan.waypoints.length} points` : "pas de chemin"} (avant : une cinquantaine, par une porte)`);

    // 5. En combat : plus de déplacement après 3 cases d'escalade, se hisser est refusé.
    await place(COURTYARD);
    await ctx.startCombat([hero]);
    await pause(1500);
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    // Sans cette vérification, la suite passait à vide : un grimpeur resté au sol « ne se hisse pas » non plus.
    if ( !ctx.expect(up.done && (up.after.elevation === 15), `en combat, grimpe 3 cases : pieds à ${up.after.elevation} ft`) ) return;
    const left = (await ctx.engine("movement", { tokenId: hero.id })).combat;
    const refused = await ctx.engine("hoist", { tokenId: hero.id, dir: "w" });
    ctx.expect(!refused.done && (refused.after.elevation === up.after.elevation), `en combat, déplacement dépensé ${left?.spent} sur ${left?.speed} : se hisser refusé (${refused.after.elevation} ft)`);
  }
};
