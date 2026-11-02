/**
 * §338, lot O4 de la repasse des objets : coûts, zones, invocations, fumées. Arène de test (Guerrier, Zombi).
 *  1. Les règles s'attachent aux objets prêtés au Guerrier (`api.mcp.identify`) : Acide et Eau bénite (`replacesAttack`), Grenade fumigène
 *     (`obscures`), gemme élémentaire (`summon`), Poudre à éternuer (`includesOrigin`).
 *  2. Poudre à éternuer jetée par le Guerrier : il fait lui aussi la sauvegarde (la zone personnelle prend son origine).
 *  3. Gemme élémentaire (saphir bleu) en combat : l'élémentaire entre au combat juste après le Guerrier.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o4 — lancers qui remplacent une attaque, zone qui prend son origine, invocation d'objet au combat",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const summoned = [];
    ctx.restore(async () => {
      const live = (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of summoned ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
      for ( const t of [fighter, zombi] ) {
        await ctx.removeEffectsFrom(t, "dust-of-sneezing-and-choking");
        for ( const s of ["incapacitated", "suffocation"] ) await ctx.removeStatusEffects(t, s);
      }
    });

    // 1. Les règles attachées.
    const lent = {
      acid: `${PHB}phbagAcid0000000`, "holy-water": `${PHB}phbagHolyWater00`, "grenade-smoke": `${DMG}dmgGrenadeSmoke0`,
      "blue-elemental-gem": `${DMG}dmgBlueElemental`, "dust-of-sneezing-and-choking": `${DMG}dmgDustOfSneezin`
    };
    for ( const uuid of Object.values(lent) ) await ctx.ensureItem(fighter, uuid);
    const rules = Object.fromEntries(((await ctx.engine("identify", { tokenId: fighter.id })) ?? []).map(r => [r.identifier, r.rules]));
    const want = { acid: "replacesAttack", "holy-water": "replacesAttack", "grenade-smoke": "obscures", "blue-elemental-gem": "summon",
      "dust-of-sneezing-and-choking": "includesOrigin" };
    for ( const [id, key] of Object.entries(want) ) ctx.expect((rules[id] ?? []).includes(key), `${id} : règle ${key} (${(rules[id] ?? []).join(", ") || "aucune"})`);

    // 2. Poudre à éternuer : le Guerrier fait aussi la sauvegarde.
    const box = await ctx.box(fighter);
    const used = await ctx.use({ tokenId: fighter.id, identifier: "dust-of-sneezing-and-choking", activityType: "save", consume: false,
      area: { shape: "rectangle", x: box.x - 100, y: box.y - 100, width: box.width + 200, height: box.height + 200 },
      usageConfig: { [MODULE_ID]: { confirmed: true } } });
    const r = await ctx.settle(used.usageMessageId).catch(() => null);
    const names = (r?.targets ?? []).map(t => t.name);
    if ( !names.length ) ctx.log(`résolution : ${JSON.stringify(r ?? null).slice(0, 600)}`);
    ctx.expect(names.includes("Guerrier"), `Poudre à éternuer : celui qui la jette est dans la zone (${names.join(", ") || "personne"})`);
    await pause(800);
    for ( const s of ["incapacitated", "suffocation"] ) await ctx.removeStatusEffects(fighter, s);
    await ctx.removeEffectsFrom(fighter, "dust-of-sneezing-and-choking");

    // 3. Gemme élémentaire en combat.
    await ctx.startCombat([fighter, zombi]);
    const started = await ctx.combat();
    for ( const [t, v] of [[fighter, 15], [zombi, 10]] ) await ctx.call("set-initiative", { combatantId: started.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const grid = await ctx.gridSize();
    const pos = await ctx.position(fighter);
    const gem = await ctx.itemId(fighter.id, "blue-elemental-gem");
    const s = await ctx.engine("summonAt", { tokenId: fighter.id, itemId: gem, x: pos.x + (2 * grid), y: pos.y }).catch(err => ({ error: err.message }));
    const st = s?.tokens?.[0];
    if ( !ctx.expect(!!st, `l'élémentaire est invoqué${s?.error ? ` (${s.error})` : ""}`) ) return;
    summoned.push(st.id);
    await pause(2000);
    const combat = await ctx.combat();
    const list = (combat?.combatants ?? combat?.turns ?? []);
    const order = list.map(c => c.tokenId);
    const owner = order.indexOf(fighter.id);
    const mine = order.indexOf(st.id);
    ctx.expect(mine >= 0, `l'élémentaire est au combat (${list.map(c => c.name).join(", ")})`);
    if ( (owner >= 0) && (mine >= 0) ) ctx.expect(mine === owner + 1, `il joue juste après le Guerrier (rangs ${owner} et ${mine})`);
  }
};
