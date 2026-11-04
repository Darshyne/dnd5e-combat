/**
 * §361, lot O9g de la repasse des objets : Cape elfique. Arène de test (Guerrier, Zombi).
 *  La Perception passive du Zombi contre le Guerrier perd 5 quand le Guerrier porte la cape harmonisée ; rangée, elle revient.
 */
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9g2 — Cape elfique : Perception passive des ennemis −5",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const set = (itemId, data) => ctx.call("upsert-actor-item", { actorId: ftok.actorId, itemData: data, match: { path: "_id", value: itemId } });
    const passive = async () => (await ctx.engine("stealth", { op: "observers", tokenId: fighter.id }))?.find(o => o.name === "Zombi")?.passive;
    const cloak = await ctx.ensureItem(fighter, `${DMG}dmgCloakOfElvenk`);
    await set(cloak, { system: { equipped: false, attuned: false } });
    await pause(400);
    const plain = await passive();
    await set(cloak, { system: { equipped: true, attuned: true } });
    await pause(400);
    const cloaked = await passive();
    ctx.expect(Number.isFinite(plain) && (cloaked === plain - 5), `Perception passive du Zombi : ${plain} → ${cloaked} avec la cape`);
    await set(cloak, { system: { equipped: false, attuned: false } });
  }
};
