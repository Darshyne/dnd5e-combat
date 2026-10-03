/**
 * Zone qui dure : Rayon de lune du Magicien posé sur un Zombi, puis un combat où le Zombi finit
 * son tour dedans → le moteur rejoue le sort contre lui (déclencheur `turnEnd`, contenu
 * `moonbeam`) : sauvegarde lancée par le moteur, dégâts, PV cohérents. La pose elle-même ne fait
 * rien (personne n'entre) ; la zone reste tant que la concentration tient.
 */
export default {
  name: "zone qui dure — Rayon de lune, fin de tour du Zombi dedans",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    const box = await ctx.box(zombi);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const used = await ctx.use({ tokenId: mage.id, identifier: "moonbeam", activityType: "save", area: { shape: "circle", ...centre, radius: box.width } });
    ctx.expect(used.used && !!used.regionId, "Rayon de lune posé sur le Zombi");
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    // La concentration posée sur le Magicien est retirée en fin de scénario (elle tient la zone).
    ctx.restore(async () => {
      const actor = await ctx.call("get-actor", { actorId: mage.actorId });
      const effects = actor.effects ?? actor.actor?.effects ?? [];
      for ( const e of effects.filter(e => /concentr/i.test(e.name ?? "")) ) {   // « Concentré: … » en FR, « Concentrating: … » en EN
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });

    // À la pose, la zone agit sur ceux qu'elle recouvre déjà (SPEC §11, 0.3.0 : « Zombi et lanceur
    // déjà touchés non rejoués ») : le Zombi subit la sauvegarde une première fois.
    const since = used.usageMessageId;
    const cast = await ctx.settle(since);
    const hitAtCast = cast.targets.find(t => t.name === "Zombi");
    ctx.expect(cast.step === "done" && !!hitAtCast, `la pose agit sur le Zombi déjà dedans (sauvegarde ${hitAtCast?.save?.total}, ${hitAtCast?.damage?.applied ?? 0} PV)`);
    const atCast = hitAtCast?.damage?.applied ?? 0;

    await ctx.startCombat([mage, zombi]);
    // Deux tours : celui du Magicien, puis celui du Zombi ; à sa fin, le sort rejoue contre lui.
    let replayed = null;
    for ( let i = 0; i < 4 && !replayed; i++ ) {
      await ctx.nextTurn();
      await new Promise(r => setTimeout(r, 2500));
      const messages = await ctx.messagesSince(since);
      replayed = messages.find(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick ?? m.flags?.areaTick));
    }
    ctx.expect(!!replayed, "fin du tour du Zombi dans la zone : le sort a rejoué (message d'utilisation marqué areaTick)");
    if ( !replayed ) return;

    const r = await ctx.settle(replayed.id);
    ctx.expect(r.step === "done", `résolution du rejeu tranchée (« ${r.step} »)`);
    const target = r.targets.find(t => t.name === "Zombi");
    ctx.expect(!!target, `le Zombi est la cible du rejeu (${r.targets.map(t => t.name).join(", ")})`);
    if ( !target ) return;
    const { dc } = r.plan.save;
    ctx.expect(target.save?.total !== null && target.save?.success === (target.save?.total >= dc), `sauvegarde ${target.save?.total} contre DD ${dc} : ${target.save?.success ? "réussie" : "ratée"}`);
    const after = await ctx.hp(zombi);
    const total = atCast + (target.damage?.applied ?? 0);
    ctx.expect(hp0 - after === total, `PV lus sur le token ${hp0} → ${after}, = ${atCast} (pose) + ${target.damage?.applied ?? 0} (rejeu)`);
  }
};
