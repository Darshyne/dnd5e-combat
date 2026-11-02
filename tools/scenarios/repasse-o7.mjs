/**
 * §343, lot O7 de la repasse des objets : défenses passives. Arène de test (Guerrier, Zombi).
 *  1. Cape de déplacement portée par le Guerrier : le Zombi l'attaque avec le Désavantage ; rangée, plus de Désavantage.
 *  2. Bracelets de défense : avec l'armure du Guerrier, leur effet est désactivé (`effectWhile` « ni armure ni bouclier »).
 *  3. Anneau d'action libre porté et harmonisé : immunité à Paralysé et Entravé (effet tenu par le moteur).
 */
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o7 — Cape de déplacement, Bracelets de défense, Anneau d'action libre",

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
    const wear = (itemId, on) => ctx.call("upsert-actor-item", { actorId, itemData: { system: { equipped: on, attuned: on } }, match: { path: "_id", value: itemId } });

    // 1. Cape de déplacement.
    const cloak = await ctx.ensureItem(fighter, `${DMG}dmgCloakOfDispla`);
    const zombiItems = (await ctx.call("get-actor", { actorId: (await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id })).data.actorId })).items ?? [];
    const slam = zombiItems.find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"))?._id;
    if ( !ctx.expect(!!slam, "le Zombi a une attaque") ) return;
    const reasons = async () => (await ctx.engine("attackReasons", { attackerId: zombi.id, targetId: fighter.id, itemId: slam }))?.disadvantage ?? [];
    await wear(cloak, true);
    await pause(400);
    const worn = await reasons();
    ctx.expect(worn.some(r => r.startsWith("content")), `Cape portée : le Zombi attaque avec le Désavantage (${worn.join(", ") || "aucun"})`);
    await wear(cloak, false);
    await pause(400);
    const stored = await reasons();
    ctx.expect(!stored.some(r => r.startsWith("content")), `Cape rangée : plus de Désavantage (${stored.join(", ") || "aucun"})`);

    // 2. Bracelets de défense avec une armure.
    const bracers = await ctx.ensureItem(fighter, `${DMG}dmgBracersOfDefe`);
    await wear(bracers, true);
    const actor = await ctx.call("get-actor", { actorId });
    const armored = (actor.items ?? []).some(i => (i.type === "equipment") && i.system?.equipped && ["light", "medium", "heavy"].includes(i.system?.type?.value));
    let disabled = null;
    for ( let i = 0; i < 10; i++ ) {
      await pause(400);
      disabled = (await ctx.engine("itemData", { tokenId: fighter.id, itemId: bracers, paths: ["effect:ycuTEJoi9a8BO6xg:disabled"] }))?.["effect:ycuTEJoi9a8BO6xg:disabled"];
      if ( disabled === armored ) break;
    }
    ctx.expect(disabled === armored, `Bracelets de défense : effet ${disabled ? "désactivé" : "actif"} (${armored ? "armure portée" : "sans armure"})`);

    // 3. Anneau d'action libre.
    const ring = await ctx.ensureItem(fighter, `${DMG}dmgRingOfFreeAct`);
    await wear(ring, true);
    let ci = [];
    for ( let i = 0; i < 10; i++ ) {
      await pause(400);
      const effects = await ctx.effects(fighter);
      ci = effects.flatMap(e => (e.system?.changes ?? e.changes ?? []).filter(c => c.key === "system.traits.ci.value").map(c => c.value));
      if ( ci.includes("paralyzed") ) break;
    }
    ctx.expect(ci.includes("paralyzed") && ci.includes("restrained"), `Anneau d'action libre : immunité à Paralysé et Entravé (${ci.join(", ") || "aucune"})`);
    await wear(ring, false);
    await pause(800);
  }
};
