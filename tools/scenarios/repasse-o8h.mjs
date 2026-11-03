/**
 * §351, lot O8h de la repasse des objets : portée minimale des armes de siège. Arène de test (Guerrier, Zombi).
 *  1. Mangonneau (portée 200/800 ft, « ne peut pas toucher une cible à 18 m ou moins ») : le Zombi à 4 cases est trop près —
 *     souci bloquant « trop près ».
 *  2. Le Zombi à 14 cases (70 ft) : aucun souci.
 *  3. Une arme ordinaire (Arbalète légère) à 4 cases : aucun souci de portée minimale.
 */
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";

export default {
  name: "repasse-o8h — Mangonneau : une cible trop près ne peut pas être touchée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + 4 * g, at.y] } });
    const zombi = await ctx.token("Zombi");
    const mangonel = await ctx.ensureItem(fighter, `${DMG}dmgMangonel00000`);
    const bow = await ctx.ensureItem(fighter, `${PHB}phbwepLightCross`);
    const check = itemId => ctx.engine("rangeCheck", { tokenId: fighter.id, itemId, targetIds: [zombi.id], activityType: "attack" });

    let p = await check(mangonel);
    ctx.expect(p.some(x => x.issue === "tooClose"), `Mangonneau, Zombi à 4 cases : trop près (${JSON.stringify(p)})`);
    p = await check(bow);
    ctx.expect(!p.some(x => x.issue === "tooClose"), `Arbalète légère, Zombi à 4 cases : pas de portée minimale (${JSON.stringify(p)})`);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + 14 * g, y: at.y, elevation: 0 });
    await new Promise(resolve => setTimeout(resolve, 800));
    p = await check(mangonel);
    ctx.expect(!p.length, `Mangonneau, Zombi à 14 cases : à portée (${JSON.stringify(p)})`);
  }
};
