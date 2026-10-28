/**
 * §264 : Porte dimensionnelle avec passager — « une créature consentante à 1,50 m de vous… se téléporte dans un espace à 1,50 m de
 * votre destination ». Le Magicien, le Guerrier à son contact et ciblé, saute à 8 cases : le Guerrier arrive au contact du Magicien.
 * Puis un saut sans cible : le Guerrier reste.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Porte dimensionnelle — le passager suit le lanceur",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    for ( const t of [mage, guerrier] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
    }
    const door = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplDimensionD");
    const m = await ctx.position(mage);
    await ctx.call("move-token", { tokenId: guerrier.id, x: m.x - grid, y: m.y, elevation: 0 });
    await pause(800);

    const to = { x: m.x + 8 * grid, y: m.y };
    const r = await ctx.engine("teleport", { tokenId: mage.id, itemId: door, ...to, passengers: [guerrier.id] });
    ctx.expect(r?.accepted, "le Magicien se téléporte");
    await pause(2500);
    const g = await ctx.position(guerrier);
    const dx = Math.abs(g.x - to.x) / grid, dy = Math.abs(g.y - to.y) / grid;
    ctx.expect((Math.max(dx, dy) === 1), `le Guerrier arrive au contact du Magicien (écart ${dx} × ${dy} cases)`);
    ctx.expect((g.x === to.x - grid) && (g.y === to.y), "à la même place relative (à gauche)");

    const before = await ctx.position(guerrier);
    const r2 = await ctx.engine("teleport", { tokenId: mage.id, itemId: door, x: to.x, y: to.y + 4 * grid });
    ctx.expect(r2?.accepted, "second saut, sans passager désigné");
    await pause(2000);
    const after = await ctx.position(guerrier);
    ctx.expect((after.x === before.x) && (after.y === before.y), "le Guerrier reste sur place");
  }
};
