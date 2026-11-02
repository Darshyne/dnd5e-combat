/**
 * §341, lot O5c de la repasse des objets : options au toucher, critiques. Arène de test (Guerrier, Zombi).
 *  1. Anneau du bélier : touché, le Zombi est repoussé de 1,50 m.
 *  2. Règles attachées : Bâton percussif (faveur au toucher `hitRider`) ; Épée acérée posée sur une Épée longue (règle `-enchanted` :
 *     Épuisement sur un critique — un critique ne se force pas en scénario).
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o5c — Anneau du bélier (poussée), Bâton percussif et Épée acérée (règles attachées)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => null));

    // 1. Anneau du bélier.
    const ram = await ctx.ensureItem(fighter, `${DMG}dmgRingOfTheRam0`);
    let pushed = null;
    for ( let i = 0; (i < 20) && (pushed === null); i++ ) {
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => null);
      await ctx.setHp(zombi, hp0);
      await pause(400);
      const used = await ctx.use({ tokenId: fighter.id, itemId: ram, activityType: "attack", consume: false, targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { confirmed: true } } });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Zombi")?.hit !== true ) continue;
      await pause(1500);
      const at = await ctx.position(zombi);
      pushed = Math.hypot(at.x - home.x, at.y - home.y);
    }
    const grid = await ctx.gridSize();
    ctx.expect((pushed !== null) && (Math.abs(pushed - grid) < grid / 2), `Anneau du bélier : touché, le Zombi recule d'une case (${pushed} px, case ${grid} px)`);

    // 2. Règles attachées.
    await ctx.ensureItem(fighter, `${DMG}dmgStaffOfStriki`);
    const sword = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);
    const sharp = await ctx.ensureItem(fighter, `${DMG}dmgSwordOfSharpn`);
    const { effectId } = await ctx.engine("enchant", { tokenId: fighter.id, itemId: sharp, activityId: "ximpnpVgz8dZ2q9R", targetItemId: sword }).catch(err => ({ error: err.message }));
    ctx.expect(!!effectId, "l'Épée acérée enchante l'Épée longue");
    const rules = (await ctx.engine("identify", { tokenId: fighter.id })) ?? [];
    const staff = rules.find(r => r.identifier === "staff-of-striking");
    ctx.expect((staff?.rules ?? []).includes("hitRider"), `Bâton percussif : faveur au toucher (${(staff?.rules ?? []).join(", ")})`);
    const enchanted = rules.find(r => r.id === sword);
    ctx.expect((enchanted?.triggers ?? []).some(t => t.if?.["hit.critical"] === true), `Épée longue enchantée : Épuisement sur un critique (${JSON.stringify(enchanted?.triggers ?? null).slice(0, 160)})`);
    if ( effectId ) {
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
      await ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: sword }).catch(() => null);
    }
  }
};
