/**
 * Égide projetée (SPEC §38), monde `dnd-6`. Le Magicien reçoit l'Égide arcanique et l'Égide projetée (Manuel des joueurs), crée son
 * égide (pleine) ; le Zombi frappe le Guerrier, à 9 m ou moins du Magicien, jusqu'à toucher ; la réaction est prise d'office
 * (`autoReact: "first"`). Vérifie :
 *  - l'égide absorbe : sa dépense > 0, la carte « absorbe » est signée du Magicien ;
 *  - dégâts subis par le Guerrier + absorbés = dégâts du jet (l'égide d'abord, le reste au Guerrier) ;
 *  - coups suivants jusqu'à épuiser l'égide : à chaque coup, subis + absorbés = jet ; quand elle ne suffit plus, elle prend ce qui lui
 *    reste et le Guerrier le reste (l'excédent, une fois l'égide à 0 PV, revient à la créature protégée) ; vide, rien d'absorbé.
 * Remet PV, positions, effets ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "Compendium.dnd-players-handbook.classes.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "égide projetée — l'égide du Magicien absorbe les dégâts du Guerrier",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Guerrier ou Zombi absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const wardId = await ctx.ensureItem(mage, CLASSES + "phbwzdArcaneWard");
    await ctx.ensureItem(mage, CLASSES + "phbwzdProjectedW");

    const all = [mage, fighter, zombi];
    const hp0 = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      hp0.set(t.id, await ctx.hp(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const zHome = await ctx.position(zombi);
    const clearNew = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    for ( const t of all ) ctx.restore(() => ctx.setHp(t, hp0.get(t.id)));
    for ( const t of all ) ctx.restore(() => clearNew(t));

    const zItems = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = zItems.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Zombi a une attaque (${weapon?.name})`) ) return;
    const spentOf = async () => {
      const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === wardId);
      return Number(item?.system?.uses?.spent) || 0;
    };
    const f = await ctx.position(fighter);
    await ctx.call("move-token", { tokenId: zombi.id, x: f.x + grid, y: f.y, elevation: f.elevation });
    await pause(800);
    const fighterMax = (await ctx.engine("stats", { tokenId: fighter.id }))?.hp?.max ?? hp0.get(fighter.id);

    /** Le Zombi frappe le Guerrier (PV pleins) jusqu'à toucher ; rend les dégâts du jet, la perte de PV, la dépense de l'égide, les cartes. */
    const strike = async () => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(fighter, fighterMax);
        const spent0 = await spentOf();
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [fighter.id],
          usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !r?.targets?.find(t => t.name === "Guerrier")?.hit ) continue;
        await pause(2500);
        const msgs = await ctx.messagesSince(since);
        const damage = msgs.find(m => m.type === "damage");
        const dealt = (damage?.rolls ?? []).reduce((s, x) => s + (x.total ?? 0), 0);
        return { dealt, lost: fighterMax - (await ctx.hp(fighter)), absorbed: (await spentOf()) - spent0, msgs };
      }
      return null;
    };

    // Égide créée, pleine (« Create Ward », une utilisation par repos long).
    await ctx.use({ tokenId: mage.id, itemId: wardId, activityId: "Hha69hPMTYWhDE4A", consume: true });
    await pause(1200);
    ctx.log(`égide créée : dépensé ${await spentOf()}`);

    const hit = await strike();
    if ( !ctx.expect(!!hit, "le Zombi touche le Guerrier (20 essais au plus)") ) return;
    const card = hit.msgs.find(m => m.flags?.[MODULE_ID]?.absorbed);
    ctx.expect(hit.absorbed > 0, `l'égide du Magicien absorbe ${hit.absorbed} (jet ${hit.dealt})`);
    ctx.expect(hit.lost + hit.absorbed === hit.dealt, `Guerrier : ${hit.lost} PV perdus + ${hit.absorbed} absorbés = ${hit.dealt}`);
    ctx.expect(!!card && /Magicien|claude/i.test(card.alias ?? ""), `carte « absorbe » signée du Magicien (${card?.alias})`);

    // Coups suivants jusqu'à épuiser l'égide : partielle, puis vide.
    const seen = { partial: false, empty: false };
    for ( let n = 0; (n < 8) && !seen.empty; n++ ) {
      const next = await strike();
      if ( !next ) break;
      ctx.expect(next.lost + next.absorbed === next.dealt, `coup ${n + 2} : ${next.lost} PV perdus + ${next.absorbed} absorbés = ${next.dealt}`);
      if ( (next.absorbed > 0) && (next.lost > 0) ) seen.partial = true;
      if ( next.absorbed === 0 ) seen.empty = true;
    }
    ctx.expect(seen.empty, "l'égide épuisée n'absorbe plus rien");
    ctx.log(`absorption partielle vue : ${seen.partial}`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
