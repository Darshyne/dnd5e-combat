/**
 * §290 : fenêtres du combat sans délai, monde `dnd-6`, Arène de test. Demande un joueur **connecté** dont le personnage est sur la scène
 * (en pratique `claude player` et le Paladin, depuis le navigateur intégré) ; sans lui, non applicable. Le Clerc lance Flamme sacrée sur ce
 * personnage : sa sauvegarde est demandée au joueur. Vérifie :
 *  - le MJ note l'attente (joueur, personnage, quoi) ;
 *  - aucun compte à rebours : au-delà du délai des fenêtres, la question attend toujours, et la fenêtre de suivi s'est ouverte chez le MJ ;
 *  - « Forcer » : la fenêtre se ferme chez le joueur, son jet part sans dialogue, l'attente disparaît, la fenêtre de suivi se ferme.
 * `HOLD=<ms>` garde l'attente ouverte ce temps-là avant de forcer (pour regarder les deux écrans). Remet les deux réglages.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const DELAY = 4;   // secondes : le délai des fenêtres pendant le scénario

export default {
  name: "fenetres-sans-delai — le MJ voit qui il attend, et force",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const players = await ctx.call("list-players", {});
    const player = players.find(p => p.active && (p.role < 4) && tokens.some(t => (t.actorId === p.characterId) && (t.name !== "Clerc")));
    if ( !player || !tokens.some(t => t.name === "Clerc") ) {
      ctx.log("un joueur connecté dont le personnage est sur la scène, et le Clerc, requis : non applicable");
      return;
    }
    const target = tokens.find(t => t.actorId === player.characterId);
    const cleric = await ctx.token("Clerc");
    const flame = await ctx.itemId(cleric.id, "sacred-flame");
    for ( const [key, value] of [["combatWindowUnlimited", true], ["combatWindowSeconds", DELAY]] ) {
      const { before } = await ctx.engine("setting", { key, value });
      ctx.restore(() => ctx.engine("setting", { key, value: before }).catch(() => {}));
    }
    const hp = await ctx.hp(target);
    ctx.restore(() => ctx.setHp(target, hp));

    const since = await ctx.lastMessageId();
    await ctx.use({ tokenId: cleric.id, itemId: flame, targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
    let wait = null;
    for ( const stop = Date.now() + 15000; !wait && (Date.now() < stop); await pause(500) ) {
      wait = (await ctx.engine("waits", {})).waits.find(w => w.actor?.endsWith(target.actorId));
    }
    ctx.expect(!!wait, `l'attente de ${player.name} est notée (${JSON.stringify(wait ?? null)})`);
    if ( !wait ) return;
    ctx.expect((wait.userName === player.name) && !!wait.label, `qui et quoi : ${wait.userName}, « ${wait.label} »`);

    await pause((DELAY + 2) * 1000);
    const later = await ctx.engine("waits", {});
    ctx.expect(later.waits.some(w => w.id === wait.id), `au-delà du délai (${DELAY} s), la question attend toujours`);
    ctx.expect(later.window, "la fenêtre de suivi s'est ouverte chez le MJ");
    if ( process.env.HOLD ) await pause(Number(process.env.HOLD));

    const { forced } = await ctx.engine("forcePlayerWait", { id: wait.id });
    ctx.expect(forced, "« Forcer » accepté");
    let rolled = null;
    for ( const stop = Date.now() + 15000; !rolled && (Date.now() < stop); await pause(700) ) {
      rolled = (await ctx.messagesSince(since)).find(m => (m.actorId === target.actorId) && (m.type === "save"));
    }
    ctx.expect(!!rolled, `le jet de ${target.name} part sans dialogue (« ${(rolled?.flavor ?? "").slice(0, 60)} »)`);
    await pause(1500);
    const after = await ctx.engine("waits", {});
    ctx.expect(!after.waits.some(w => w.id === wait.id), "l'attente a disparu");
    ctx.expect(!after.window, "la fenêtre de suivi s'est fermée");

    // Une fenêtre à boutons (§282, Inspiration héroïque après la sauvegarde) : sans compte à rebours, forcée → « Garder le jet ».
    const inspired = async () => !!(await ctx.call("get-actor", { actorId: target.actorId }))?.system?.attributes?.inspiration;
    const was = await inspired();
    ctx.restore(() => ctx.call("update-actor", { actorId: target.actorId, actorData: { "system.attributes.inspiration": was } }));
    await ctx.call("update-actor", { actorId: target.actorId, actorData: { "system.attributes.inspiration": true } });
    await ctx.use({ tokenId: cleric.id, itemId: flame, targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
    const next = async (seen, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; await pause(500) ) {
        const w = (await ctx.engine("waits", {})).waits.find(x => !seen.includes(x.id) && x.actor?.endsWith(target.actorId));
        if ( w ) return w;
      }
      return null;
    };
    const save = await next([wait.id]);
    ctx.expect(!!save, "deuxième sauvegarde attendue");
    if ( !save ) return;
    await ctx.engine("forcePlayerWait", { id: save.id });
    const heroic = await next([wait.id, save.id]);
    ctx.expect(!!heroic, `puis la question de l'Inspiration héroïque attend (« ${heroic?.label ?? ""} »)`);
    if ( !heroic ) return;
    await pause((DELAY + 2) * 1000);
    ctx.expect((await ctx.engine("waits", {})).waits.some(w => w.id === heroic.id), "elle attend toujours au-delà du délai");
    if ( process.env.HOLD ) await pause(Number(process.env.HOLD));
    await ctx.engine("forcePlayerWait", { id: heroic.id });
    await pause(2500);
    ctx.expect(!(await ctx.engine("waits", {})).waits.some(w => w.id === heroic.id), "forcée, elle se ferme");
    ctx.expect(await inspired(), "forcée : « Garder le jet », l'Inspiration n'est pas dépensée");
  }
};
