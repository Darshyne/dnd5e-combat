/**
 * Brique « déplacement forcé », traction au toucher : Fouet d'épines (module PHB, ajouté au Magicien le temps
 * du scénario) sur le Zombi à distance. Contenu `thorn-whip` : `{ on: "hit", if: { "target.sizeAtMost": "lg" },
 * do: [{ type: "move", mode: "pull", distance: 10, units: "ft" }] }`. Sur un toucher, le Zombi (M) est attiré
 * de deux cases vers le Magicien ; sur un raté, il ne bouge pas. On rejoue jusqu'à toucher.
 */
export default {
  name: "traction — Fouet d'épines attire le Zombi de 10 ft au toucher",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplThornWhip0");
    // Une ligne dégagée : le Zombi à quatre cases au sud du Magicien (à sa place habituelle, le Paladin est sur la
    // ligne et arrête la traction après une case — vu le 2026-09-24).
    const pos0 = { x: magePos.x, y: magePos.y + 4 * grid, elevation: home.elevation };

    let hit = null;
    for ( let i = 0; i < 20 && !hit; i++ ) {
      await ctx.setHp(zombi, hp0);
      await ctx.call("move-token", { tokenId: zombi.id, x: pos0.x, y: pos0.y, elevation: pos0.elevation });
      const used = await ctx.use({ tokenId: mage.id, identifier: "thorn-whip", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets.find(t => t.name === "Zombi");
      if ( !target ) { ctx.expect(false, `le Zombi n'est pas la cible (${r.targets.map(t => t.name).join(", ")})`); return; }
      ctx.expect(r.plan.steps.length === 1 && r.plan.steps[0].mode === "pull", `le plan porte l'étape de traction (${JSON.stringify(r.plan.steps)})`);
      await new Promise(res => setTimeout(res, 1500));
      const pos = await ctx.position(zombi);
      const moved = Math.round(Math.hypot(pos.x - pos0.x, pos.y - pos0.y) / grid);
      if ( !target.hit ) { ctx.expect(moved === 0, `raté (${r.attack.roll.total} < CA ${target.ac}) : le Zombi n'a pas bougé (${moved} case)`); continue; }
      hit = { target, pos, moved, roll: r.attack.roll.total };
    }
    if ( !hit ) { ctx.expect(false, "aucun toucher en 20 essais"); return; }
    const { target, pos, moved, roll } = hit;
    ctx.expect(moved === 2, `touché (${roll} ≥ CA ${target.ac}) : le Zombi a été attiré de ${moved} case(s) (attendu 2 = 10 ft)`);
    const before = Math.hypot(pos0.x - magePos.x, pos0.y - magePos.y);
    const after = Math.hypot(pos.x - magePos.x, pos.y - magePos.y);
    ctx.expect(after < before, `attiré vers le Magicien (${Math.round(before)} → ${Math.round(after)} px)`);
    ctx.expect((target.damage?.applied ?? 0) > 0, `dégâts appliqués (${target.damage?.applied})`);
  }
};
