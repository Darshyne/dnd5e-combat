/**
 * M4 (SPEC §18.7) — la durée écrite dans le texte devient une expiration native de dnd5e. Monde `ravenloft` : la Morsure du
 * Mille-pattes géant (Monster Manual, prêtée au Loup le temps du scénario) pose Empoisonné « jusqu'au début du tour suivant
 * de la créature attaquante », sans durée dans ses données. Touché, l'Ours est Empoisonné avec `duration.expiry =
 * "sourceStart"` ; l'état tient pendant le tour de l'Ours et tombe au début du tour suivant du Loup (effet marqué
 * expiré par le cœur, pas supprimé).
 */
const CENTIPEDE = "Compendium.dnd-monster-manual.actors.Actor.mmGiantCentipede";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "durée écrite — Empoisonné jusqu'au début du prochain tour de l'attaquant",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Ours brun"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup ou Ours brun absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const bear = await ctx.token("Ours brun");   // pas le Zombi : immunisé contre Empoisonné
    const grid = await ctx.gridSize();
    const home = await ctx.position(bear);
    const hp = await ctx.hp(bear);
    ctx.restore(() => ctx.call("move-token", { tokenId: bear.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.setHp(bear, hp));
    ctx.restore(() => ctx.removeStatusEffects(bear, "poisoned"));
    ctx.restore(() => ctx.removeEffectsNamed(bear, /Empoisonn|Poison/));
    await ctx.removeStatusEffects(bear, "poisoned");
    const at = await ctx.position(wolf);
    await ctx.call("move-token", { tokenId: bear.id, x: at.x - 2 * grid, y: at.y, elevation: at.elevation });

    // La Morsure du Mille-pattes, prêtée au Loup (identifiant « bite » : on la reconnaît à son id).
    const { data: centipede } = await ctx.call("get-compendium-entry", { uuid: CENTIPEDE });
    const { _id, folder, ownership, _stats, ...itemData } = centipede.items.find(i => i.system?.identifier === "bite");
    itemData.system.identifier = "centipede-bite";
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const r = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "centipede-bite" } });
    const itemId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(wolf.id, "centipede-bite"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));

    await ctx.startCombat([wolf, bear]);
    const current = async () => {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      return combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId ?? null;
    };
    for ( let i = 0; (i < 3) && ((await current()) !== wolf.id); i++ ) { await ctx.nextTurn(); await sleep(800); }

    // Expiré, un effet n'est pas supprimé par le cœur V14 : il est marqué `duration.expired` (CONFIG.ActiveEffect.expiryAction =
    // "update", client/config.mjs:2057), donc suspendu (`isSuppressed`), et l'acteur perd l'état.
    const poison = async () => (await ctx.effects(bear)).find(e => !e.disabled && !e.duration?.expired && (e.statuses ?? []).includes("poisoned")) ?? null;
    let hit = false;
    for ( let i = 0; (i < 20) && !hit; i++ ) {
      await ctx.setHp(bear, 100);
      const used = await ctx.use({ tokenId: wolf.id, itemId, activityType: "attack", targetTokenIds: [bear.id] });
      const res = await ctx.settle(used.usageMessageId);
      hit = !!res.targets.find(t => t.token?.endsWith(bear.id))?.hit;
    }
    if ( !ctx.expect(hit, "le Loup touche l'Ours") ) return;
    await sleep(800);
    const effect = await poison();
    ctx.expect(!!effect, "l'Ours est Empoisonné");
    ctx.expect(effect?.duration?.expiry === "sourceStart", `durée lue dans le texte : expiration « ${effect?.duration?.expiry} » (attendu sourceStart)`);

    await ctx.nextTurn(); await sleep(1500);
    ctx.expect((await current()) === bear.id, "tour de l'Ours");
    ctx.expect(!!(await poison()), "pendant son tour, l'Ours est toujours Empoisonné");
    await ctx.nextTurn(); await sleep(2000);
    ctx.expect((await current()) === wolf.id, "tour suivant du Loup");
    ctx.expect(!(await poison()), "au début du tour du Loup, l'état est tombé");
  }
};
