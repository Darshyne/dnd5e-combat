/**
 * §369 (issue GitHub #27) : la prise en tenaille, règle maison désactivée par défaut — le Guerrier et le Paladin de `dnd-6` autour
 * du Zombi de l'Arène.
 *  1. Réglage « Avantage » : Guerrier à gauche, Paladin à droite → raison « situation.flanking » à l'attaque au corps à corps du Guerrier.
 *  2. Paladin au-dessus (côtés voisins) → plus de tenaille.
 *  3. Paladin de nouveau en face mais Neutralisé → plus de tenaille.
 *  4. « PNJ seulement » → le Guerrier (PJ) n'en profite plus ; réglage désactivé → plus rien.
 * Remet les réglages, les états et les positions.
 */
const SETTINGS = ["flanking", "flankingSide", "flankingConga"];

export default {
  name: "prise en tenaille — Avantage de part et d'autre, pas sur des côtés voisins, ni avec un allié Neutralisé",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Paladin", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Paladin et Zombi requis : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const paladin = await ctx.token("Paladin");
    const zombie = await ctx.token("Zombi");
    const size = await ctx.gridSize();
    const z = await ctx.position(zombie);
    // La distribution d'abord : sa remise passe en dernier.
    if ( !(await ctx.stage({ tokens: { Guerrier: [z.x - size, z.y], Paladin: [z.x + size, z.y] } })) ) { ctx.log("distribution refusée"); return; }
    const before = {};
    for ( const key of SETTINGS ) before[key] = (await ctx.engine("setting", { key })).before;
    ctx.restore(async () => { for ( const key of SETTINGS ) await ctx.engine("setting", { key, value: before[key] }).catch(() => {}); });
    const set = (key, value) => ctx.engine("setting", { key, value });
    await set("flanking", "advantage");
    await set("flankingSide", "all");
    await set("flankingConga", false);

    const weapon = ((await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? []).find(i => (i.type === "weapon")
      && Object.values(i.system?.activities ?? {}).some(a => (a.type === "attack") && (a.attack?.type?.value !== "ranged"))
      && !i.flags?.["dnd5e-combat"]?.basicAction);
    if ( !weapon ) { ctx.log("pas d'arme de corps à corps sur le Guerrier : non applicable"); return; }
    const reasons = async () => (await ctx.engine("attackReasons", { attackerId: fighter.id, targetId: zombie.id, itemId: weapon._id })).advantage;
    const flanked = async () => (await reasons()).includes("situation.flanking");
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

    ctx.expect(await flanked(), `Guerrier et Paladin de part et d'autre : Avantage « prise en tenaille » (${(await reasons()).join(", ") || "aucun"})`);

    await ctx.call("move-token", { tokenId: paladin.id, x: z.x, y: z.y - size, elevation: 0 });
    await pause(600);
    ctx.expect(!(await flanked()), "Paladin au-dessus (côtés voisins) : pas de tenaille");

    await ctx.call("move-token", { tokenId: paladin.id, x: z.x + size, y: z.y, elevation: 0 });
    await pause(600);
    ctx.restore(() => ctx.call("set-status", { tokenId: paladin.id, statusId: "incapacitated", active: false }));
    await ctx.call("set-status", { tokenId: paladin.id, statusId: "incapacitated", active: true });
    await pause(600);
    ctx.expect(!(await flanked()), "Paladin en face mais Neutralisé : pas de tenaille");
    await ctx.call("set-status", { tokenId: paladin.id, statusId: "incapacitated", active: false });
    await pause(600);
    ctx.expect(await flanked(), "Paladin remis d'aplomb : la tenaille revient");

    await set("flankingSide", "npc");
    ctx.expect(!(await flanked()), "« PNJ seulement » : le Guerrier (PJ) n'en profite pas");
    await set("flankingSide", "all");
    await set("flanking", "off");
    ctx.expect(!(await flanked()), "règle désactivée : pas de tenaille");
  }
};
