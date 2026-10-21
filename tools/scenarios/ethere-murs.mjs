/**
 * §225, lot 3 : se déplacer dans le plan Éthéré. Arène, une boîte de quatre murs autour d'une case à trois cases du Guerrier.
 *  1. Matériel : l'A* du moteur ne trouve pas de chemin vers la case enfermée ; un déplacement du cœur (comme un glisser) y est arrêté.
 *  2. Éthéré : l'action de déplacement passe à « ethereal » ; l'A* y va tout droit, le déplacement du cœur aussi.
 *  3. Murs de force : les quatre murs de la boîte marqués `ethereal` arrêtent l'A* et le déplacement du cœur, même Éthéré.
 *  4. En l'air : le Guerrier Éthéré monte à 15 ft sans tomber (ni « En chute »), et redescend.
 *  5. Retour : l'état retiré, il reprend son action de déplacement d'avant.
 * Remet murs, position, état.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "plan Éthéré — les murs se traversent, sauf les murs de force ; pas de chute",

  async run(ctx) {
    const fighter = await ctx.token("Guerrier").catch(() => null);
    if ( !fighter ) { ctx.log("Guerrier absent : non applicable"); return; }
    const grid = await ctx.gridSize();
    const home = await ctx.position(fighter);
    const action0 = (await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id })).data?.movementAction ?? null;
    const box = { x: home.x + (3 * grid), y: home.y };
    const [x0, y0, x1, y1] = [box.x, box.y, box.x + grid, box.y + grid];
    const created = await ctx.call("create-walls", { walls: [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]].map(c => ({ c })) });
    const wallIds = (created?.walls ?? []).map(w => w.id ?? w._id).filter(Boolean);
    if ( wallIds.length !== 4 ) throw new Error(`boîte non créée (${JSON.stringify(created).slice(0, 200)})`);
    ctx.restore(async () => {
      await ctx.call("set-status", { tokenId: fighter.id, statusId: "ethereal", active: false }).catch(() => {});
      await pause(800);
      for ( const id of wallIds ) await ctx.call("delete-scene-object", { type: "Wall", objectId: id }).catch(() => {});
      await ctx.call("move-token", { tokenId: fighter.id, ...home }).catch(() => {});
    });
    await pause(800);
    const cell = { i: Math.round(box.y / grid), j: Math.round(box.x / grid) };   // carré : i la ligne, j la colonne
    const target = { x: box.x + (grid / 2), y: box.y + (grid / 2) };
    const inBox = p => (p.x === box.x) && (p.y === box.y);
    const coreMove = () => ctx.engine("rawMove", { tokenId: fighter.id, cell });
    const back = () => ctx.call("move-token", { tokenId: fighter.id, ...home });

    // 1. Matériel.
    const material = await ctx.engine("plan", { tokenId: fighter.id, point: target });
    ctx.expect(!material.found || !material.arrives, `matériel : pas de chemin vers la case enfermée (${JSON.stringify({ found: material.found, arrives: material.arrives })})`);
    if ( cell ) {
      const m = await coreMove();
      ctx.expect(!inBox(m.after), `matériel : le déplacement du cœur est arrêté par les murs (${m.after.x}, ${m.after.y})`);
      await back();
    }

    // 2. Éthéré.
    await ctx.call("set-status", { tokenId: fighter.id, statusId: "ethereal", active: true });
    await pause(1500);
    const mode = (await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id })).data?.movementAction;
    ctx.expect(mode === "ethereal", `l'action de déplacement passe à « ethereal » (${mode})`);
    const through = await ctx.engine("plan", { tokenId: fighter.id, point: target });
    ctx.expect(through.found && through.arrives, `Éthéré : l'A* traverse les murs (${JSON.stringify({ found: through.found, arrives: through.arrives, steps: through.waypoints?.length })})`);
    if ( cell ) {
      const e = await coreMove();
      ctx.expect(inBox(e.after), `Éthéré : le déplacement du cœur traverse les murs (${e.after.x}, ${e.after.y})`);
      await back();
      await pause(500);
    }

    // 3. Un mur de force.
    // Les quatre : un seul ne suffit pas, l'Éthéré entrerait par un autre côté.
    for ( const id of wallIds ) await ctx.call("update-scene-object", { type: "Wall", objectId: id, data: { [`flags.${MODULE_ID}.ethereal`]: true } });
    await pause(800);
    ctx.log(`murs de force vus : ${JSON.stringify(await ctx.engine("etherealWalls", { tokenId: fighter.id, point: target }))}`);
    const force = await ctx.engine("plan", { tokenId: fighter.id, point: target });
    ctx.expect(!force.found || !force.arrives, `mur de force : l'A* ne passe plus (${JSON.stringify({ found: force.found, arrives: force.arrives })})`);
    if ( cell ) {
      const f = await coreMove();
      ctx.expect(!inBox(f.after), `mur de force : le déplacement du cœur est refusé (${f.after.x}, ${f.after.y})`);
    }
    for ( const id of wallIds ) await ctx.call("update-scene-object", { type: "Wall", objectId: id, data: { [`flags.${MODULE_ID}.-=ethereal`]: null } });
    await back();
    await pause(500);

    // 4. En l'air, sans chute.
    const up = await ctx.engine("rawMove", { tokenId: fighter.id, elevation: 15 });
    ctx.expect((up.after.elevation === 15) && !up.falling, `Éthéré : monte à 15 ft et y reste, sans « En chute » (${up.after.elevation} ft, chute : ${up.falling})`);
    const down = await ctx.engine("rawMove", { tokenId: fighter.id, elevation: 0 });
    ctx.expect(down.after.elevation === 0, `redescend au sol (${down.after.elevation} ft)`);

    // 5. Retour.
    await ctx.call("set-status", { tokenId: fighter.id, statusId: "ethereal", active: false });
    await pause(1500);
    const after = (await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id })).data?.movementAction;
    ctx.expect((after !== "ethereal") && (!action0 || (after === action0)), `l'état retiré, il reprend son action d'avant (${after}, avant : ${action0})`);
  }
};
