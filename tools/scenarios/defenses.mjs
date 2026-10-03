/**
 * Défenses de sorts (SPEC §16.46). Monde `ravenloft` : Bramo (magicien 5), Kaalisti, le Zombi.
 *  1. Voile défensif : la trace est posée sur Bramo (icône, concentration) ; le Coup du Zombi contre lui porte « -1d4 ».
 *  2. Résistance (profil Feu, choisi d'office) : un seul effet posé ; Fire Bolt de Kaalisti sur Bramo — les dégâts de feu
 *     sont réduits (journal du moteur « réduit les dégâts »).
 * Vigueur arcanique demande un clic (combien de dés de vie) : hors scénario. Remet PV, effets et concentration.
 */
const MODULE_ID = "dnd5e-combat";
const FIRE = "S7XVvtgRT8uEP1iw";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "défenses — Voile défensif, Résistance",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Bramo", "Kaalisti", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Bramo, Kaalisti ou le Zombi absent : non applicable"); return; }
    const bramo = await ctx.token("Bramo");
    const warlock = await ctx.token("Kaalisti");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(bramo);
    ctx.restore(() => ctx.setHp(bramo, hp0));
    ctx.restore(() => ctx.removeEffectsNamed(bramo, /Voile défensif|Blade Ward|Protection|concentr/i));
    const effects = async () => (await ctx.call("get-actor", { actorId: bramo.actorId })).effects ?? [];

    // 1. Voile défensif.
    const ward = await ctx.use({ tokenId: bramo.id, identifier: "blade-ward", activityId: "1wca3rjsdb0agWqk" });
    ctx.expect(ward.used, "Voile défensif lancé");
    await pause(2000);
    const trace = (await effects()).find(e => e.flags?.[MODULE_ID]?.trace);
    ctx.expect(!!trace && (trace.showIcon === 2), `trace visible sur Bramo (${trace?.name})`);
    const slam = await ctx.use({ tokenId: zombi.id, identifier: "slam", activityType: "attack", targetTokenIds: [bramo.id] });
    await ctx.settle(slam.usageMessageId).catch(() => null);
    const attack = (await ctx.messagesSince(slam.usageMessageId)).find(m => m.type === "attack");
    const bonuses = attack?.flags?.[MODULE_ID]?.bonuses ?? [];
    ctx.expect(bonuses.some(b => b.formula === "-1d4"), `Coup du Zombi contre Bramo : « -1d4 » (${JSON.stringify(bonuses)})`);
    await ctx.setHp(bramo, hp0);
    await ctx.removeEffectsNamed(bramo, /concentr/i);   // la trace part avec la concentration
    await pause(1500);

    // 2. Résistance (feu).
    const res = await ctx.use({ tokenId: bramo.id, identifier: "resistance", targetTokenIds: [bramo.id], usageConfig: { [MODULE_ID]: { choice: FIRE } } });
    ctx.expect(res.used, "Résistance lancée (feu)");
    await ctx.settle(res.usageMessageId).catch(() => null);
    await pause(1500);
    const protections = (await effects()).filter(e => /Protection/i.test(e.name ?? ""));
    ctx.expect(protections.length === 1, `un seul effet posé (${protections.map(e => e.name).join(", ")})`);
    let reduced = false;
    for ( let n = 1; (n <= 10) && !reduced; n++ ) {
      await ctx.setHp(bramo, hp0);
      const bolt = await ctx.use({ tokenId: warlock.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [bramo.id] });
      const r = await ctx.settle(bolt.usageMessageId).catch(() => null);
      if ( !r?.targets?.[0]?.hit ) continue;
      await pause(1500);
      reduced = (await ctx.engineLog()).some(l => /réduit les dégâts/.test(l));
    }
    for ( const l of (await ctx.engineLog()).filter(l => /Bramo|réduit|Protection|touché|raté/.test(l)).slice(-8) ) ctx.log(l);
    ctx.expect(reduced, "Fire Bolt touche Bramo : les dégâts de feu sont réduits");
  }
};
