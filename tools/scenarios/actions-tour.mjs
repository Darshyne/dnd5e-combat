/**
 * Actions de base et main secondaire (SPEC §15.2), sur le tour du Magicien, au contact du Zombi :
 *  1. au début du combat, le MJ pose sur le Magicien (personnage d'un joueur) les items Pointe,
 *     Désengagement, Esquive qui lui manquent ;
 *  2. Pointe par son item : l'action est dépensée, le déplacement du tour doublé (`dashed`) ;
 *  3. Dague au contact (arme Légère) : l'attaque ouvre la main secondaire (`lightAttack`) ;
 *  4. Dague en mode `offhand` choisi au jet (le chemin de la fiche et de la barre BG3) : le MJ corrige
 *     la dépense au jet d'attaque — l'action rendue, l'action Bonus débitée (`offhand`).
 * Le budget se lit sur la carte d'utilisation (`spent`, écrit par le MJ). Remet le Magicien à sa
 * place, les PV du Zombi, et retire les items que le moteur a posés pendant le scénario.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "actions de base et main secondaire — Pointe, Dague, Dague en main secondaire",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    const itemsOf = async () => (await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [];
    const basics = items => items.filter(i => i.flags?.[MODULE_ID]?.basicAction);

    // Au contact du Zombi, pour que la Dague soit une attaque de mêlée sans détour.
    const size = await ctx.gridSize();
    const home = { x: mage.x, y: mage.y };
    const moveMage = async (x, y) => {
      const r = await ctx.call("move-token", { tokenId: mage.id, x, y });
      if ( !r?.moved ) throw new Error(`Magicien non déplacé en ${x},${y}`);
    };
    ctx.restore(() => moveMage(home.x, home.y));
    await moveMage(zombi.x + size, zombi.y);

    // 1. Combat : les actions de base sont posées.
    await ctx.startCombat([mage, zombi]);   // retire lui-même, à la fin, les items que le moteur aura posés
    let placed = [];
    for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
      placed = basics(await itemsOf());
      if ( placed.length >= 3 ) break;
    }
    ctx.expect(placed.length >= 3, `actions de base sur le Magicien : ${placed.map(i => i.name).join(", ") || "aucune"}`);
    const dashItem = placed.find(i => i.flags[MODULE_ID].basicAction === "dash");
    if ( !dashItem ) return;

    // Tour du Magicien.
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      const current = combat.combatants?.find(c => c.id === combat.currentCombatantId);
      if ( current?.tokenId === mage.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }

    /** La dépense consignée par le MJ sur la carte d'utilisation (attend qu'elle arrive, ou sa correction). */
    async function spentOn(usageMessageId, accept=() => true) {
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
        const message = (await ctx.messagesSince(usageMessageId)).find(m => m.id === usageMessageId)
          ?? (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(m => m.id === usageMessageId);
        const spent = message?.flags?.[MODULE_ID]?.spent ?? message?.flags?.spent;
        if ( spent && accept(spent) ) return spent;
      }
      return null;
    }

    // 2. Pointe.
    const dash = await ctx.use({ tokenId: mage.id, itemId: dashItem._id, activityType: "utility" });
    const s1 = await spentOn(dash.usageMessageId);
    ctx.expect(s1?.after?.dashed === true && s1.after.action === 0, `Pointe : action ${s1?.before?.action} → ${s1?.after?.action}, déplacement doublé (${s1?.after?.dashed})`);

    // 3. Dague au contact : arme Légère, dans l'action Attaquer.
    const stab = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { attackMode: "oneHanded" } });
    await ctx.settle(stab.usageMessageId).catch(() => null);
    const s2 = await spentOn(stab.usageMessageId);
    ctx.expect(s2?.after?.lightAttack === true, `Dague : attaque d'arme Légère consignée (lightAttack ${s2?.after?.lightAttack})`);

    // 4. Dague en main secondaire, mode choisi au jet.
    // dnd5e retient le dernier mode d'attaque de l'item (`flags.dnd5e.last`) : on le rend, sinon la dague resterait en main
    // secondaire pour les scénarios suivants (dégâts sans modificateur, vu le 2026-09-28).
    ctx.restore(async () => {
      const id = await ctx.itemId(mage.id, "dagger");
      const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === id);
      const last = item?.flags?.dnd5e?.last ?? {};
      const reset = Object.fromEntries(Object.entries(last).filter(([, v]) => v?.attackMode === "offhand")
        .map(([k]) => [`flags.dnd5e.last.${k}.attackMode`, "oneHanded"]));
      if ( Object.keys(reset).length ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: reset, match: { path: "_id", value: id } });
    });
    const off = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { attackMode: "offhand" } });
    await ctx.settle(off.usageMessageId).catch(() => null);
    const s3 = await spentOn(off.usageMessageId, s => s.offhand === true);
    ctx.expect(s3?.offhand === true, "main secondaire choisie au jet : dépense corrigée par le MJ");
    ctx.expect(s3?.after?.bonus === 0 && s3?.after?.action === s3?.before?.action,
      `main secondaire : action Bonus ${s3?.before?.bonus} → ${s3?.after?.bonus}, action inchangée (${s3?.before?.action} → ${s3?.after?.action})`);
  }
};
