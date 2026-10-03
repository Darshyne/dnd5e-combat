/**
 * Fin d'une zone qui dure sans concentration (SPEC §16.37) : Lumière du jour de Sylaene reçoit son heure de fin (une heure
 * après la pose) ; ramenée à 6 s de là, un round de combat (6 s d'heure du monde, dnd5e `CONFIG.time.roundTime`) la fait
 * disparaître, sa lumière avec. Fait avancer l'heure du monde du monde de test d'un round ou deux. Monde `ravenloft`
 * (Sylaene, Zombi) ; non applicable ailleurs.
 */
const DAYLIGHT = "Compendium.dnd-players-handbook.spells.phbsplDaylight00";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "durée — Lumière du jour prend fin avec l'heure du monde",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Sylaene", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Sylaene ou le Zombi absent : non applicable"); return; }
    const druid = await ctx.token("Sylaene");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const box = await ctx.box(druid);

    await ctx.ensureItem(druid, DAYLIGHT, { system: { method: "atwill" } });
    const day = await ctx.use({ tokenId: druid.id, identifier: "daylight",
      area: { shape: "circle", x: box.x + (box.width / 2), y: box.y + (box.height / 2), radius: 12 * grid } });
    ctx.expect(day.used && !!day.regionId, "Lumière du jour posée");
    if ( !day.regionId ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: day.regionId }).catch(() => {}));
    await pause(2000);

    const region = async () => (await ctx.call("get-scene-object", { type: "Region", objectId: day.regionId }).catch(() => null))?.data ?? null;
    const at = (await region())?.flags?.["dnd5e-combat"]?.expiresAt;
    ctx.expect(Number.isFinite(at), `heure de fin notée sur la zone (${at})`);
    if ( !Number.isFinite(at) ) return;
    const lights = async () => ((await ctx.call("list-scene-objects", { types: ["AmbientLight"] })).objects?.AmbientLight ?? []);
    const before = (await lights()).length;

    // Une heure, c'est long : on ramène la fin à 6 s de maintenant (heure notée − 3600 + 6), puis un round de combat.
    await ctx.call("update-scene-object", { type: "Region", objectId: day.regionId, data: { "flags.dnd5e-combat.expiresAt": at - 3600 + 6 } });
    await ctx.startCombat([druid, zombi]);
    for ( let i = 0; (i < 4) && (await region()); i++ ) {
      await ctx.nextTurn();
      await pause(2000);
    }
    ctx.expect(!(await region()), "un round plus tard (6 s d'heure du monde) : la zone a pris fin");
    ctx.expect((await lights()).length === before - 1, "sa lumière est éteinte");
  }
};
