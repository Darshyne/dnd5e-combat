/**
 * Furtivité (Hide, SPEC §15.2, règles 2024), le Magicien en combat avec le Zombi :
 *  1. Furtivité jusqu'à réussir le test de Discrétion DD 15 : un effet Invisible est posé, qui porte le DD
 *     pour le localiser (son total) ;
 *  2. une attaque à la Dague : la Furtivité cesse après le jet ;
 *  3. de nouveau caché, Rayon de givre (composante verbale) : elle cesse aussi.
 * Les conditions (hors de vue de tout ennemi) passent par la légalité : ce scénario les confirme d'office ;
 * elles se vérifient à part (enemiesSeeing). Remet PV, effets et items en place.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "furtivité — caché (Invisible, DD), fin à l'attaque et au sort verbal",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    for ( const t of [zombi, mage] ) {
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const hiddenEffects = async () => ((await ctx.call("get-actor", { actorId: mage.actorId })).effects ?? [])
      .filter(e => e.flags?.[MODULE_ID]?.hidden);
    ctx.restore(async () => {
      for ( const e of await hiddenEffects() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: mage.actorId, effectId: e._id });
    });
    const engineItem = async kind => ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [])
      .find(i => i.flags?.[MODULE_ID]?.basicAction === kind);

    await ctx.startCombat([mage, zombi]);
    let hide = null;
    for ( const until = Date.now() + 6000; !hide && (Date.now() < until); await sleep(400) ) hide = await engineItem("hide");
    ctx.expect(!!hide, `Furtivité posée sur le Magicien (${hide?.name ?? "absente"})`);
    if ( !hide ) return;

    /** Furtivité jusqu'à réussir (au plus 20 essais : Discrétion +2 contre DD 15, 40 % de réussite). */
    async function hideUntilHidden() {
      for ( let i = 0; i < 20; i++ ) {
        const used = await ctx.use({ tokenId: mage.id, itemId: hide._id, activityType: "utility" });
        for ( const until = Date.now() + 6000; Date.now() < until; await sleep(300) ) {
          if ( (await ctx.messagesSince(used.usageMessageId)).some(m => m.type === "check") ) break;
        }
        await sleep(600);
        const effects = await hiddenEffects();
        if ( effects.length ) return effects[0];
      }
      return null;
    }

    // 1. Caché.
    const hidden = await hideUntilHidden();
    ctx.expect(!!hidden && (hidden.statuses ?? []).includes("invisible"),
      `caché : effet Invisible « ${hidden?.name ?? "absent"} », DD ${hidden?.flags?.[MODULE_ID]?.hidden?.dc ?? "?"}`);
    ctx.expect((hidden?.flags?.[MODULE_ID]?.hidden?.dc ?? 0) >= 15, "le DD pour le localiser est le total du test (≥ 15)");
    if ( !hidden ) return;

    // 2. Attaque : fin de la Furtivité.
    const stab = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id] });
    await ctx.settle(stab.usageMessageId).catch(() => null);
    let left = [hidden];
    for ( const until = Date.now() + 5000; left.length && (Date.now() < until); await sleep(400) ) left = await hiddenEffects();
    ctx.expect(!left.length, "après le jet d'attaque, le Magicien n'est plus caché");

    // 3. Sort à composante verbale : fin de la Furtivité.
    const again = await hideUntilHidden();
    ctx.expect(!!again, "de nouveau caché");
    if ( !again ) return;
    const ray = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id], rollAttack: false });
    await sleep(1500);
    left = await hiddenEffects();
    ctx.expect(!left.length, `après Rayon de givre (composante verbale), plus caché (${ray.used ? "sort lancé" : "sort non lancé"})`);
  }
};
