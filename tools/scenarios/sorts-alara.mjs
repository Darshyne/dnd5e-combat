/**
 * Règles de sorts (SPEC §16.47), monde `ravenloft` : Alara (clerc), Bramo, le Zombi.
 *  1. Invisibilité sur soi, puis Flamme sacrée sur le Zombi : l'invisibilité cesse (lancer un sort).
 *  2. Assistance sur Bramo, profil Perception choisi d'office : un seul effet posé.
 *  3. Stabilisation sur Bramo debout : rien (il n'est pas à 0 PV) ; à 0 PV : Stabilisé ; soigné : Stabilisé retiré.
 *  4. Restauration partielle sur Bramo Empoisonné : l'état cesse, sans fenêtre (un seul état à faire cesser).
 *  5. Passage sans trace sur soi : Bramo, à moins de 9 m, reçoit la copie d'aura ; la concentration retirée, elle part.
 * Tentacules de Hadar (réactions) et Charme-personne (avantage en combat) : jugés au moment d'une réaction ou d'une
 * sauvegarde, hors scénario. Remet PV, états et concentration.
 */
const MODULE_ID = "dnd5e-combat";
const PERCEPTION = "qPowjrduxnzKpH8x";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sorts d'Alara — Invisibilité, Assistance, Stabilisation, Restauration partielle, Passage sans trace",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Alara", "Bramo", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Alara, Bramo ou le Zombi absent : non applicable"); return; }
    const alara = await ctx.token("Alara");
    const bramo = await ctx.token("Bramo");
    const zombi = await ctx.token("Zombi");
    const hpBramo = await ctx.hp(bramo);
    const hpZombi = await ctx.hp(zombi);
    const names = async token => (await ctx.effects(token)).filter(e => !e.disabled).map(e => e.name);
    const statuses = async token => (await ctx.effects(token)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const dropConcentration = async () => { await ctx.removeEffectsNamed(alara, /concentr/i); await pause(1200); };
    ctx.restore(async () => {
      await ctx.setHp(bramo, hpBramo);
      await ctx.setHp(zombi, hpZombi);
      await ctx.removeEffectsNamed(alara, /Invisib|concentr|Camoufl|Passage/i);
      await ctx.removeEffectsNamed(bramo, /Assistance|Stabilis|Passage|Camoufl/i);
      for ( const s of ["poisoned", "stable", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(bramo, s);
      await ctx.call("update-actor", { actorId: bramo.actorId, actorData: { "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } });
    });

    // 1. Invisibilité rompue par un sort.
    await ctx.use({ tokenId: alara.id, identifier: "invisibility", targetTokenIds: [alara.id] });
    await pause(1500);
    ctx.expect((await statuses(alara)).includes("invisible"), "Invisibilité sur Alara");
    const flame = await ctx.use({ tokenId: alara.id, identifier: "sacred-flame", targetTokenIds: [zombi.id] });
    await ctx.settle(flame.usageMessageId).catch(() => null);
    await pause(1500);
    ctx.expect(!(await statuses(alara)).includes("invisible"), "Flamme sacrée lancée : l'invisibilité cesse");
    await dropConcentration();

    // 2. Assistance : un seul profil.
    await ctx.use({ tokenId: alara.id, identifier: "guidance", targetTokenIds: [bramo.id], usageConfig: { [MODULE_ID]: { choice: PERCEPTION } } });
    await pause(1500);
    const guided = (await names(bramo)).filter(n => /Assistance|Guidance/.test(n));
    ctx.expect(guided.length === 1, `Assistance : un seul effet (${guided.join(", ")})`);
    await dropConcentration();
    await ctx.removeEffectsNamed(bramo, /Assistance|Guidance/);

    // 3. Stabilisation.
    await ctx.use({ tokenId: alara.id, identifier: "spare-the-dying", targetTokenIds: [bramo.id] });
    await pause(1500);
    ctx.expect(!(await statuses(bramo)).includes("stable"), "Stabilisation sur Bramo debout : rien");
    await ctx.setHp(bramo, 0);
    await pause(1500);
    await ctx.use({ tokenId: alara.id, identifier: "spare-the-dying", targetTokenIds: [bramo.id] });
    await pause(1500);
    ctx.expect((await statuses(bramo)).includes("stable"), "Stabilisation sur Bramo à 0 PV : Stabilisé");
    await ctx.setHp(bramo, hpBramo);
    await pause(1500);
    ctx.expect(!(await statuses(bramo)).includes("stable"), "Bramo soigné : Stabilisé retiré");
    for ( const s of ["unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(bramo, s);

    // 4. Restauration partielle.
    await ctx.call("set-status", { tokenId: bramo.id, statusId: "poisoned", active: true });
    await pause(800);
    await ctx.use({ tokenId: alara.id, identifier: "lesser-restoration", targetTokenIds: [bramo.id] });
    await pause(2000);
    ctx.expect(!(await statuses(bramo)).includes("poisoned"), "Restauration partielle : Empoisonné cesse");

    // 5. Passage sans trace (en combat : le réglage « auras en combat seulement » peut être actif).
    await ctx.startCombat([alara, bramo]);
    await ctx.use({ tokenId: alara.id, identifier: "pass-without-trace", targetTokenIds: [alara.id] });
    await pause(2500);
    const copy = (await ctx.effects(bramo)).find(e => e.flags?.[MODULE_ID]?.aura);
    ctx.expect(!!copy, `Bramo dans l'aura : ${copy?.name ?? "aucune copie"}`);
    await dropConcentration();
    await pause(1500);
    ctx.expect(!(await ctx.effects(bramo)).some(e => e.flags?.[MODULE_ID]?.aura), "concentration retirée : la copie part");
    for ( const l of (await ctx.engineLog()).filter(l => /cesse|ends|aura|Assistance|Aid|Stabilis|Stabiliz/.test(l)).slice(-8) ) ctx.log(l);
  }
};
