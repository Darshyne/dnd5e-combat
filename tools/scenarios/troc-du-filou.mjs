/**
 * Troc du filou (SPEC §38.2), monde `dnd-6`. Le Clerc reçoit Invoquer la duplicité et Troc du filou (Manuel des joueurs) ; l'illusion
 * est posée par `api.mcp.summonAt`, l'échange joué par `api.mcp.transpose` (l'intention de l'entrée du menu contextuel). Colonne libre
 * de Restored Keep : Clerc 3080 × 4900, illusion 3080 × 5180. Vérifie :
 *  - hors combat : l'échange (le Clerc à la place de l'illusion, l'illusion à la sienne), et de nouveau ;
 *  - en combat, au tour du Clerc : l'illusion créée ce tour-ci → échange permis ; un second au même tour → refusé ;
 *  - au tour suivant du Clerc, l'illusion ni créée ni déplacée → refusé ; déplacée par le moteur (commande payée : l'action Bonus) →
 *    permis.
 * Remet positions, effets, combat ; retire l'illusion et les items prêtés.
 */
const CLASSES = "Compendium.dnd-players-handbook.classes.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "troc du filou — échange de place avec l'illusion, une fois par tour",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const duplicityId = await ctx.ensureItem(cleric, CLASSES + "phbclcInvokeDupl");
    await ctx.ensureItem(cleric, CLASSES + "phbclcTricksters");
    const home = await ctx.position(cleric);
    const tokens0 = new Set(tokens.map(t => t.id));
    const effects0 = new Set((await ctx.effects(cleric)).map(e => e._id ?? e.id));
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };
    const reset = async () => {
      await endCombat();
      const now = await ctx.liveTokens();
      for ( const t of now.filter(t => !tokens0.has(t.id)) ) await ctx.call("delete-scene-object", { type: "Token", objectId: t.id }).catch(() => {});
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: cleric.id });
      for ( const e of (await ctx.effects(cleric)).filter(e => !effects0.has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: data.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
      await ctx.call("move-token", { tokenId: cleric.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      await pause(700);
    };
    ctx.restore(reset);
    const put = async () => { await ctx.call("move-token", { tokenId: cleric.id, x: 3080, y: 4900, elevation: 0 }); await pause(700); };
    const summon = async () => {
      const s = await ctx.engine("summonAt", { tokenId: cleric.id, itemId: duplicityId, x: 3080, y: 5180 });
      await pause(2000);
      return s?.tokens?.[0] ?? null;
    };
    const posOf = async id => { const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: id }); return { x: data.x, y: data.y }; };

    // 1. Hors combat.
    await put();
    const illusion = await summon();
    if ( !ctx.expect(!!illusion, `l'illusion est invoquée (${illusion?.name ?? "rien"})`) ) return;
    const first = await ctx.engine("transpose", { tokenId: illusion.id });
    await pause(1500);
    let c = await posOf(cleric.id), i = await posOf(illusion.id);
    ctx.expect(first.done && (c.y === 5180) && (i.y === 4900), `hors combat : échange fait (Clerc en ${c.x} × ${c.y}, illusion en ${i.x} × ${i.y})`);
    const again = await ctx.engine("transpose", { tokenId: cleric.id });
    await pause(1500);
    c = await posOf(cleric.id); i = await posOf(illusion.id);
    ctx.expect(again.done && (c.y === 4900) && (i.y === 5180), `hors combat, depuis le Clerc : de nouveau (Clerc en ${c.y}, illusion en ${i.y})`);
    await ctx.call("delete-scene-object", { type: "Token", objectId: illusion.id }).catch(() => {});
    await pause(800);

    // 2. En combat, au tour du Clerc : créée ce tour-ci.
    await ctx.startCombat([cleric, zombi]);
    const combat = await ctx.combat();
    for ( const [t, value] of [[cleric, 20], [zombi, 10]] ) {
      const cb = (combat.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
      if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
    }
    const current = (await ctx.combat()).combatant ?? null;
    ctx.log(`combat : au tour de ${current?.name ?? "?"}`);
    const fresh = await summon();
    if ( !ctx.expect(!!fresh, "l'illusion est invoquée au combat") ) return;
    const ok = await ctx.engine("transpose", { tokenId: fresh.id });
    await pause(1500);
    ctx.expect(ok.done, `créée ce tour-ci : échange permis (${JSON.stringify(ok.after)})`);
    const twice = await ctx.engine("transpose", { tokenId: fresh.id });
    ctx.expect(!twice.done, "un second échange au même tour : refusé");

    // 3. Tour suivant du Clerc : ni créée ni déplacée.
    await ctx.nextTurn(); await pause(1500);
    await ctx.nextTurn(); await pause(1500);
    const later = await ctx.engine("transpose", { tokenId: fresh.id });
    ctx.expect(!later.done, "au tour suivant, sans créer ni déplacer l'illusion : refusé");
    const where = await posOf(fresh.id);
    await ctx.engine("move", { tokenId: fresh.id, point: { x: where.x + 140 + 70, y: where.y + 70 } });
    await pause(1500);
    const budget = await ctx.engine("budget", { tokenId: cleric.id });
    const moved = await ctx.engine("transpose", { tokenId: fresh.id });
    ctx.expect(moved.done, `l'illusion déplacée par une commande (action Bonus du Clerc : ${budget?.bonus}) : échange permis`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
