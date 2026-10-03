/**
 * Se libérer par un test (SPEC §16.54) : le Clerc lance Enchevêtrement (ajouté à volonté pour le scénario) sur le Guerrier
 * — zone posée sur lui, sauvegarde de Force rejouée jusqu'à l'échec (Entravé). Le Guerrier utilise S'échapper : un test de
 * Force (Athlétisme) contre le DD de sauvegarde des sorts du Clerc, écrit dans le texte du sort ; rejoué jusqu'à la
 * réussite. Vérifie : échec ⇔ total < DD et l'effet reste ; réussite ⇔ total ≥ DD et l'effet part. Remet effets,
 * concentration et zones.
 */
const SPELLS = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "entrave — Enchevêtrement, S'échapper par un test de Force (Athlétisme)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Guerrier absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    await ctx.ensureItem(cleric, SPELLS + "phbsplEntangle00", { system: { method: "atwill" } });
    const hp0 = await ctx.hp(fighter);
    const regions = [];
    const cleanup = async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await ctx.removeEffectsNamed(cleric, /concentr/i);
      await ctx.removeStatusEffects(fighter, "restrained");
      await ctx.setHp(fighter, hp0);
    };
    ctx.restore(cleanup);
    const restraints = async () => (await ctx.effects(fighter)).filter(e => (e.statuses ?? []).includes("restrained"));

    // 1. Enchevêtrement, jusqu'à une sauvegarde ratée.
    let caught = false;
    for ( let n = 1; (n <= 20) && !caught; n++ ) {
      const used = await ctx.use({ tokenId: cleric.id, identifier: "entangle", activityType: "save", consume: false,
        area: { shape: "rectangle", ...(await ctx.box(fighter)) } });
      if ( used.regionId ) regions.push(used.regionId);
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1000);
      caught = (await restraints()).length > 0;
      if ( !caught ) await cleanup();
    }
    ctx.expect(caught, "Enchevêtrement : le Guerrier est Entravé (sauvegarde ratée)");
    if ( !caught ) return;

    // 2. S'échapper, jusqu'à la réussite.
    const escapeId = await ctx.itemId(fighter.id, "dnd5e-combat-escape").catch(() => null);
    ctx.expect(!!escapeId, "le Guerrier a l'action de base S'échapper");
    if ( !escapeId ) return;
    let freed = false;
    let failures = 0;
    for ( let n = 1; (n <= 20) && !freed; n++ ) {
      await ctx.use({ tokenId: fighter.id, itemId: escapeId });
      await pause(2000);
      // Le moteur écrit « Guerrier se libère de Enchevêtrement (15 contre DD 13) » — le DD n'est pas sur le message. La
      // trace est un tampon tournant : on prend la dernière ligne, celle de cet essai.
      const line = (await ctx.engineLog()).reverse().find(l => /se libère pas de|se libère de/.test(l)) ?? "";
      const m = line.match(/\((\d+) contre DD (\d+)\)/);
      const total = m ? Number(m[1]) : null;
      const dc = m ? Number(m[2]) : null;
      const still = (await restraints()).length > 0;
      if ( (total === null) || (dc === null) ) { ctx.expect(false, `test d'évasion lancé et lu (${JSON.stringify({ total, dc })})`); return; }
      if ( total >= dc ) {
        freed = true;
        ctx.expect(!still, `réussite (${total} ≥ DD ${dc}) : l'entrave est retirée`);
      } else {
        failures++;
        if ( failures === 1 ) ctx.expect(still, `échec (${total} < DD ${dc}) : le Guerrier reste Entravé`);
      }
    }
    ctx.expect(freed, "le Guerrier finit par se libérer (en 20 essais au plus)");
    const log = (await ctx.engineLog()).filter(l => /se libère|Enchevêtrement|Entangle/.test(l)).slice(-4);
    for ( const l of log ) ctx.log(l);
  }
};
