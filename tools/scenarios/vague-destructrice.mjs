/**
 * §263 : Vague destructrice — « chaque créature de votre choix prise dans l'Émanation » : le Paladin la lance avec le Guerrier (allié)
 * et le Bandit (ennemi) à côté de lui ; seul le Bandit fait la sauvegarde.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Vague destructrice — les alliés du lanceur sont épargnés",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Paladin", "Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Paladin, Guerrier, Bandit requis : non applicable"); return; }
    const [pal, guerrier, bandit] = await Promise.all(["Paladin", "Guerrier", "Bandit"].map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    const homes = [];
    for ( const t of [guerrier, bandit] ) {
      const p = await ctx.position(t);
      homes.push(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    ctx.restore(async () => { for ( const h of homes ) await h(); });
    ctx.restore(async () => { for ( const t of [guerrier, bandit] ) await ctx.removeStatusEffects(t, "prone"); });
    const p = await ctx.position(pal);
    await ctx.call("move-token", { tokenId: guerrier.id, x: p.x - grid, y: p.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: p.x + grid, y: p.y, elevation: 0 });
    await ctx.setHp(bandit, 90);
    await pause(800);
    const wave = await ctx.ensureItem(pal, "Compendium.dnd-players-handbook.spells.Item.phbsplDestructiv", { system: { method: "atwill" } });
    const b = await ctx.box(pal);
    const used = await ctx.use({ tokenId: pal.id, itemId: wave, activityType: "save", area: { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: 6 * grid } });
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    const r = await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    const names = (r?.targets ?? []).map(t => t.name);
    ctx.expect(names.includes("Bandit"), `le Bandit fait la sauvegarde (${names.join(", ") || "personne"})`);
    ctx.expect(!names.includes("Guerrier"), "le Guerrier, allié du Paladin, est épargné");
    ctx.expect(!names.includes("Paladin"), "le Paladin non plus");
  }
};
