/**
 * Zone « sur soi » posée d'office (§47) : Esprits gardiens (PHB), prêté au lanceur (Alara dans `ravenloft`, sinon le Magicien),
 * utilisé comme au clic — pose de dnd5e comprise (`api.mcp.use`, pas `use-activity` du connecteur qui la coupe). dnd5e ouvre sa
 * fenêtre pour le niveau du sort, mais sans la case « Placer le gabarit ». Sans le moteur, dnd5e attendrait un clic sur un token ;
 * ici l'émanation naît d'elle-même, rattachée au lanceur, et la résolution suit (le Zombi, déplacé à côté, sauvegarde).
 * Le même geste pour une capacité de créature (émanation sans emplacement) se joue dans le dépôt du module qui la livre.
 */
export default {
  name: "zone sur soi — émanation posée sur le lanceur sans clic (Esprits gardiens)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const caster = tokens.find(t => t.name === "Alara") ?? tokens.find(t => t.name === "Magicien");
    if ( !caster || !tokens.some(t => t.name === "Zombi") ) { ctx.log("Alara ou Magicien, et Zombi, absents : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    const itemId = await ctx.ensureItem(caster, "Compendium.dnd-players-handbook.spells.Item.phbsplSpiritGuar");
    const cPos = await ctx.position(caster);
    await ctx.call("move-token", { tokenId: zombi.id, x: cPos.x - 2 * grid, y: cPos.y, elevation: cPos.elevation });
    await ctx.setHp(zombi, 100);

    const used = await ctx.engine("use", { tokenId: caster.id, itemId, activityType: "save" });
    for ( const r of used.regions ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    ctx.restore(async () => {
      const actor = await ctx.call("get-actor", { actorId: caster.actorId });
      for ( const e of (actor.effects ?? []).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${caster.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });

    ctx.expect(!used.dialog?.templateBox, used.dialog ? "fenêtre du niveau de sort, sans case « Placer le gabarit »" : "aucune fenêtre de dnd5e");
    const [region] = used.regions;
    ctx.expect(used.regions.length === 1, `une zone posée sans clic (${used.regions.length})`);
    if ( !region ) return;
    ctx.expect(region.shapes.join() === "emanation", `forme : émanation (${region.shapes.join()})`);
    ctx.expect(region.attachedTo === caster.id, `rattachée à ${caster.name}`);
    ctx.expect(Number.isFinite(region.elevation.bottom) && Number.isFinite(region.elevation.top),
      `tranche d'élévation posée (${region.elevation.bottom} → ${region.elevation.top})`);

    if ( !used.messageId ) return;
    const cast = await ctx.settle(used.messageId);
    const z = cast.targets.find(t => t.name === "Zombi");
    ctx.expect(!!z?.save, `le Zombi, à deux cases, sauvegarde (${z?.save?.total ?? "—"}, ${z?.damage?.applied ?? 0} dégâts)`);
    ctx.expect(!cast.targets.some(t => t.name === caster.name), "le lanceur n'est pas affecté");
  }
};
