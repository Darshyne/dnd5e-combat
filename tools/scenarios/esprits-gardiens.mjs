/**
 * Zone qui dure (B1, déclarée depuis 0.6.0, vérifiée ici) : Esprits gardiens (PHB, ajouté au Magicien le temps du
 * scénario, sans emplacement) — émanation de 15 ft ; « chaque fois que l'émanation entre dans l'espace d'une créature et
 * chaque fois qu'une créature y entre ou y termine son tour », sauvegarde de Sagesse, une fois par tour. Contenu :
 * `{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }`. La zone est posée par l'outil du connecteur (un cercle
 * centré sur le Magicien) ; le Zombi à deux cases la subit à la pose, puis en finissant son tour dedans.
 * §438 : Manuel 3.0.0 — l'émanation est posée par l'activité utilitaire « Cast Spell » (`tevaatMC9LZxVPLS`), la sauvegarde est une activité
 * sœur sans zone : à la pose, ceux qu'elle recouvre « entrent » (`enterOnPose`) et la sœur est rejouée sur eux.
 */
export default {
  name: "esprits gardiens — à la pose, puis fin de tour du Zombi dans l'émanation",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    const spellId = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplSpiritGuar");
    const spell = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => (i._id === spellId) || (i.system?.identifier === "spirit-guardians"));
    const v3 = !!spell?.system?.activities?.tevaatMC9LZxVPLS;
    if ( v3 ) ctx.log("forme 3.0.0 : zone posée par « Cast Spell », sauvegarde rejouée à la pose");
    const mPos = await ctx.position(mage);
    await ctx.call("move-token", { tokenId: zombi.id, x: mPos.x - 2 * grid, y: mPos.y, elevation: mPos.elevation });
    await ctx.setHp(zombi, 100);

    const center = { x: mPos.x + grid / 2, y: mPos.y + grid / 2 };
    const used = await ctx.use({ tokenId: mage.id, identifier: "spirit-guardians", ...(v3 ? { activityId: "tevaatMC9LZxVPLS" } : { activityType: "save" }), consume: false,
      area: { shape: "circle", ...center, radius: 3.5 * grid } });
    ctx.expect(used.used && !!used.regionId, "Esprits gardiens posés");
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    ctx.restore(async () => {
      const actor = await ctx.call("get-actor", { actorId: mage.actorId });
      for ( const e of (actor.effects ?? []).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    // Forme 3.0.0 : « Cast Spell » ne résout rien (aucune cible, aucun jet) ; seuls les rejeux comptent.
    let cast = v3 ? { targets: [] } : await ctx.settle(used.usageMessageId);
    if ( v3 ) {
      // La pose ne résout rien : les sauvegardes sont les rejeux « enter » de la sœur, une carte par créature recouverte.
      await new Promise(r => setTimeout(r, 3000));
      const ticks = (await ctx.messagesSince(used.usageMessageId)).filter(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick?.event === "enter"));
      const targets = [];
      for ( const m of ticks ) targets.push(...((await ctx.settle(m.id).catch(() => null))?.targets ?? []));
      cast = { targets };
    }
    const atCast = cast.targets.find(t => t.name === "Zombi");
    ctx.expect(!!atCast?.save, `à la pose, le Zombi fait sa sauvegarde (${atCast?.save?.total ?? "—"}, ${atCast?.damage?.applied ?? 0} dégâts)`);
    ctx.expect(!cast.targets.some(t => t.name === "Magicien"), "le lanceur n'est pas affecté");
    // « Vous pouvez désigner des créatures qui ne sont pas affectées » : le moteur épargne les alliés (§16.23).
    ctx.expect(!cast.targets.some(t => ["Guerrier", "Paladin", "Clerc", "Roublard", "Occultiste", "Ensorceleur"].includes(t.name)),
      `aucun allié du Magicien affecté (${cast.targets.map(t => t.name).join(", ")})`);

    const since = used.usageMessageId;
    await ctx.startCombat([mage, zombi]);
    let replayed = null;
    for ( let i = 0; i < 4 && !replayed; i++ ) {
      await ctx.nextTurn();
      await new Promise(r => setTimeout(r, 2500));
      replayed = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick?.event === "turnEnd"));
    }
    ctx.expect(!!replayed, "fin du tour du Zombi dans l'émanation : l'activité rejoue");
    if ( !replayed ) return;
    const r = await ctx.settle(replayed.id);
    const t = r.targets.find(x => x.name === "Zombi");
    ctx.expect(!!t?.save && (t.save.success === (t.save.total >= r.plan.save.dc)), `sauvegarde ${t?.save?.total} contre DD ${r.plan.save.dc}`);
  }
};
