/**
 * M7 (SPEC §18.11) — auras de monstre qui agissent. Monde `ravenloft`, deux capacités du Monster Manual prêtées le temps
 * du scénario :
 *  - l'Aura de feu de la Salamandre à l'Ours brun : à la fin de son tour, « chaque créature de son choix » à 3 m subit des
 *    dégâts de feu — Bramo (ennemi) oui, le Zombi (allié de l'Ours) non ;
 *  - la Puanteur du Blême au Loup : Bramo, qui commence son tour à 1,50 m, fait une sauvegarde de Constitution — ratée,
 *    il est Empoisonné ; réussie, il est immunisé 1 heure et n'en refait pas au tour suivant.
 * Ordre d'initiative imposé : Ours, Bramo, Loup.
 */
const SALAMANDER = "Compendium.dnd-monster-manual.actors.Actor.mmSalamander0000";
const GHAST = "Compendium.dnd-monster-manual.actors.Actor.mmGhast000000000";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "auras de monstre — Aura de feu (fin de tour), Puanteur (début de tour)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ours brun", "Loup", "Bramo", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ours brun, Loup, Bramo ou Zombi absent : non applicable"); return; }
    const bear = await ctx.token("Ours brun");
    const wolf = await ctx.token("Loup");
    const bramo = await ctx.token("Bramo");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    for ( const t of [bear, wolf, bramo, zombi] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
    }
    ctx.restore(() => ctx.removeStatusEffects(bramo, "poisoned"));
    ctx.restore(() => ctx.removeEffectsNamed(bramo, /Immunisé|Immune/));
    await ctx.removeStatusEffects(bramo, "poisoned");
    await ctx.removeEffectsNamed(bramo, /Immunisé|Immune/);

    /** Prête l'item `identifier` d'un acteur du compendium au token. */
    const lend = async (uuid, identifier, token) => {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === identifier);
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const r = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(token.id, identifier));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));
    };
    await lend(SALAMANDER, "fire-aura", bear);
    await lend(GHAST, "stench", wolf);

    // Combat, initiative imposée, puis on attend le tour de l'Ours, tokens encore loin les uns des autres.
    await ctx.startCombat([bear, bramo, wolf]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[bear, 30], [bramo, 20], [wolf, 10]] ) {
      const c = combat.combatants.find(x => x.tokenId === token.id);
      await ctx.call("set-initiative", { combatantId: c.id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 4) && ((await current()) !== bear.id); i++ ) { await ctx.nextTurn(); await sleep(800); }
    if ( !ctx.expect((await current()) === bear.id, "tour de l'Ours") ) return;

    // Autour de Bramo : l'Ours à gauche, le Loup à droite, le Zombi au-dessus de l'Ours.
    const at = await ctx.position(bramo);
    await ctx.call("move-token", { tokenId: bear.id, x: at.x - grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: wolf.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x - grid, y: at.y - grid, elevation: at.elevation });
    for ( const t of [bramo, zombi] ) await ctx.setHp(t, 100);
    await sleep(800);

    const emanations = async since => (await ctx.messagesSince(since)).filter(m => m.flags?.["dnd5e-combat"]?.areaTick?.event === "emanation");
    // Le connecteur ne rend pas les cibles d'une carte : celles de la résolution, et la créature d'une carte de début de tour.
    const tickOf = m => m.flags["dnd5e-combat"].areaTick;
    const startsFor = (m, token) => (tickOf(m).moment === "turnStart") && String(tickOf(m).token ?? "").endsWith(token.id);

    // Fin du tour de l'Ours → Aura de feu ; début du tour de Bramo → Puanteur.
    let mark = await ctx.lastMessageId();
    await ctx.nextTurn();
    await sleep(3000);
    let cards = await emanations(mark);
    const fire = cards.find(m => m.flags["dnd5e-combat"].areaTick.moment === "ownTurnEnd");
    ctx.expect(!!fire, "fin du tour de l'Ours : une carte d'Aura de feu");
    if ( fire ) {
      const on = ((await ctx.settle(fire.id).catch(() => null))?.targets ?? []).map(t => String(t.token ?? ""));
      ctx.expect(on.some(u => u.endsWith(bramo.id)) && !on.some(u => u.endsWith(zombi.id)), `Aura de feu : Bramo visé, pas le Zombi (${on.length} cible(s))`);
      await sleep(800);
      ctx.expect((await ctx.hp(bramo)) < 100, `Bramo brûlé (${await ctx.hp(bramo)} PV sur 100)`);
      ctx.expect((await ctx.hp(zombi)) === 100, "le Zombi, allié de l'Ours, épargné");
    }
    const stench = cards.find(m => startsFor(m, bramo));
    ctx.expect(!!stench, "début du tour de Bramo : une carte de Puanteur");
    if ( !stench ) return;
    const r = await ctx.settle(stench.id).catch(() => null);
    const save = r?.targets?.find(t => t.token?.endsWith(bramo.id))?.save ?? null;
    if ( !ctx.expect(save && (save.success !== null), `sauvegarde de Constitution jouée (${JSON.stringify(save)})`) ) return;
    await sleep(1000);
    const effects = await ctx.effects(bramo);
    const poisoned = effects.some(e => !e.disabled && !e.duration?.expired && (e.statuses ?? []).includes("poisoned"));
    const immune = effects.some(e => /Immunisé|Immune/.test(e.name ?? ""));
    if ( save.success ) {
      ctx.expect(!poisoned && immune, `sauvegarde réussie (${save.total}) : pas Empoisonné, immunisé (${effects.map(e => e.name).join(", ")})`);
      // Un tour complet : Bramo, Loup, Ours (Aura de feu), puis Bramo de nouveau — plus de Puanteur pour lui.
      mark = await ctx.lastMessageId();
      for ( let i = 0; i < 3; i++ ) { await ctx.nextTurn(); await sleep(2000); }
      ctx.expect((await current()) === bramo.id, "de nouveau le tour de Bramo");
      cards = await emanations(mark);
      ctx.expect(!cards.some(m => startsFor(m, bramo)),
        "immunisé : pas de nouvelle Puanteur");
    } else {
      ctx.expect(poisoned && !immune, `sauvegarde ratée (${save.total}) : Empoisonné, pas d'immunité`);
    }
  }
};
