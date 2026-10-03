/**
 * Brique « dégâts bonus » (B2, SPEC §16, écrite en 0.31.0, vérifiée ici) sur deux déclarations de l'inventaire :
 *  - Maître d'armes lourdes (`great-weapon-master`, PHB) : le Guerrier touche le Zombi à l'épée à deux mains (Lourde) →
 *    le jet de dégâts porte en plus son bonus de maîtrise, du type de l'arme ;
 *  - Voile spirituel (`spirit-shroud`, Tasha : absent de `dnd-6`) : un item minimal portant cet identifiant et un effet
 *    transféré au Magicien — c'est tout ce que lit la déclaration (`source.hasEffect`) — puis Rayon de givre sur le Zombi à
 *    5 ft → +1d8 nécrotique ; le même tir à 15 ft ne le porte pas.
 * Les jets sont aléatoires : on rejoue jusqu'à toucher.
 */
export default {
  name: "dégâts bonus — Maître d'armes lourdes (+ maîtrise), Voile spirituel (+1d8 nécrotique à 10 ft)",

  async run(ctx) {
    const warrior = await ctx.token("Guerrier");
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));

    /** Tire jusqu'à toucher ; rend la résolution et la formule du jet de dégâts. */
    const hitWith = async (token, identifier, activityType) => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: token.id, identifier, activityType, targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId);
        const target = r.targets.find(t => t.name === "Zombi");
        if ( !target?.hit ) continue;
        const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
        // Les dégâts bonus s'ajoutent comme un jet à part dans le même message (runtime/triggers.mjs) : tous les jets.
        return { r, target, formula: (damage?.rolls ?? []).map(x => x.formula).join(" | "), damages: r.damageRoll?.damages ?? [] };
      }
      return null;
    };

    // --- Maître d'armes lourdes -------------------------------------------------------------------------------------
    await ctx.ensureItem(warrior, "Compendium.dnd-players-handbook.feats.Item.phbftGreatWeapon");
    const wPos = await ctx.position(warrior);
    await ctx.call("move-token", { tokenId: zombi.id, x: wPos.x + grid, y: wPos.y, elevation: wPos.elevation });
    const prof = (await ctx.call("get-actor", { actorId: warrior.actorId })).system?.attributes?.prof ?? 2;
    const gwm = await hitWith(warrior, "greatsword", "attack");
    if ( !gwm ) ctx.expect(false, "Maître d'armes lourdes : aucun toucher en 20 essais");
    else ctx.expect(gwm.formula.split(" | ").slice(1).some(f => f.trim() === String(prof)),
      `Maître d'armes lourdes : un jet de + ${prof} (bonus de maîtrise) s'ajoute — « ${gwm.formula} »`);

    // --- Voile spirituel -----------------------------------------------------------------------------------------
    const itemData = {
      name: "Voile spirituel (scénario)", type: "feat", img: "icons/svg/aura.svg",
      system: { identifier: "spirit-shroud" },
      effects: [{ name: "Voile spirituel", img: "icons/svg/aura.svg", transfer: true, disabled: false, changes: [] }]
    };
    const up = await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "system.identifier", value: "spirit-shroud" } });
    const shroudId = up.itemId ?? up.id ?? up.item?._id ?? await ctx.itemId(mage.id, "spirit-shroud");
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: shroudId }).catch(() => {}));
    const mPos = await ctx.position(mage);
    await ctx.call("move-token", { tokenId: zombi.id, x: mPos.x - grid, y: mPos.y, elevation: mPos.elevation });
    const near = await hitWith(mage, "ray-of-frost", "attack");
    if ( !near ) ctx.expect(false, "Voile spirituel : aucun toucher à 5 ft en 20 essais");
    else ctx.expect(near.damages.some(d => d.type === "necrotic") || /necrotic/.test(near.formula),
      `Voile spirituel à 5 ft : dégâts nécrotiques ajoutés (${JSON.stringify(near.damages.map(d => d.type))}, « ${near.formula} »)`);
    await ctx.call("move-token", { tokenId: zombi.id, x: mPos.x - 3 * grid, y: mPos.y, elevation: mPos.elevation });
    const far = await hitWith(mage, "ray-of-frost", "attack");
    if ( !far ) ctx.expect(false, "Voile spirituel : aucun toucher à 15 ft en 20 essais");
    else ctx.expect(!far.damages.some(d => d.type === "necrotic") && !/necrotic/.test(far.formula),
      `Voile spirituel à 15 ft : rien d'ajouté (${JSON.stringify(far.damages.map(d => d.type))})`);
  }
};
