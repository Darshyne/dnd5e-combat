/**
 * §268 : Protection contre le Mal et le Bien — « la cible ne peut être Charmée ni Effrayée par elles » (aberrations, célestes,
 * élémentaires, fées, fiélons, morts-vivants). Le Magicien protège le Guerrier ; le Mage (PNJ), donné pour fiélon le temps du test,
 * lui lance Charme-personne : le Guerrier n'est pas affecté. Redevenu humanoïde, le Mage le charme sur une sauvegarde ratée.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Protection contre le Mal et le Bien — ni Charmé ni Effrayé par un fiélon",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Guerrier", "Mage"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Guerrier, Mage requis : non applicable"); return; }
    const [magicien, guerrier, mage] = await Promise.all(["Magicien", "Guerrier", "Mage"].map(n => ctx.token(n)));
    const { data: m0 } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const type0 = m0.delta?.system?.details?.type?.value ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: mage.id,
      data: type0 === null ? { "delta.system.details.type.-=value": null } : { "delta.system.details.type.value": type0 } }).catch(() => {}));
    const setType = value => ctx.call("update-scene-object", { type: "Token", objectId: mage.id, data: { "delta.system.details.type.value": value } });
    ctx.restore(() => ctx.removeEffectsFrom(guerrier, "protection-from-evil-and-good", "charm-person"));
    ctx.restore(() => ctx.removeStatusEffects(guerrier, "charmed"));
    for ( const t of [magicien, mage] ) ctx.restore(async () => {
      for ( const e of (await ctx.effects(t)).filter(e => (e.statuses ?? []).includes("concentrating")) ) {
        await ctx.call("remove-embedded-effect", { uuid: (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.actorLink ? `Actor.${t.actorId}` : `Scene.${(await ctx.scene()).sceneId}.Token.${t.id}.Actor.${t.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });

    await ctx.ensureItem(magicien, "Compendium.dnd-players-handbook.spells.Item.phbEvilAndGoodPr", { system: { method: "atwill" } });
    await ctx.use({ tokenId: magicien.id, identifier: "protection-from-evil-and-good", targetTokenIds: [guerrier.id] });
    await pause(2000);
    if ( !ctx.expect((await ctx.effectsFrom(guerrier, "protection-from-evil-and-good")).length > 0, "le Guerrier est protégé") ) return;

    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplCharmPerso", { system: { method: "atwill" } });
    await setType("fiend");
    await pause(800);
    let used = await ctx.use({ tokenId: mage.id, identifier: "charm-person", activityType: "save", targetTokenIds: [guerrier.id] });
    let r = await ctx.settle(used.usageMessageId).catch(() => null);
    let t = r?.targets?.find(x => x.name === "Guerrier");
    ctx.expect(t?.unaffected?.reason === "immune", `Mage fiélon : le Guerrier n'est pas affecté (${t?.unaffected?.reason ?? (t?.save ? "sauvegarde jouée" : "?")})`);
    await pause(1500);
    ctx.expect(!(await ctx.effects(guerrier)).some(e => (e.statuses ?? []).includes("charmed")), "pas Charmé");

    await setType("humanoid");
    await pause(800);
    let charmed = false;
    for ( let i = 0; (i < 15) && !charmed; i++ ) {
      used = await ctx.use({ tokenId: mage.id, identifier: "charm-person", activityType: "save", targetTokenIds: [guerrier.id] });
      r = await ctx.settle(used.usageMessageId).catch(() => null);
      t = r?.targets?.find(x => x.name === "Guerrier");
      if ( t?.save && !t.save.success ) { await pause(1500); charmed = (await ctx.effects(guerrier)).some(e => (e.statuses ?? []).includes("charmed")); break; }
    }
    ctx.expect(charmed, "Mage humanoïde : sauvegarde ratée, le Guerrier est Charmé");
  }
};
