/**
 * Brique « déplacement forcé » (B3, écrite en 0.31.0, vérifiée ici) : Télékinésiste (`telekinetic`, don du PHB, ajouté au
 * Magicien le temps du scénario) — « Poussée télékinésique » : sauvegarde de Force, ou la cible est repoussée de 5 ft.
 * Contenu : `{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }`. On rejoue jusqu'à un
 * échec : le Zombi recule d'une case, à l'opposé du Magicien.
 */
export default {
  name: "télékinésie — Poussée télékinésique repousse le Zombi de 5 ft sur un échec",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.feats.Item.phbftTelekinetic");
    const mPos = await ctx.position(mage);
    // Deux cases au sud : la colonne sous la case d'origine du Magicien est libre de murs et de tokens (relevé du scénario
    // `poussee`). À l'ouest, un mur arrête la poussée (2026-09-25) ; à l'est, l'Occultiste occupe la case suivante (2026-09-28).
    const pos0 = { x: mPos.x, y: mPos.y + 2 * grid, elevation: mPos.elevation };

    for ( let i = 0; i < 20; i++ ) {
      await ctx.call("move-token", { tokenId: zombi.id, ...pos0 });
      const used = await ctx.use({ tokenId: mage.id, identifier: "telekinetic", activityId: "fRiTsQ2k0pnpD8zE", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets.find(t => t.name === "Zombi");
      if ( !target?.save ) { ctx.expect(false, `le Zombi n'est pas la cible (${r.targets.map(t => t.name).join(", ")})`); return; }
      await new Promise(res => setTimeout(res, 1500));
      const pos = await ctx.position(zombi);
      const moved = Math.round(Math.hypot(pos.x - pos0.x, pos.y - pos0.y) / grid);
      if ( target.save.success ) { ctx.expect(moved === 0, `réussite (${target.save.total} ≥ ${r.plan.save.dc}) : pas bougé`); continue; }
      ctx.expect(moved === 1, `échec (${target.save.total}) : repoussé de ${moved} case (attendu 1 = 5 ft)`);
      ctx.expect(Math.hypot(pos.x - mPos.x, pos.y - mPos.y) > Math.hypot(pos0.x - mPos.x, pos0.y - mPos.y), "à l'opposé du Magicien");
      return;
    }
    ctx.expect(false, "aucun échec de sauvegarde en 20 essais");
  }
};
