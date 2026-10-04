/**
 * Niveaux et surfaces (P2, SPEC §14.2) sur une scène à niveaux (Restored Keep) : le Zombi est
 * descendu au niveau le plus bas, tête contre son plafond, juste sous le plancher de l'Ensorceleur.
 *  1. Mains brûlantes posée sur sa colonne depuis l'étage ne l'atteint pas : le plancher (Surface
 *     `move`) coupe la ligne d'effet — « zone posée sur personne », PV intacts.
 *  2. Trait de feu tiré sur lui depuis l'étage : abri total dans le verdict (CA nulle, raté d'office).
 * Remet le Zombi à son niveau, son élévation et ses PV. Déplacements par `move-token` (0.27.0).
 * Sans niveaux sur la scène (un seul niveau), le scénario se déclare non applicable.
 */
export default {
  scene: "keep",   // §83 : étages et escaliers, dans Restored Keep
  name: "niveaux — un plancher arrête la zone et l'attaque",

  async run(ctx) {
    const { levels } = await ctx.call("list-levels", {});
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const sorted = [...levels].sort((a, b) => a.elevation.base - b.elevation.base);
    const lowest = sorted[0];
    const sorcLevel = levels.find(l => l.id === sorc.level) ?? sorted[1];
    if ( !lowest || !sorcLevel || (lowest.id === sorcLevel.id) ) { ctx.log("scène sans niveau sous celui de l'Ensorceleur : non applicable"); return; }
    const { surfaces } = await ctx.call("list-surfaces", { type: "move" });
    ctx.expect(surfaces.some(s => s.elevation === sorcLevel.elevation.base), `un plancher « move » à ${sorcLevel.elevation.base} (niveau ${sorcLevel.name})`);

    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const home = { x: zombi.x, y: zombi.y, elevation: zombi.elevation ?? 0, levelId: zombi.level };
    const move = async where => {
      const moved = await ctx.call("move-token", { tokenId: zombi.id, ...where });
      if ( !moved.moved ) throw new Error(`move-token : ${moved.warning ?? "refusé"} (${JSON.stringify(moved.after)})`);
      return moved.after;
    };
    ctx.restore(() => move(home));

    // Tête contre le plafond du niveau du dessous : une case de haut sous le plancher.
    const scene = await ctx.call("get-scene", {});
    const step = scene.grid?.distance ?? scene.scene?.grid?.distance ?? 5;
    const below = await move({ levelId: lowest.id, elevation: sorcLevel.elevation.base - step });
    ctx.expect(below.level === lowest.id, `Zombi descendu au niveau « ${lowest.name} », élévation ${below.elevation}`);

    // 1. Zone depuis l'étage sur sa colonne.
    const box = await ctx.box(zombi);
    const zone = await ctx.use({ tokenId: sorc.id, identifier: "burning-hands", activityType: "save", area: { shape: "rectangle", ...box }, collectMs: 3000 });
    ctx.expect(zone.used && !!zone.regionId, "Mains brûlantes posée sur la colonne du Zombi, depuis l'étage");
    if ( zone.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: zone.regionId }).catch(() => {}));
    await new Promise(r => setTimeout(r, 2000));
    const r1 = await ctx.resolution(zone.usageMessageId);
    ctx.expect(!r1?.targets?.some(t => t.name === "Zombi"), `le plancher arrête la zone (cibles : ${r1?.targets?.map(t => t.name).join(", ") || "aucune"})`);
    ctx.expect((await ctx.hp(zombi)) === hp0, "PV intacts");

    // 2. Attaque à distance depuis l'étage : abri total.
    const shot = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
    ctx.expect(shot.used, "Trait de feu tiré sur le Zombi du dessous");
    const r2 = await ctx.settle(shot.usageMessageId);
    const target = r2.targets.find(t => t.name === "Zombi") ?? r2.targets[0];
    ctx.expect(target?.cover?.degree === "total", `abri total dans le verdict (${target?.cover?.degree ?? "aucun abri"})`);
    ctx.expect((target?.ac === null) && (target?.hit === false) && (r2.step === "missed"), `intouchable : CA ${target?.ac}, ${target?.hit ? "touché" : "raté"}, étape « ${r2.step} »`);
    ctx.expect((await ctx.hp(zombi)) === hp0, "PV intacts après le tir");
  }
};
