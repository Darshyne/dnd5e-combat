/**
 * §119 : Projectile magique et Contresort. Le moteur rejoue le sort pour chaque projectile enchaîné ; ces lancements passaient
 * aussi par la porte « castsSpell », et un Mage dont le MJ avait refusé le Contresort (réaction gardée) se le voyait reproposer
 * au projectile suivant (vu le 2026-10-10 : deux fenêtres, un projectile perdu). Le MJ refuse ici la fenêtre : elle ne doit
 * s'ouvrir qu'une fois, et les trois projectiles partir.
 */
export default {
  name: "Projectile magique — Contresort refusé, une seule fenêtre (§119)",

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
      // Le Mage de l'arène est un token NON LIÉ : sa Magie protectrice (§66, Contresort sans emplacement) vit dans sa copie, que les
      // passes précédentes avaient épuisée (3/3 le 2026-10-06 — le filet de sécurité remet l'état du DÉBUT, déjà épuisé) : plus de
      // Contresort proposé. On remet ses utilisations à zéro le temps du scénario, et on rend ce qu'il y avait.
      const { data: mageToken } = await ctx.call("get-scene-object", { type: "Token", objectId: mageNpc.id });
      const uuid = `Scene.${(await ctx.scene()).sceneId}.Token.${mageNpc.id}.Actor.${mageNpc.actorId}`;
      const protective = (mageToken.delta?.items ?? []).find(i => i.system?.identifier === "protective-magic");
      if ( protective?.system?.uses?.spent ) {
        const match = { path: "_id", value: protective._id };
        await ctx.call("upsert-embedded-item", { uuid, itemData: { "system.uses.spent": 0 }, match });
        ctx.restore(() => ctx.call("upsert-embedded-item", { uuid, itemData: { "system.uses.spent": protective.system.uses.spent }, match }).catch(() => {}));
        ctx.log(`Magie protectrice du Mage (token) : ${protective.system.uses.spent} utilisation(s) dépensée(s) → 0 le temps du scénario`);
      }
      // « En voyant le lanceur » : le Mage n'a pas de vision dans le noir (vue 0 ft) ; il voit par la lumière de la
      // scène — ce que la vision simulée refusait avant la correction du 2026-09-24 (adapter/vision.mjs, lightRadius).
      ctx.log(`contre-lanceur : Mage (emplacements de niveau 3 : ${spell3.value ?? 0}/${spell3.override ?? "max 0"} → 3/3)`);
    } else {
      await ctx.ensureItem(zombi, "Compendium.dnd5e.spells24.Item.phbsplCounterspe", { system: { method: "atwill" } });
      ctx.log("contre-lanceur : Zombi (Contresort à volonté, pas de Mage sur la scène)");
    }
    // §119 : Projectile magique, le MJ REFUSE le Contresort (sa réaction n'est pas dépensée) : la fenêtre ne doit s'ouvrir qu'une fois.
    const ids = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const before = await ctx.lastMessageId();
    await ctx.use({ tokenId: mage.id, identifier: "magic-missile", targetTokenIds: [zombi.id], usageConfig: { "dnd5e-combat": { autoReact: false } } });
    const seen = [];
    for ( const stop = Date.now() + 30000; Date.now() < stop; ) {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...ids, ...seen.map(d => d.id)], waitMs: 1500, details: true }).catch(() => null);
      for ( const d of r?.windows ?? [] ) {
        const text = `${d.title ?? ""} | ${(d.content ?? d.text ?? "").slice(0, 120)}`;
        const labels = (d.buttons ?? []).map(b => `${b.action ?? ""}:${b.label ?? ""}`);
        const b = (d.buttons ?? []).find(x => x.action === "none") ?? null;   // « Ne pas réagir »
        ctx.log(`fenêtre : ${text} — boutons ${labels.join(", ")} → ${b ? (b.action ?? b.label) : "fermée"}`);
        if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
        else await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
        seen.push(d);
      }
    }
    const usages = (await ctx.messagesSince(before)).filter(m => m.type === "usage").length;
    ctx.expect(seen.length === 1, `une seule fenêtre de réaction pour tout le sort (${seen.length})`);
    ctx.expect(usages >= 3, `les trois projectiles sont partis (${usages} cartes d'utilisation)`);
  }
};
