/**
 * Porte « castsSpell » (SPEC §16, B5 bis) : Contresort donné au Zombi le temps du scénario. Le Magicien lance
 * Trait de feu sur lui avec `autoReact` (le PNJ réagit sans fenêtre) : le Zombi contre, le Magicien fait sa
 * sauvegarde de Constitution (moteur) ; ratée → le sort se dissipe, aucune attaque ; réussie → le Trait de feu
 * part. On rejoue jusqu'à voir les deux issues ; la carte de porte (flag `gate`) dit ce qui s'est passé.
 */
export default {
  name: "contresort — un hostile contre le Rayon de givre du Magicien",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    // Le contre-lanceur : le Mage PNJ (MM 2024, hostile, Contresort à emplacement) s'il est sur la scène — ses
    // emplacements de niveau 3 sont remis à 3 le temps du scénario (à zéro sur la fiche telle qu'importée, et dnd5e
    // refuse l'utilisation sans emplacement) ; sinon le Zombi, avec un Contresort « à volonté ».
    const { tokens } = await ctx.scene();
    const mageNpc = tokens.find(t => (t.name === "Mage") && !t.hidden);
    if ( mageNpc ) {
      // Le Mage du MM 2024 n'a pas d'emplacements (max 0) : Contresort en consomme un, dnd5e refuse sans. On lui en
      // donne trois par surcharge (`override`), comme un MJ le ferait sur la fiche, et on rend tout à la fin.
      const spell3 = (await ctx.call("get-actor", { actorId: mageNpc.actorId })).system?.spells?.spell3 ?? {};
      const before = { "system.spells.spell3.value": spell3.value ?? 0, "system.spells.spell3.override": spell3.override ?? null };
      await ctx.call("update-actor", { actorId: mageNpc.actorId, actorData: { "system.spells.spell3.override": 3, "system.spells.spell3.value": 3 } });
      ctx.restore(() => ctx.call("update-actor", { actorId: mageNpc.actorId, actorData: before }).catch(() => {}));
      // « En voyant le lanceur » : le Mage n'a pas de vision dans le noir (vue 0 ft) ; il voit par la lumière de la
      // scène — ce que la vision simulée refusait avant la correction du 2026-09-24 (adapter/vision.mjs, lightRadius).
      ctx.log(`contre-lanceur : Mage (emplacements de niveau 3 : ${spell3.value ?? 0}/${spell3.override ?? "max 0"} → 3/3)`);
    } else {
      await ctx.ensureItem(zombi, "Compendium.dnd5e.spells24.Item.phbsplCounterspe", { system: { method: "atwill" } });
      ctx.log("contre-lanceur : Zombi (Contresort à volonté, pas de Mage sur la scène)");
    }
    // Le Magicien n'a pas Trait de feu : Rayon de givre, un sort d'attaque aussi.
    const seen = { dissipated: false, passed: false };
    for ( let i = 0; i < 20 && !(seen.dissipated && seen.passed); i++ ) {
      await ctx.setHp(zombi, hp0);
      const before = await ctx.lastMessageId();
      // Le connecteur rend la main dès que `use()` est annulé par la porte : on lit la suite dans le chat.
      await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { "dnd5e-combat": { autoReact: true } } });
      let gate = null;
      for ( const until = Date.now() + 40000; Date.now() < until && !gate; ) {
        await new Promise(r => setTimeout(r, 700));
        const messages = await ctx.messagesSince(before);
        gate = messages.map(m => m.flags?.["dnd5e-combat"]?.gate ?? m.flags?.gate).find(g => g?.kind === "counterspell") ?? null;
      }
      if ( !gate ) { ctx.expect(false, "aucune carte de porte : personne n'a contré"); return; }
      const counter = await ctx.settle(gate.message);
      const t = counter.targets.find(x => x.name === "Magicien");
      ctx.expect(!!t?.save && (t.save.success === (t.save.total >= counter.plan.save.dc)), `Contresort résolu : sauvegarde de Constitution du Magicien ${t?.save?.total} contre DD ${counter.plan.save.dc}`);
      ctx.expect(gate.dissipated === (t?.save?.success === false), `carte de porte cohérente : ${gate.dissipated ? "sort dissipé" : "le sort passe"}`);
      await new Promise(r => setTimeout(r, 2500));
      const attack = (await ctx.messagesSince(before)).find(m => m.type === "attack");
      if ( gate.dissipated ) { ctx.expect(!attack, "sort dissipé : aucun jet d'attaque"); seen.dissipated = true; }
      else { ctx.expect(!!attack, "sort tenu : le jet d'attaque a eu lieu"); seen.passed = true; }
    }
    ctx.expect(seen.dissipated && seen.passed, `les deux issues vues (dissipé : ${seen.dissipated}, tenu : ${seen.passed})`);
  }
};
