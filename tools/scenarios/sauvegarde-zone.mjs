/**
 * Sort de zone à sauvegarde, instantané : Mains brûlantes de l'Ensorceleur, zone posée sur le
 * Zombi (PNJ : le moteur lance sa sauvegarde lui-même). Sauvegarde réussie ⇔ jet ≥ DD ; dégâts
 * réduits de moitié sur une réussite ; PV du token cohérents ; zone retirée après coup.
 */
export default {
  name: "sauvegarde de zone — Mains brûlantes sur un Zombi",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const regionsBefore = (await ctx.call("list-scene-objects", { types: ["Region"] })).objects.Region ?? [];

    const box = await ctx.box(zombi);
    const used = await ctx.use({ tokenId: sorc.id, identifier: "burning-hands", activityType: "save", area: { shape: "rectangle", ...box } });
    ctx.expect(used.used && !!used.regionId, "activité utilisée et zone posée sur le Zombi");
    ctx.log(`zone : région ${used.regionId}, message ${used.usageMessageId}`);
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));

    const r = await ctx.settle(used.usageMessageId);
    ctx.expect(r.step === "done", `résolution tranchée (« ${r.step} »)`);
    const target = r.targets.find(t => t.name === "Zombi") ?? r.targets[0];
    ctx.expect(!!target && (r.targets.length === 1), `une seule cible atteinte par la zone : ${r.targets.map(t => t.name).join(", ")}`);
    if ( !target ) return;

    const { dc, ability } = r.plan.save;
    ctx.expect(!!target.save && (target.save.total !== null), `sauvegarde ${ability} DD ${dc} lancée par le moteur (${target.save?.total})`);
    if ( target.save?.total !== null ) {
      ctx.expect(target.save.success === (target.save.total >= dc), `réussite ⇔ ${target.save.total} ≥ ${dc} (${target.save.success ? "réussie" : "ratée"})`);
    }
    const damage = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "damage");
    const total = (damage?.rolls ?? []).reduce((sum, roll) => sum + (roll.total ?? 0), 0);
    const expected = target.save?.success ? Math.floor(total / 2) : total;
    ctx.expect(!!damage && total > 0, `jet de dégâts de l'auteur (${total})`);
    ctx.expect(target.damage?.applied === expected, `dégâts appliqués ${target.damage?.applied} = ${target.save?.success ? "moitié de" : ""} ${total}`);
    const after = await ctx.hp(zombi);
    ctx.expect(hp0 - after === target.damage?.applied, `PV lus sur le token ${hp0} → ${after}`);

    // Le moteur laisse la zone quelques secondes (animations d'autres modules) avant de la retirer.
    let regionsAfter = [];
    for ( const until = Date.now() + 10000; Date.now() < until; ) {
      regionsAfter = (await ctx.call("list-scene-objects", { types: ["Region"] })).objects.Region ?? [];
      if ( regionsAfter.length === regionsBefore.length ) break;
      await new Promise(r => setTimeout(r, 500));
    }
    ctx.expect(regionsAfter.length === regionsBefore.length, `zone instantanée retirée (${regionsAfter.length} région(s), comme avant)`);
  }
};
