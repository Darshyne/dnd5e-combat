/**
 * §352 : Marteau de tonnerre (reporté du lot O8b). Arène de test (Guerrier, Zombi, Clerc). Le Zombi à 3 cases à l'est du Guerrier, le
 * Clerc 2 cases plus loin (à 9 m du Zombi). Le Marteau est posé sur un Maillet d'armes du Guerrier.
 *  1. « Hurl Hammer » qui touche le Zombi : le Zombi et le Clerc font chacun une sauvegarde de Constitution DD 17, pas le Guerrier ;
 *     une sauvegarde réussie ne laisse pas d'Étourdi (celui, sans sauvegarde, des données ne passe pas), une ratée en pose un.
 *  2. Un coup de Maillet au corps à corps qui touche : aucune sauvegarde.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-marteau — Marteau de tonnerre : coup de tonnerre autour de la cible touchée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi", "Clerc"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Zombi ou Clerc absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + 3 * g, at.y], Clerc: [at.x + 5 * g, at.y] } });
    const [zombi, cleric] = await Promise.all(["Zombi", "Clerc"].map(n => ctx.token(n)));
    const hpZ = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hpZ));
    // Le coup de tonnerre prend toutes les créatures de l'Arène à 9 m : l'Étourdi est retiré de chacune.
    const unstun = async () => { for ( const t of await ctx.liveTokens() ) if ( t.actorId ) await ctx.removeStatusEffects(t, "stunned").catch(() => {}); };
    ctx.restore(unstun);
    const stunned = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses?.includes("stunned") ?? false;

    const hammer = await ctx.ensureItem(fighter, `${DMG}dmgHammerOfThund`);
    const maul = await ctx.ensureItem(fighter, `${PHB}phbwepMaul000000`);
    const done = await ctx.engine("enchant", { tokenId: fighter.id, itemId: hammer, activityId: "sOG5DXs2HNhx1U5m", targetItemId: maul,
      profile: "RSpASIW4HbToM7yC" }).catch(err => ({ error: err.message }));
    if ( !ctx.expect(!!done?.effectId && (done.riders > 0), `le Marteau de tonnerre est posé sur le Maillet (${done?.error ?? `${done?.riders} ajout(s)`})`) ) return;
    const data = await ctx.engine("itemData", { tokenId: fighter.id, itemId: maul, paths: ["system.activities"] });
    const activities = Object.values(data?.["system.activities"] ?? {});
    const hurl = activities.find(a => (a.type === "attack") && (a.attack?.type?.value === "ranged"))?._id;
    const swing = activities.find(a => (a.type === "attack") && (a.attack?.type?.value !== "ranged"))?._id;
    if ( !ctx.expect(!!hurl && !!swing, `activités du Maillet : lancer ${hurl ?? "?"}, frappe ${swing ?? "?"}`) ) return;

    /** Attaque jusqu'au toucher ; rend les lignes du journal de cette attaque. */
    const hit = async activityId => {
      for ( let i = 0; i < 15; i++ ) {
        await ctx.setHp(zombi, hpZ);
        await unstun();
        const before = (await ctx.engineLog()).length;
        const used = await ctx.use({ tokenId: fighter.id, itemId: maul, activityId, consume: false, targetTokenIds: [zombi.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Zombi")?.hit !== true ) continue;
        await pause(5000);
        return (await ctx.engineLog()).slice(before);
      }
      return null;
    };

    // 1. Lancer.
    const lines = await hit(hurl);
    if ( !ctx.expect(!!lines, "le Marteau lancé touche le Zombi") ) return;
    const save = name => lines.find(l => l.includes(`: ${name} con saving throw`));
    for ( const l of lines.filter(l => /saving throw|receives/.test(l)) ) ctx.log(l);
    ctx.expect(!!save("Zombi") && !!save("Clerc"), "le Zombi et le Clerc (à 9 m) font chacun la sauvegarde de Constitution DD 17");
    ctx.expect(!save("Guerrier"), "le lanceur ne fait pas de sauvegarde");
    for ( const [name, token] of [["Zombi", zombi], ["Clerc", cleric]] ) {
      const line = save(name);
      if ( !line ) continue;
      const failed = /failed$/.test(line);
      ctx.expect((await stunned(token)) === failed, `${name} : sauvegarde ${failed ? "ratée → Étourdi" : "réussie → pas d'Étourdi"}`);
    }

    // 2. Frappe au corps à corps : le Zombi au contact.
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + g, y: at.y, elevation: 0 });
    await pause(800);
    const melee = await hit(swing);
    if ( ctx.expect(!!melee, "le Maillet touche le Zombi au corps à corps") ) {
      ctx.expect(!melee.some(l => /con saving throw/.test(l)), "au corps à corps : aucune sauvegarde");
    }
  }
};
