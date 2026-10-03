/**
 * M6 (SPEC §18.9) — Résistance à la magie et Résistance légendaire. Monde `ravenloft` : Alara lance Flamme sacrée (sauvegarde
 * de Dextérité, un sort) sur le Zombi, qui jette par le moteur.
 *  1. Résistance à la magie (item du Balor, prêté au Zombi) : sa sauvegarde se jette avec l'avantage (2d20) ; sans l'item, 1d20.
 *  2. Résistance légendaire (2 posées sur le token du Zombi) : consigne `legendary: "never"` — l'échec reste, les dégâts
 *     passent, rien n'est dépensé ; consigne `legendary: "always"` — l'échec devient une réussite (Flamme sacrée : pas de
 *     dégâts), une résistance dépensée (par la méthode du système).
 * Le réglage de monde (demander au MJ) n'est pas touché : la consigne d'intention prime. Les jets sont aléatoires : on
 * rejoue jusqu'à un échec (20 essais au plus).
 */
const MODULE_ID = "dnd5e-combat";
const BALOR = "Compendium.dnd-monster-manual.actors.Actor.mmBalor000000000";

export default {
  name: "résistances — à la magie, légendaire",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Alara", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Alara ou le Zombi absent : non applicable"); return; }
    const alara = await ctx.token("Alara");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const legres0 = tok.delta?.system?.resources?.legres ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
      data: { "delta.system.resources.legres": legres0 ?? { max: 0, spent: 0 } } }).catch(() => {}));

    /** Flamme sacrée sur le Zombi ; rend la résolution et le message de sauvegarde. */
    const flame = async (extra={}) => {
      await ctx.setHp(zombi, 100);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: alara.id, identifier: "sacred-flame", activityType: "save", targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: extra } });
      const r = await ctx.settle(used.usageMessageId);
      const save = (await ctx.messagesSince(since)).find(m => m.type === "save");
      return { r, save, target: r.targets.find(t => t.token?.endsWith(zombi.id)) };
    };
    const formula = s => s?.rolls?.[0]?.formula ?? "";

    // 1. Résistance à la magie.
    const plain = await flame();
    ctx.expect(/^1d20/.test(formula(plain.save)), `sans Résistance à la magie : 1d20 (${formula(plain.save)})`);
    const { data: balor } = await ctx.call("get-compendium-entry", { uuid: BALOR });
    const { _id, folder, ownership, _stats, ...itemData } = balor.items.find(i => i.system?.identifier === "magic-resistance");
    const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "magic-resistance" } });
    const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(zombi.id, "magic-resistance"));
    const removeMr = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {});
    ctx.restore(removeMr);
    const resisted = await flame();
    ctx.expect(/^2d20/.test(formula(resisted.save)), `avec Résistance à la magie : avantage (${formula(resisted.save)})`);
    await removeMr();

    // 2. Résistance légendaire.
    await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.resources.legres": { max: 2, spent: 0 } } });
    const spent = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id })).data.delta?.system?.resources?.legres?.spent ?? 0;

    ctx.log(`Résistances légendaires posées : dépensées ${await spent()}`);
    let kept = null;
    for ( let i = 0; (i < 20) && !(kept?.target?.save && !kept.target.save.success); i++ ) kept = await flame({ legendary: "never" });
    if ( ctx.expect(kept?.target?.save?.success === false, `consigne « never » : sauvegarde ratée (${kept?.target?.save?.total} contre DD ${kept?.r?.plan?.save?.dc})`) ) {
      ctx.expect((kept.target.damage?.applied ?? 0) > 0, `les dégâts passent (${kept.target.damage?.applied})`);
      ctx.expect((await spent()) === 0, "aucune résistance dépensée");
    }

    let saved = null;
    for ( let i = 0; (i < 20) && !saved?.target?.save?.resisted; i++ ) saved = await flame({ legendary: "always" });
    if ( ctx.expect(saved?.target?.save?.resisted === true, `consigne « always » : l'échec (${saved?.target?.save?.total} contre DD ${saved?.r?.plan?.save?.dc}) devient une réussite`) ) {
      ctx.expect(saved.target.save.success === true, "la résolution compte la sauvegarde réussie");
      ctx.expect(!(saved.target.damage?.applied > 0), `Flamme sacrée : pas de dégâts (${saved.target.damage?.applied ?? 0})`);
      ctx.expect((await spent()) === 1, `une résistance dépensée (${await spent()})`);
    }
  }
};
