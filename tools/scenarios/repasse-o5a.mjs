/**
 * §339, lot O5a de la repasse des objets : propriétés Lourde et Chargement. Arène de test (Guerrier, Zombi).
 *  1. Lourde : l'Épée à deux mains du Guerrier avec 10 en Force donne le Désavantage (raison `heavyWeapon`) ; avec 13, non.
 *  2. Chargement : avec deux attaques par action (Attaque supplémentaire), un premier tir d'Arbalète légère passe ; un second tir dans la
 *     même action Attaquer est signalé (« loading »).
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o5a — propriétés Lourde (Désavantage sous 13) et Chargement (un tir par action)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = tok.actorId;
    const actor = await ctx.call("get-actor", { actorId });
    const str = actor.system?.abilities?.str?.value;
    ctx.restore(() => ctx.call("update-actor", { actorId, actorData: { "system.abilities.str.value": str } }).catch(() => {}));

    // 1. Lourde.
    const sword = await ctx.ensureItem(fighter, `${PHB}phbwepGreatsword`);
    const reasons = async () => (await ctx.engine("attackReasons", { attackerId: fighter.id, targetId: zombi.id, itemId: sword }))?.disadvantage ?? [];
    await ctx.call("update-actor", { actorId, actorData: { "system.abilities.str.value": 10 } });
    await pause(400);
    const weak = await reasons();
    ctx.expect(weak.includes("situation.heavyWeapon"), `Force 10 : Désavantage avec l'Épée à deux mains (${weak.join(", ") || "aucun"})`);
    await ctx.call("update-actor", { actorId, actorData: { "system.abilities.str.value": 13 } });
    await pause(400);
    const strong = await reasons();
    ctx.expect(!strong.includes("situation.heavyWeapon"), `Force 13 : pas de Désavantage (${strong.join(", ") || "aucun"})`);
    await ctx.call("update-actor", { actorId, actorData: { "system.abilities.str.value": str } });

    // 2. Chargement.
    const bow = await ctx.ensureItem(fighter, `${PHB}phbwepLightCross`);
    // Attaque supplémentaire, le temps du test (le moteur la reconnaît par son identifiant).
    const extra = await ctx.call("upsert-actor-item", { actorId, itemData: { name: "Extra Attack (test)", type: "feat", system: { identifier: "extra-attack" } },
      match: { path: "system.identifier", value: "extra-attack" } });
    const extraId = extra.itemId ?? extra.id ?? extra.item?._id;
    if ( extra.action === "created" || extra.created ) ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: extraId }).catch(() => {}));
    await ctx.startCombat([fighter, zombi]);
    const started = await ctx.combat();
    for ( const [t, v] of [[fighter, 20], [zombi, 5]] ) await ctx.call("set-initiative", { combatantId: started.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    await pause(800);
    const attacks = (await ctx.engine("budget", { tokenId: fighter.id }))?.attacksPerAction ?? null;
    const used = await ctx.use({ tokenId: fighter.id, itemId: bow, activityType: "attack", consume: false, targetTokenIds: [zombi.id],
      usageConfig: { [MODULE_ID]: { confirmed: true } } });
    await ctx.settle(used.usageMessageId).catch(() => null);
    await pause(1200);
    const budget = await ctx.engine("budget", { tokenId: fighter.id });
    ctx.expect(budget?.loadedFired === true, `après le premier tir, l'arme à Chargement a tiré dans l'action (${JSON.stringify({ attacks: budget?.attacks, loadedFired: budget?.loadedFired })})`);
    const second = await ctx.engine("issues", { tokenId: fighter.id, itemId: bow, activityType: "attack" });
    const text = JSON.stringify(second ?? []);
    if ( (budget?.attacks?.granted ?? 1) < 2 ) ctx.log(`le Guerrier n'a qu'une attaque par action (${attacks}) : le Chargement ne se distingue pas de l'action prise`);
    else ctx.expect(/loading|Chargement|Loading/i.test(text), `second tir dans la même action : refusé (${text.slice(0, 200)})`);
    const swordIssues = JSON.stringify(await ctx.engine("issues", { tokenId: fighter.id, itemId: sword, activityType: "attack" }) ?? []);
    if ( (budget?.attacks?.granted ?? 1) >= 2 ) ctx.expect(!/loading|Chargement/i.test(swordIssues), "l'Épée à deux mains, elle, peut encore frapper");
  }
};
