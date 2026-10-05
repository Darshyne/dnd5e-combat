/**
 * Épuisement (règles 2024, porté par dnd5e 6 : `CONFIG.DND5E.conditionTypes.exhaustion` — 6 niveaux, −2 par niveau aux Tests d20,
 * −5 ft de Vitesse par niveau, Mort au niveau 6). Le moteur ne le recalcule pas : vérifier qu'il en tient compte là où il agit.
 *  - Niveau 2 : sauvegarde et test avec −4 ; jet d'attaque avec −4 ; Vitesse −10 ft (fiche, et plafond de déplacement du moteur en
 *    combat) ; les chances de toucher du moteur suivent.
 *  - Niveau 6 : l'état Mort.
 *  - Retour à 0 : plus de malus, plus de Mort.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Épuisement — malus aux Tests d20, Vitesse, Mort au niveau 6",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Bandit absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const actor = () => ctx.call("get-actor", { actorId: fighter.actorId });
    const exh0 = (await actor()).system?.attributes?.exhaustion ?? 0;
    const setExh = n => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.exhaustion": n } });
    ctx.restore(async () => { await setExh(exh0); await pause(800); await ctx.removeStatusEffects(fighter, "dead"); await ctx.removeStatusEffects(fighter, "exhaustion"); });
    const statuses = async () => (await ctx.effects(fighter)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const speed = async () => (await ctx.engine("stats", { tokenId: fighter.id }))?.speed?.walk ?? null;
    const sword = await ctx.itemId(fighter.id, "greatsword");
    const attackFormula = async () => {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
      await pause(3500);
      return (await ctx.messagesSince(since)).find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "";
    };
    const has = (f, n) => new RegExp(`-\\s*${n}(?!\\d)`).test(f);

    // Niveau 0 : la base.
    await setExh(0); await pause(1200);
    const v0 = await speed();
    const s0 = await ctx.engine("rollSave", { tokenId: fighter.id, ability: "dex" });
    const a0 = await attackFormula();
    ctx.log(`niveau 0 : Vitesse ${v0}, sauvegarde « ${s0?.formula} », attaque « ${a0} »`);

    // Niveau 2.
    await setExh(2); await pause(1500);
    ctx.expect((await statuses()).includes("exhaustion"), "niveau 2 : l'état Épuisement est posé");
    const v2 = await speed();
    ctx.expect((v0 !== null) && (v2 === v0 - 10), `Vitesse ${v0} → ${v2} (−5 ft par niveau)`);
    const s2 = await ctx.engine("rollSave", { tokenId: fighter.id, ability: "dex" });
    ctx.expect(has(s2?.formula ?? "", 4), `sauvegarde avec −4 (« ${s2?.formula} »)`);
    const c2 = await ctx.engine("rollCheck", { tokenId: fighter.id, skill: "ath" });
    ctx.expect(has(c2?.formula ?? "", 4), `test avec −4 (« ${c2?.formula} »)`);
    const a2 = await attackFormula();
    ctx.expect(has(a2, 4), `jet d'attaque avec −4 (« ${a2} »)`);
    // En combat : le plafond de déplacement du moteur suit la Vitesse réduite.
    await ctx.startCombat([fighter, bandit]);
    await pause(1500);
    const cap = (await ctx.engine("budget", { tokenId: fighter.id }))?.cap ?? null;
    ctx.expect((cap !== null) && (cap === v2), `plafond de déplacement du moteur : ${cap} (Vitesse ${v2})`);
    const reasons = await ctx.engine("attackReasons", { attackerId: fighter.id, targetId: bandit.id, itemId: sword });
    ctx.log(`raisons d'Avantage / Désavantage (l'Épuisement n'en est pas une : c'est un malus) : ${JSON.stringify(reasons)}`);

    // Niveau 6 : Mort.
    await setExh(6); await pause(2000);
    // dnd5e ajoute « dead » aux états CALCULÉS de l'effet d'Épuisement (ConditionData#prepareDerivedData), pas à sa donnée : lu sur
    // l'acteur préparé (`actor.statuses`, ce que le moteur consulte).
    const st6 = (await ctx.engine("stats", { tokenId: fighter.id }))?.statuses ?? [];
    ctx.expect(st6.includes("dead"), `niveau 6 : l'état Mort (${st6.join(", ")})`);
    const dead6 = await ctx.engine("issues", { tokenId: fighter.id, itemId: sword }).catch(() => null);
    ctx.log(`niveau 6 : ce que le moteur dit d'une attaque du Guerrier : ${JSON.stringify(dead6)}`);

    // Retour à 0.
    await setExh(0); await pause(2000);
    const st0 = (await ctx.engine("stats", { tokenId: fighter.id }))?.statuses ?? [];
    ctx.expect(!st0.includes("exhaustion"), `niveau 0 : plus d'Épuisement (${st0.join(", ") || "aucun état"})`);
    ctx.log(`niveau 0 : Mort ${st0.includes("dead") ? "toujours posée (dnd5e ne la retire pas en descendant : au MJ)" : "retirée"}`);
    ctx.expect((await speed()) === v0, `Vitesse revenue à ${v0}`);
  }
};
