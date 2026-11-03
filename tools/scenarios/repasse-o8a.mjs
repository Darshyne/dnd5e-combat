/**
 * §344, lot O8a de la repasse des objets : absorber un sort qui ne vise que le porteur. Arène de test (Guerrier, Zombi).
 *  1. Sceptre d'absorption tenu et harmonisé (le bâton rangé) : le Zombi lance Rayon affaiblissant (niveau 2) sur le Guerrier ; la
 *     réaction (prise d'office) annule le sort — pas d'effet — et le sceptre dépense 2 utilisations ; Éclair traçant (niveau 1) : aucun
 *     dégât, 1 utilisation.
 *  2. Mains brûlantes (zone) : rien n'est proposé, le sort part.
 *  3. Sceptre rangé : Éclair traçant n'est plus absorbé.
 *  4. Bâton du thaumaturge tenu : Blessure (niveau 1, sauvegarde) est annulé, le bâton gagne 1 charge.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o8a — Sceptre d'absorption et Bâton du thaumaturge : un sort qui ne vise que le porteur est annulé",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = tok.actorId;
    const hp0 = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    const lend = id => ctx.ensureItem(zombi, PHB + id, { system: { method: "atwill" } });
    const bolt = await lend("phbsplGuidingBol");
    const ray = await lend("phbsplRayofEnfee");
    const hands = await lend("phbsplBurningHan");
    const wounds = await lend("phbsplInflictWou");
    const rod = await ctx.ensureItem(fighter, `${DMG}dmgRodOfAbsorpti`);
    const staff = await ctx.ensureItem(fighter, `${DMG}dmgStaffOfTheMag`);
    const set = (itemId, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: itemId } });
    const spent = async itemId => (await ctx.engine("itemData", { tokenId: fighter.id, itemId, paths: ["system.uses.spent"] }))?.["system.uses.spent"];

    /** Le Zombi lance le sort sur le Guerrier (réactions prises d'office) ; rend les PV perdus. */
    const cast = async (itemId, activityType, usage={}) => {
      await ctx.setHp(fighter, hp0);
      await ctx.use({ tokenId: zombi.id, itemId, activityType, targetTokenIds: [fighter.id], consume: false,
        usageConfig: { ...usage, [MODULE_ID]: { confirmed: true, autoReact: "first" } } }).catch(() => null);
      await pause(9000);
      return hp0 - await ctx.hp(fighter);
    };

    // 1. Sceptre tenu et harmonisé, le bâton rangé.
    await set(staff, { system: { equipped: false, attuned: false } });
    await set(rod, { system: { equipped: true, attuned: true, uses: { spent: 0 } } });
    await pause(400);
    await cast(ray, "save");
    ctx.expect(!(await ctx.effectsFrom(fighter, "ray-of-enfeeblement")).length, "Sceptre : Rayon affaiblissant absorbé, aucun effet");
    ctx.expect((await spent(rod)) === 2, `Sceptre : 2 niveaux d'énergie stockés (utilisations dépensées : ${await spent(rod)})`);
    await set(rod, { system: { uses: { spent: 0 } } });
    let lost = await cast(bolt, "attack");
    ctx.expect(lost === 0, `Sceptre : Éclair traçant absorbé, aucun dégât (${lost})`);
    ctx.expect((await spent(rod)) === 1, `Sceptre : 1 niveau stocké (utilisations dépensées : ${await spent(rod)})`);

    // 2. Une zone n'est pas absorbée.
    await set(rod, { system: { uses: { spent: 0 } } });
    lost = await cast(hands, "save");
    ctx.expect((await spent(rod)) === 0, `Sceptre : Mains brûlantes (zone) n'est pas absorbé (utilisations : ${await spent(rod)}, PV perdus : ${lost})`);

    // 3. Sceptre rangé (le bâton aussi).
    await set(rod, { system: { equipped: false, attuned: false, uses: { spent: 0 } } });
    await pause(400);
    lost = await cast(bolt, "attack");
    ctx.expect((await spent(rod)) === 0, `Sceptre rangé : rien d'absorbé (utilisations : ${await spent(rod)}, PV perdus : ${lost})`);

    // 4. Bâton du thaumaturge tenu : charges gagnées.
    await set(staff, { system: { equipped: true, attuned: true, uses: { spent: 10 } } });
    await pause(400);
    lost = await cast(wounds, "save");
    ctx.expect(lost === 0, `Bâton : Blessure absorbée, aucun dégât (${lost})`);
    ctx.expect((await spent(staff)) === 9, `Bâton : 1 charge gagnée (dépensées 10 → ${await spent(staff)})`);
    await set(staff, { system: { equipped: false, attuned: false } });
  }
};
