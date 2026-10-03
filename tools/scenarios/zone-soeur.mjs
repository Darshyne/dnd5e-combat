/**
 * Brique « zone qui dure, activité sœur » (SPEC §16) : Nuage nauséabond (ajouté au Magicien le temps du
 * scénario). « Créer un nuage » (utilitaire, sans effet) pose la sphère sur le Guerrier ; rien à résoudre à la
 * pose. En combat, quand le Guerrier COMMENCE son tour dedans, le moteur rejoue la sœur « Sauvegarde de début de
 * tour » (`replay` avec `activity`) : sauvegarde de Constitution, Empoisonné sur un échec.
 * Sur le Guerrier, pas le Zombi : immunisé contre Empoisonné, le Zombi n'est pas affecté par le nuage (§16.8).
 * Contenu `stinking-cloud` : `{ on: "turnStart", do: [{ type: "replay", activity: "dnd5eactivity000" }] }`.
 */
export default {
  name: "zone à activité sœur — Nuage nauséabond, début de tour du Guerrier dedans",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Guerrier");   // PJ sans joueur : le moteur jette pour lui
    ctx.restore(() => ctx.removeStatusEffects(guerrier, "poisoned"));
    ctx.restore(async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplStinkingCl");

    const box = await ctx.box(guerrier);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const used = await ctx.use({ tokenId: mage.id, identifier: "stinking-cloud", activityType: "utility", area: { shape: "circle", ...centre, radius: box.width } });
    ctx.expect(used.used && !!used.regionId, "nuage posé sur le Guerrier par l'activité utilitaire");
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    await new Promise(res => setTimeout(res, 2000));
    const region = used.regionId ? (await ctx.call("get-scene-object", { type: "Region", objectId: used.regionId })).data : null;
    const state = region?.flags?.["dnd5e-combat"]?.area;
    ctx.expect(!!state?.usage && state.activity === "dnd5eactivity000", `zone retenue comme zone qui dure, sœur à rejouer (${JSON.stringify(state && { on: state.on, activity: state.activity })})`);
    ctx.expect(!(await ctx.resolution(used.usageMessageId)), "rien à résoudre à la pose (l'utilitaire n'a pas de plan)");

    await ctx.startCombat([mage, guerrier]);
    let replayed = null;
    for ( let i = 0; i < 4 && !replayed; i++ ) {
      await ctx.nextTurn();
      await new Promise(res => setTimeout(res, 2500));
      const messages = await ctx.messagesSince(used.usageMessageId);
      replayed = messages.find(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick ?? m.flags?.areaTick)?.event === "turnStart");
    }
    ctx.expect(!!replayed, "début du tour du Guerrier dans le nuage : la sœur a rejoué (areaTick turnStart)");
    if ( !replayed ) return;
    const r = await ctx.settle(replayed.id);
    ctx.expect(r.step === "done", `résolution du rejeu tranchée (« ${r.step} »)`);
    ctx.expect(r.plan.save?.ability === "con", `c'est la sauvegarde de Constitution de la sœur (${r.plan.save?.ability} DD ${r.plan.save?.dc})`);
    const t = r.targets.find(x => x.name === "Guerrier");
    ctx.expect(!!t?.save && (t.save.success === (t.save.total >= r.plan.save.dc)), `sauvegarde ${t?.save?.total} : ${t?.save?.success ? "réussie" : "ratée"}`);
    await new Promise(res => setTimeout(res, 800));
    const poisoned = (await ctx.effects(guerrier)).some(e => (e.statuses ?? []).includes("poisoned"));
    ctx.expect(poisoned === !t?.save?.success, `Empoisonné ${poisoned ? "posé" : "absent"}, cohérent avec la sauvegarde`);
  }
};
