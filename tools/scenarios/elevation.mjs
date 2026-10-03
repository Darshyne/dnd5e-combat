/**
 * Élévation et volumes (P2, SPEC §14.2) : le Zombi monte à 30 ft au-dessus de sa case ; Mains
 * brûlantes posée sur cette case ne l'atteint pas — le cône reçoit une tranche d'élévation
 * (−7,5 → 7,5 ft autour du lanceur au sol) et le cœur juge le Zombi dehors : « zone posée sur
 * personne », PV intacts. Redescendu au sol, la même pose l'atteint. Remet l'élévation et les PV.
 *
 * La montée passe par `move-token` du connecteur (0.27.0 : `token.move` en `displace`, régions
 * réchauffées contre le piège « reading 'testPoint' » du cœur, voir runtime/space.mjs) — un
 * `update-scene-object` d'élévation est refusé dès qu'un plancher est traversé.
 */
export default {
  name: "élévation — une zone au sol épargne une créature en vol",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    // Sur une scène à niveaux (Restored Keep a plusieurs Zombis), celui du niveau du lanceur : un plancher arrêterait la zone.
    const { tokens } = await ctx.scene();
    const zombi = tokens.find(t => (t.name === "Zombi") && !t.hidden && (t.level === sorc.level)) ?? await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const elevation0 = zombi.elevation ?? 0;
    const setElevation = async elevation => {
      const moved = await ctx.call("move-token", { tokenId: zombi.id, elevation });
      if ( !moved.moved ) throw new Error(`move-token : ${moved.warning ?? "élévation non appliquée"} (${JSON.stringify(moved.after)})`);
    };
    ctx.restore(() => setElevation(elevation0));
    const box = await ctx.box(zombi);
    const cast = () => ctx.use({ tokenId: sorc.id, identifier: "burning-hands", activityType: "save", area: { shape: "rectangle", ...box }, collectMs: 3000 });

    // 1. En vol : la zone ne l'atteint pas.
    await setElevation(elevation0 + 30);
    const high = await cast();
    ctx.expect(high.used && !!high.regionId, "zone posée sur la case du Zombi, lui à 30 ft");
    if ( high.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: high.regionId }).catch(() => {}));
    await new Promise(r => setTimeout(r, 2000));
    const r1 = await ctx.resolution(high.usageMessageId);
    ctx.expect(!r1?.targets?.some(t => t.name === "Zombi"), `le Zombi en vol n'est pas atteint (cibles : ${r1?.targets?.map(t => t.name).join(", ") || "aucune"})`);
    const hpHigh = await ctx.hp(zombi);
    ctx.expect(hpHigh === hp0, `PV intacts (${hpHigh})`);

    // 2. Au sol : la même zone l'atteint.
    await setElevation(elevation0);
    const low = await cast();
    ctx.expect(low.used && !!low.regionId, "même zone, Zombi au sol");
    if ( low.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: low.regionId }).catch(() => {}));
    const r2 = await ctx.settle(low.usageMessageId);
    const hit = r2.targets.find(t => t.name === "Zombi");
    ctx.expect(r2.step === "done" && !!hit, `au sol, la zone l'atteint (sauvegarde ${hit?.save?.total ?? "—"}, ${hit?.damage?.applied ?? 0} PV)`);
    const after = await ctx.hp(zombi);
    ctx.expect(hp0 - after === (hit?.damage?.applied ?? 0), `PV lus sur le token ${hp0} → ${after}`);
  }
};
