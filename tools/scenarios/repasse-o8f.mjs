/**
 * §349, lot O8f de la repasse des objets : invocations hostiles. Arène de test (Paladin, possédé par un joueur).
 *  1. Le Crâne (Jeu des merveilles) : l'Avatar de la mort apparaît Hostile, et aucun joueur n'en est propriétaire ; à 0 PV il disparaît.
 *  2. Parchemin d'invocation de titan (son activité d'invocation, premier profil : l'Empyréen) : le titan apparaît Hostile, sans joueur
 *     propriétaire.
 * Retire les tokens invoqués.
 */
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o8f — Le Crâne et le Parchemin d'invocation de titan : invocations hostiles",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Paladin") ) { ctx.log("Paladin absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const paladin = await ctx.token("Paladin");
    const summoned = [];
    ctx.restore(async () => {
      const live = (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of summoned ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
    });
    /** Disposition du token et joueurs (non MJ) propriétaires de son acteur. */
    const state = id => ctx.engine("owners", { tokenId: id });
    const present = async id => (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.some(t => t.id === id);
    const grid = await ctx.gridSize();
    const pos = await ctx.position(paladin);

    // 1. Le Crâne.
    const skull = await ctx.ensureItem(paladin, `${DMG}dmgDmtSkull00000`);
    const a = await ctx.engine("summonAt", { tokenId: paladin.id, itemId: skull, x: pos.x + (2 * grid), y: pos.y });
    const avatar = a.tokens?.[0];
    if ( !ctx.expect(!!avatar, `l'Avatar de la mort apparaît (${avatar?.name ?? "rien"})`) ) return;
    summoned.push(avatar.id);
    await pause(2500);
    let s = await state(avatar.id);
    ctx.expect(s.disposition === -1, `Avatar : Hostile (disposition ${s.disposition})`);
    ctx.expect(!s.players.length && s.gmOwned, `Avatar : aucun joueur propriétaire, le MJ seul (${s.players.join(", ") || "aucun"})`);
    await ctx.engine("hurt", { tokenId: avatar.id, amount: 999, type: "force" });
    await pause(3000);
    ctx.expect(!(await present(avatar.id)), "Avatar à 0 PV : il disparaît");

    // 2. Parchemin d'invocation de titan.
    const scroll = await ctx.ensureItem(paladin, `${DMG}dmgScrollOfTitan`);
    const t = await ctx.engine("summonAt", { tokenId: paladin.id, itemId: scroll, x: pos.x + (4 * grid), y: pos.y });
    const titan = t.tokens?.[0];
    if ( !ctx.expect(!!titan, `le titan apparaît (${titan?.name ?? "rien"})`) ) return;
    summoned.push(titan.id);
    await pause(2500);
    s = await state(titan.id);
    ctx.expect((s.disposition === -1) && !s.players.length, `Titan : Hostile, aucun joueur propriétaire (disposition ${s.disposition}, ${s.players.join(", ") || "aucun"})`);
  }
};
