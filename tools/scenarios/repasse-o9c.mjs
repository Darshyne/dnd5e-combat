/**
 * §356, lot O9c de la repasse des objets : armes maudites qui s'emparent de leur porteur quand on le blesse. Arène de test (Guerrier,
 * Zombi au contact).
 *  1. Hache du berserker (posée sur une Hache d'armes, harmonisée), hors combat : le Zombi blesse le Guerrier — sauvegarde de Sagesse
 *     DD 15 ; ratée, marque « Folie furieuse contre Zombi ».
 *  2. Épée vengeresse (posée sur une Épée longue, harmonisée), hors combat : blessé, aucune sauvegarde (« en combat » seulement).
 *  3. En combat : blessé, sauvegarde ; ratée, marque « Vengeance contre Zombi » ; le Zombi à 0 PV, au début du tour du Guerrier la marque
 *     tombe.
 * Enchantements retirés, PV et marques remis.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9c — Hache du berserker et Épée vengeresse : la colère quand le porteur est blessé",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + g, at.y] } });
    const zombi = await ctx.token("Zombi");
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = ftok.actorId;
    const hpF = await ctx.hp(fighter), hpZ = await ctx.hp(zombi);
    const marks = async () => ((await ctx.call("get-actor", { actorId })).effects ?? []).filter(e => e.flags?.[MODULE_ID]?.wrath);
    const dropMarks = () => ctx.removeEffectsNamed(fighter, /Folie furieuse|Vengeance|Berserk/i).catch(() => {});
    ctx.restore(async () => { await dropMarks(); await ctx.setHp(fighter, hpF); await ctx.setHp(zombi, hpZ); });
    const set = (itemId, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: itemId } });
    const curse = async (source, activityId, base) => {
      const src = await ctx.ensureItem(fighter, `${DMG}${source}`);
      const weapon = await ctx.ensureItem(fighter, `${PHB}${base}`);
      const was = await ctx.engine("itemData", { tokenId: fighter.id, itemId: weapon, paths: ["system.attuned"] });
      const done = await ctx.engine("enchant", { tokenId: fighter.id, itemId: src, activityId, targetItemId: weapon }).catch(err => ({ error: err.message }));
      if ( done?.effectId ) ctx.restore(() => ctx.engine("removeItemEffect", { actorId, itemId: weapon, effectId: done.effectId }).catch(() => {}));
      ctx.restore(() => set(weapon, { system: { attuned: was?.["system.attuned"] ?? false } }).catch(() => {}));
      ctx.expect(!!done?.effectId, `${source} posé sur ${base} (${done?.error ?? "ok"})`);
      return weapon;
    };
    const slam = await ctx.itemId(zombi.id, "slam");
    /** Le Zombi frappe jusqu'à toucher ; rend les lignes du journal qui suivent. */
    const struck = async () => {
      for ( let i = 0; i < 12; i++ ) {
        await ctx.setHp(fighter, hpF);
        const before = (await ctx.engineLog()).length;
        const used = await ctx.use({ tokenId: zombi.id, itemId: slam, activityType: "attack", targetTokenIds: [fighter.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( !r?.targets?.[0]?.hit ) continue;
        await pause(3000);
        return (await ctx.engineLog()).slice(before);
      }
      return null;
    };

    // 1. Hache du berserker, hors combat.
    const axe = await curse("dmgBerserkerAxe0", "rWBvAvfPodSbiiLg", "phbwepBattleaxe0");
    await set(axe, { system: { attuned: true } });
    let raged = false, saw = 0;
    for ( let i = 0; (i < 6) && !raged; i++ ) {
      await dropMarks();
      const lines = await struck();
      if ( lines?.some(l => /wis saving throw/.test(l)) ) saw++;
      raged = (await marks()).some(e => e.flags[MODULE_ID].wrath.kind === "berserk");
    }
    ctx.expect(saw > 0, `Hache du berserker : blessé, sauvegarde de Sagesse (${saw} fois)`);
    ctx.expect(raged, "sauvegarde ratée : marque « Folie furieuse contre Zombi »");
    await dropMarks();
    await set(axe, { system: { attuned: false } });

    // 2. Épée vengeresse, hors combat.
    const sword = await curse("dmgSwordOfVengea", "nTfJsgV2sJIIUqXr", "phbwepLongsword0");
    await set(sword, { system: { attuned: true } });
    let lines = await struck();
    ctx.expect(!!lines && !lines.some(l => /Vengeance|wis saving throw/.test(l)), "Épée vengeresse hors combat : aucune sauvegarde");

    // 3. En combat.
    await ctx.startCombat([fighter, zombi]);
    const started = await ctx.combat();
    for ( const [t, v] of [[fighter, 20], [zombi, 5]] ) await ctx.call("set-initiative", { combatantId: started.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    await pause(800);
    let vengeful = false;
    for ( let i = 0; (i < 6) && !vengeful; i++ ) {
      await dropMarks();
      await struck();
      vengeful = (await marks()).some(e => e.flags[MODULE_ID].wrath.kind === "vengeance");
    }
    if ( ctx.expect(vengeful, "en combat, sauvegarde ratée : marque « Vengeance contre Zombi »") ) {
      await ctx.setHp(zombi, 0);
      await ctx.nextTurn();   // Zombi
      await ctx.nextTurn();   // Guerrier : début de son tour
      await pause(2000);
      ctx.expect(!(await marks()).length, "le Zombi à 0 PV : au début du tour du Guerrier, la vengeance prend fin");
    }
  }
};
