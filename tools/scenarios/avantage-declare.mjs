/**
 * Brique « avantage conditionnel » (SPEC §16, B6), moment `preAttackRoll` : les raisons déclarées par le contenu
 * rejoignent celles des états, sous le jet (flag `modifiers`, raison `content.<nom de l'item>`).
 *  1. Tactique de meute (capacité du MM, ajoutée au Magicien le temps du scénario) : le Guerrier (allié du Magicien) est amené au
 *     contact du Zombi, le Magicien l'attaque à distance (Rayon de givre) → avantage « Tactique de meute ».
 *     Le Guerrier ramené à sa place → plus d'avantage.
 *  2. Lueurs féeriques (ajoutées au Magicien) sur le Zombi jusqu'à un échec (effet « Nimbée »), puis Rayon de
 *     givre → avantage « Lueurs féeriques » (porté par l'effet de la cible), et la concentration retirée → plus rien.
 */
export default {
  name: "avantage déclaré — Tactique de meute (allié au contact), Lueurs féeriques (effet sur la cible)",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const barbare = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const barbHome = await ctx.position(barbare);
    ctx.restore(() => ctx.call("move-token", { tokenId: barbare.id, x: barbHome.x, y: barbHome.y, elevation: barbHome.elevation }).catch(() => {}));
    // Le Zombi sur une case isolée : à sa place habituelle, le Guerrier est en diagonale à 5 ft, et Tactique de meute
    // s'applique même sans l'allié (vu le 2026-09-24 : le moteur avait raison, pas le scénario).
    const zHome = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    // Trois cases sous le Magicien (colonne libre de Restored Keep) : à quatre, la case touche en diagonale celle du Paladin
    // (3220 × 5460), dont la Tactique de meute tient à bon droit (vu le 2026-09-28).
    const zPos = { x: magePos.x, y: magePos.y + 3 * grid, elevation: zHome.elevation };
    await ctx.call("move-token", { tokenId: zombi.id, ...zPos });
    await new Promise(r => setTimeout(r, 800));

    /** Attaque du Magicien sur le Zombi ; rend les raisons consignées sous le jet. */
    const attack = async () => {
      await ctx.setHp(zombi, hp0);
      const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId);
      const messages = await ctx.messagesSince(used.usageMessageId);
      const attackMessage = messages.find(m => m.type === "attack");
      const flags = attackMessage?.flags ?? {};
      return flags["dnd5e-combat"]?.modifiers ?? flags.modifiers ?? { advantage: [], disadvantage: [] };
    };
    const names = list => (list ?? []).map(r => `${r.who}.${r.key}`).join(", ") || "aucune";

    // 1. Tactique de meute
    await ctx.ensureItem(mage, "Compendium.dnd-monster-manual.features.Item.mmPackTactics000");
    await ctx.call("move-token", { tokenId: barbare.id, x: zPos.x + grid, y: zPos.y, elevation: zPos.elevation });
    await new Promise(r => setTimeout(r, 800));
    let m = await attack();
    ctx.expect((m.advantage ?? []).some(r => r.who === "content"), `Guerrier au contact du Zombi : avantage déclaré (${names(m.advantage)})`);
    // Loin : cinq cases à l'est du Zombi (sa place habituelle est en diagonale du Zombi, vu le 2026-09-25).
    await ctx.call("move-token", { tokenId: barbare.id, x: zPos.x + 5 * grid, y: zPos.y, elevation: zPos.elevation });
    await new Promise(r => setTimeout(r, 800));
    m = await attack();
    ctx.expect(!(m.advantage ?? []).some(r => r.who === "content"), `Guerrier loin : plus d'avantage déclaré (${names(m.advantage)})`);

    // 2. Lueurs féeriques
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplFaerieFire");
    ctx.restore(async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    let lit = false;
    for ( let i = 0; i < 20 && !lit; i++ ) {
      const box = await ctx.box(zombi);
      const used = await ctx.use({ tokenId: mage.id, identifier: "faerie-fire", activityType: "save", area: { shape: "rectangle", ...box } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.name === "Zombi");
      if ( !t?.save ) { ctx.expect(false, "le Zombi n'est pas dans le cube"); return; }
      lit = t.save.success === false;
    }
    if ( !lit ) { ctx.expect(false, "aucun échec de sauvegarde en 20 essais"); return; }
    await new Promise(r => setTimeout(r, 800));
    const effects = await ctx.effects(zombi);
    ctx.expect(effects.length > 0, `effet de Lueurs féeriques posé sur le Zombi (${effects.map(e => e.name).join(", ")})`);
    m = await attack();
    ctx.expect((m.advantage ?? []).some(r => r.who === "content"), `cible nimbée : avantage déclaré (${names(m.advantage)})`);
    // La concentration tombe → l'effet aussi → plus d'avantage.
    for ( const e of (await ctx.effects(mage)).filter(e => /concentr/i.test(e.name ?? "")) ) {
      await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 1000));
    m = await attack();
    ctx.expect(!(m.advantage ?? []).some(r => r.who === "content"), `concentration tombée : plus d'avantage déclaré (${names(m.advantage)})`);
  }
};
