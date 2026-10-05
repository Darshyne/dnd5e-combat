/**
 * §99 : une marche du moteur s'arrête en route — un clic ailleurs (`stopWalking`, par `stopAfterMs` de `api.mcp.move`) ou la
 * pause du jeu (`pauseAfterMs`). Le Zombi marche huit cases vers la droite, hors combat :
 *  - sans interruption, il arrive ;
 *  - arrêté en route, il s'arrête sur une case (coin aligné sur la grille), entre le départ et l'arrivée ;
 *  - mis en pause en route, de même, et le jeu est sorti de pause à la fin.
 * Remet le Zombi à sa place entre chaque marche.
 */
const CELLS = 8;

export default {
  name: "marche interrompue — clic ailleurs, pause",
  async run(ctx) {
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const start = await ctx.position(zombi);
    const home = () => ctx.call("move-token", { tokenId: zombi.id, x: start.x, y: start.y });
    ctx.restore(home);
    const goal = { x: start.x + (CELLS * grid), y: start.y };
    const point = { x: goal.x + (grid / 2), y: goal.y + (grid / 2) };
    const onGrid = p => (Math.round(p.x - start.x) % grid === 0) && (Math.round(p.y - start.y) % grid === 0);
    // Entre les deux : ni au départ ni à l'arrivée (le chemin de l'A* peut s'écarter de la ligne pour éviter un token).
    const between = p => (p.x > start.x) && (p.x < goal.x);

    const full = await ctx.engine("move", { tokenId: zombi.id, point });
    ctx.expect((full.after.x === goal.x) && (full.after.y === goal.y), `marche complète : arrivé en ${full.after.x}, ${full.after.y} (${full.elapsedMs} ms)`);
    await home();

    const stopped = await ctx.engine("move", { tokenId: zombi.id, point, stopAfterMs: Math.round(full.elapsedMs / 3) });
    ctx.expect(between(stopped.after) && onGrid(stopped.after),
      `arrêtée en route : ${(stopped.after.x - start.x) / grid} case(s) sur ${CELLS}, sur la grille (${stopped.elapsedMs} ms)`);
    await home();

    const paused = await ctx.engine("move", { tokenId: zombi.id, point, pauseAfterMs: Math.round(full.elapsedMs / 3) });
    ctx.expect(between(paused.after) && onGrid(paused.after),
      `pause en route : ${(paused.after.x - start.x) / grid} case(s) sur ${CELLS}, sur la grille (${paused.elapsedMs} ms)`);
  }
};
