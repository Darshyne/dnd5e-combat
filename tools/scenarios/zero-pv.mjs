/**
 * À 0 point de vie (SPEC §17) : le Guerrier (PJ sans joueur) est mis à 0 PV dans un combat du scénario.
 *  1. Rayon de givre du Magicien sur lui, rejoué jusqu'à toucher : dégâts à 0 PV = un échec de jet de sauvegarde
 *     contre la mort (deux sur un coup critique), écrit par la résolution du moteur, et dit dans le chat.
 *  2. Début de son tour : le moteur lance son jet contre la mort (aucun joueur ne le possède).
 * Remis en état : PV, compteurs, états.
 */
const deathOf = async (ctx, token) => {
  const actor = await ctx.call("get-actor", { actorId: token.actorId });
  const system = actor.system ?? actor.actor?.system ?? {};
  return { success: system.attributes?.death?.success ?? 0, failure: system.attributes?.death?.failure ?? 0 };
};

export default {
  name: "0 PV — dégâts à 0 PV (échec), jet contre la mort au début du tour",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Guerrier");
    const hp0 = await ctx.hp(guerrier);
    const resetDeath = () => ctx.call("update-actor", { actorId: guerrier.actorId, actorData: {
      "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } });
    ctx.restore(async () => {
      await ctx.setHp(guerrier, hp0);
      await resetDeath();
      for ( const s of ["unconscious", "incapacitated", "prone", "dead", "stable", "bloodied"] ) await ctx.removeStatusEffects(guerrier, s);
    });

    await ctx.startCombat([guerrier, mage]);
    await ctx.setHp(guerrier, 0);
    await resetDeath();

    // 1. Des dégâts à 0 PV, par une vraie résolution du moteur.
    let hit = null;
    for ( let i = 0; i < 20 && !hit; i++ ) {
      await resetDeath();
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [guerrier.id] });
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets.find(t => t.name === "Guerrier");
      if ( !target?.hit ) continue;
      await new Promise(res => setTimeout(res, 1500));
      hit = { target, death: await deathOf(ctx, guerrier), messages: await ctx.messagesSince(since) };
    }
    if ( !ctx.expect(!!hit, "le Rayon de givre touche le Guerrier (20 essais au plus)") ) return;
    const expected = hit.target.critical ? 2 : 1;
    ctx.expect(hit.death.failure === expected,
      `dégâts à 0 PV${hit.target.critical ? " (critique)" : ""} : ${hit.death.failure} échec(s) contre la mort, attendu ${expected}`);
    const said = hit.messages.find(m => m.flags?.["dnd5e-combat"]?.death?.kind === "failure");
    ctx.expect(!!said, `le chat le dit (${said ? "carte « échec »" : "aucune carte"})`);

    // 2. Début de son tour : le moteur lance son jet contre la mort.
    await resetDeath();
    const combat = await ctx.combat();
    const turns = combat.turns ?? combat.combat?.turns ?? combat.combatants ?? [];
    let rolled = null;
    for ( let i = 0; i < Math.max(2, turns.length) + 1 && !rolled; i++ ) {
      await ctx.nextTurn();
      await new Promise(res => setTimeout(res, 2500));
      const death = await deathOf(ctx, guerrier);
      // Un 20 naturel remet à 1 PV et les compteurs à zéro : c'est aussi un jet lancé.
      if ( ((death.success + death.failure) > 0) || ((await ctx.hp(guerrier)) > 0) ) rolled = death;
    }
    ctx.expect(!!rolled, `au début de son tour, un jet contre la mort a été lancé (${rolled ? `${rolled.success} réussite / ${rolled.failure} échec` : "rien"})`);
  }
};
