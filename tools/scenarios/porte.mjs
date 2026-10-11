/**
 * Portes à distance (SPEC §18.24, §152) : le Guerrier ouvre puis ferme une porte à quatre cases de lui, comme l'entrée « Ouvrir » /
 * « Fermer » du menu (`api.mcp.door` → `setDoorOpen` → `approachDoor`). Il s'avance d'abord au contact, de son côté du mur, puis
 * agit. Le 2026-10-11 (§147 → §152), `approachDoor` lisait un `maxCost` jamais déclaré : toute porte hors de portée levait une
 * ReferenceError et le menu ne faisait rien.
 * Arène de test : une porte d'une case posée pour le scénario (x = 3360, le long de la rangée du Guerrier), retirée à la fin.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "porte — ouvrir et fermer une porte à distance",

  async run(ctx) {
    const fighter = await ctx.token("Guerrier").catch(() => null);
    if ( !fighter ) { ctx.log("Guerrier absent : non applicable"); return; }
    const grid = await ctx.gridSize();
    const home = await ctx.position(fighter);
    const doorX = home.x + (4 * grid);
    const created = await ctx.call("create-walls", { walls: [{ c: [doorX, home.y, doorX, home.y + grid], preset: "door" }] });
    const wallId = created?.walls?.[0]?.id ?? created?.walls?.[0]?._id ?? null;
    if ( !wallId ) throw new Error(`porte non créée (${JSON.stringify(created).slice(0, 200)})`);
    ctx.restore(async () => {
      await ctx.call("delete-scene-object", { type: "Wall", objectId: wallId }).catch(() => {});
      const now = await ctx.position(fighter);
      if ( (now.x !== home.x) || (now.y !== home.y) ) await ctx.call("move-token", { tokenId: fighter.id, ...home }).catch(() => {});
    });
    await pause(1000);

    const opened = await ctx.engine("door", { tokenId: fighter.id, wallId, open: true });
    ctx.expect(opened?.state === "open", `porte à 4 cases : ${opened?.state}`);
    ctx.expect((opened?.x === doorX - grid) && (opened?.y === home.y), `le Guerrier s'est avancé au contact (${home.x} → ${opened?.x})`);

    const closed = await ctx.engine("door", { tokenId: fighter.id, wallId, open: false });
    ctx.expect(closed?.state === "closed", `au contact, elle se ferme : ${closed?.state}`);
  }
};
