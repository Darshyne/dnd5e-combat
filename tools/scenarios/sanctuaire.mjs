/**
 * Porte « isAttacked » (SPEC §16, B5 bis) : Sanctuaire (module PHB, donné au Magicien le temps du scénario)
 * lancé sur lui-même ; le Zombi l'attaque → sur le client de l'attaquant, sauvegarde de Sagesse contre le DD du
 * Magicien ; ratée → l'attaque n'a pas lieu ; réussie → elle part. On rejoue jusqu'à voir les deux issues.
 */
export default {
  name: "sanctuaire — le Zombi doit réussir une sauvegarde pour attaquer le Magicien",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(mage);
    ctx.restore(() => ctx.setHp(mage, hp0));
    // Le Zombi au contact du Magicien : un coup au contact à 20 ft n'est pas une attaque, c'est un dialogue de portée.
    const grid = await ctx.gridSize();
    const zHome = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    await ctx.call("move-token", { tokenId: zombi.id, x: magePos.x - grid, y: magePos.y, elevation: zHome.elevation });
    await new Promise(r => setTimeout(r, 800));
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbSanctuary0000");
    const cast = await ctx.use({ tokenId: mage.id, identifier: "sanctuary", activityType: "utility", targetTokenIds: [mage.id] });
    await ctx.settle(cast.usageMessageId).catch(() => null);
    await new Promise(r => setTimeout(r, 1500));
    const shielded = (await ctx.effects(mage)).some(e => /prot[ée]g|sanctu/i.test(e.name ?? ""));
    ctx.expect(shielded, `« Protégé » posé sur le Magicien (${(await ctx.effects(mage)).map(e => e.name).join(", ")})`);
    ctx.restore(async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => /prot[ée]g|sanctu/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    if ( !shielded ) return;
    const items = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    ctx.expect(!!weapon, `le Zombi a une attaque (${weapon?.system?.identifier})`);
    if ( !weapon ) return;

    const seen = { lost: false, passed: false };
    for ( let i = 0; i < 20 && !(seen.lost && seen.passed); i++ ) {
      await ctx.setHp(mage, hp0);
      const before = await ctx.lastMessageId();
      await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [mage.id] });
      let gate = null;
      for ( const until = Date.now() + 30000; Date.now() < until && !gate; ) {
        await new Promise(r => setTimeout(r, 700));
        const messages = await ctx.messagesSince(before);
        gate = messages.map(m => m.flags?.["dnd5e-combat"]?.gate ?? m.flags?.gate).find(g => g?.kind === "ward") ?? null;
      }
      if ( !gate ) { ctx.expect(false, "aucune carte de porte : la sauvegarde de l'attaquant n'a pas été demandée"); return; }
      ctx.expect(gate.passed === (gate.total >= gate.dc), `sauvegarde de Sagesse du Zombi ${gate.total} contre DD ${gate.dc} : ${gate.passed ? "réussie" : "ratée"}`);
      await new Promise(r => setTimeout(r, 2500));
      const attack = (await ctx.messagesSince(before)).find(m => m.type === "attack");
      if ( gate.passed ) { ctx.expect(!!attack, "réussie : l'attaque a eu lieu"); seen.passed = true; }
      else { ctx.expect(!attack, "ratée : aucun jet d'attaque, l'attaque est perdue"); seen.lost = true; }
    }
    ctx.expect(seen.lost && seen.passed, `les deux issues vues (perdue : ${seen.lost}, tenue : ${seen.passed})`);
  }
};
