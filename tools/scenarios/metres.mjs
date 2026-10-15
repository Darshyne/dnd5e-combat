/**
 * Une scène en mètres (grille de 1,5 m, scène « metres » de `dnd-6`) : le moteur convertit les distances des fiches, écrites en
 * pieds (SPEC §5.7). Le Magicien et le Barde :
 *  1. en combat, la Vitesse et le plafond de déplacement du tour sont en mètres (30 ft → 9 m), et une marche de quatre cases en
 *     dépense 6 ;
 *  2. la dague lancée (6 m / 18 m) : pas de Désavantage à trois cases (4,5 m), Désavantage de portée longue à six (9 m) ;
 *  3. le Barde rendu Hostile le temps du test, au contact du Magicien : l'attaque à distance a le Désavantage du corps à corps,
 *     et quitter son allonge (1,5 m) est une menace d'attaque d'opportunité, rester au contact non.
 * Remet positions, disposition du Barde et combat.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const close = (a, b) => Math.abs(a - b) < 1e-6;

export default {
  name: "metres — une scène à 1,5 m par case : Vitesse, portée, allonge",
  scene: "metres",

  async run(ctx) {
    const mage = await ctx.token("Magicien").catch(() => null);
    const bard = await ctx.token("Barde").catch(() => null);
    if ( !mage || !bard ) { ctx.log("Magicien ou Barde absent : non applicable"); return; }
    const grid = await ctx.gridSize();
    const at = { x: 2900, y: 1900 };
    const center = (dx, dy) => ({ x: at.x + (dx * grid) + (grid / 2), y: at.y + (dy * grid) + (grid / 2) });
    await ctx.stage({ tokens: { Magicien: [at.x, at.y], Barde: [at.x + (6 * grid), at.y] } });
    await pause(500);
    const dagger = await ctx.itemId(mage.id, "dagger");

    // 1. Le déplacement, en mètres.
    await ctx.startCombat([mage, bard]);
    const c = await ctx.combat();
    for ( const [t, value] of [[mage, 20], [bard, 10]] ) {
      const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
      if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
    }
    if ( ((await ctx.combat()).combatants ?? []).find(x => x.isCurrent || x.current)?.name !== mage.name ) await ctx.nextTurn();
    await pause(1000);
    const start = await ctx.engine("movement", { tokenId: mage.id });
    const speed = start.combat?.speed;
    ctx.expect(start.combat?.units === "m", `unité du déplacement : ${start.combat?.units}`);
    ctx.expect(Number.isFinite(speed) && close(speed % 1.5, 0) && (speed < 20),
      `Vitesse convertie en mètres (multiple de 1,5) : ${speed}`);
    ctx.expect(close(start.cap, speed), `plafond du tour = la Vitesse : ${start.cap} m`);
    await ctx.engine("move", { tokenId: mage.id, point: center(-4, 0) });
    await pause(1500);
    const walked = await ctx.engine("movement", { tokenId: mage.id });
    ctx.expect(close(walked.combat?.spent ?? NaN, 6), `quatre cases à pied : ${walked.combat?.spent} m dépensés (attendu 6)`);
    await ctx.call("move-token", { tokenId: mage.id, x: at.x, y: at.y, elevation: 0 });
    await pause(800);

    // 2. La portée de la dague lancée (20/60 ft = 6/18 m).
    const reasons = () => ctx.engine("attackReasons", { attackerId: mage.id, targetId: bard.id, itemId: dagger, attackMode: "thrown" });
    await ctx.call("move-token", { tokenId: bard.id, x: at.x + (3 * grid), y: at.y, elevation: 0 });
    await pause(800);
    const near = await reasons();
    ctx.expect(!near.disadvantage.includes("situation.longRange"), `à 4,5 m : pas de portée longue (${near.disadvantage.join(", ") || "aucun Désavantage"})`);
    await ctx.call("move-token", { tokenId: bard.id, x: at.x + (6 * grid), y: at.y, elevation: 0 });
    await pause(800);
    const far = await reasons();
    ctx.expect(far.disadvantage.includes("situation.longRange"), `à 9 m : portée longue (${far.disadvantage.join(", ") || "aucun Désavantage"})`);

    // 3. L'allonge du Barde (1,5 m), rendu Hostile le temps du test.
    const { data: bardData } = await ctx.call("get-scene-object", { type: "Token", objectId: bard.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bard.id, data: { disposition: bardData.disposition } }));
    await ctx.call("update-scene-object", { type: "Token", objectId: bard.id, data: { disposition: -1 } });
    await ctx.call("move-token", { tokenId: bard.id, x: at.x + grid, y: at.y, elevation: 0 });
    await pause(800);
    const adjacent = await reasons();
    ctx.expect(adjacent.adjacentHostiles.includes(bard.name), `au contact : le Barde est un ennemi adjacent (${adjacent.adjacentHostiles.join(", ") || "personne"})`);
    ctx.expect(adjacent.disadvantage.includes("situation.closeCombat"),
      `au contact : Désavantage du corps à corps (${adjacent.disadvantage.join(", ") || "aucun"})`);
    const away = await ctx.engine("threats", { tokenId: mage.id, point: center(-3, 0) });
    ctx.expect(away.some(n => n.startsWith(bard.name)), `quitter l'allonge (4,5 m plus loin) : menace du Barde (${away.join(", ") || "aucune"})`);
    const stay = await ctx.engine("threats", { tokenId: mage.id, point: center(0, 1) });
    ctx.expect(!stay.some(n => n.startsWith(bard.name)), `rester au contact (en diagonale) : pas de menace (${stay.join(", ") || "aucune"})`);
  }
};
