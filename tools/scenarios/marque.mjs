/**
 * Brique B10 « marque consommée » (SPEC §16.12) :
 *  1. Rayon traçant (PHB, donné au Magicien le temps du scénario) touche le Zombi → marque (effet « Guiding Bolt ») ;
 *     le Guerrier attaque le Zombi → son jet a l'avantage déclaré (raison `content`) et la marque tombe.
 *  2. Moquerie cruelle (PHB) : le Zombi rate sa sauvegarde → effet « Mocked » ; il attaque le Magicien → son jet a le
 *     désavantage déclaré et l'effet tombe.
 * La consommation est jouée par le MJ actif ; les raisons d'avantage sont écrites sous le jet par le client qui UTILISE
 * l'attaque (celui du MJ qui porte le connecteur) : cette partie demande que ce client ait le code ≥ 0.39.0 (F5).
 * Les items sont donnés AVANT d'inscrire les remises en état : les effets tombent avant que leurs items soient retirés.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "marque — Rayon traçant consommé par l'attaque suivante, Moquerie cruelle par la sienne",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const boltId = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplGuidingBol");
    const mockId = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplViciousMoc");
    const hp0 = { z: await ctx.hp(zombi), m: await ctx.hp(mage), f: await ctx.hp(fighter) };
    ctx.restore(() => ctx.setHp(zombi, hp0.z));
    ctx.restore(() => ctx.setHp(mage, hp0.m));
    ctx.restore(() => ctx.setHp(fighter, hp0.f));
    // Par l’origine (l’item du sort), pas par le nom : Babele traduit les noms d’effets sur le client du connecteur.
    const zombiEffects = async itemId => (await ctx.effects(zombi)).filter(e => JSON.stringify([e.origin, e.system?.origin]).includes(itemId));
    const modifiersOf = async usageId => {
      const m = (await ctx.messagesSince(usageId)).find(x => x.type === "attack");
      return m?.flags?.["dnd5e-combat"]?.modifiers ?? { advantage: [], disadvantage: [] };
    };
    const weaponOf = async token => {
      const items = (await ctx.call("get-actor", { actorId: token.actorId })).items ?? [];
      return items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack")
        && (i.system?.equipped !== false));
    };

    // 1. Rayon traçant.
    let marked = false;
    for ( let i = 0; i < 20 && !marked; i++ ) {
      await ctx.setHp(zombi, hp0.z);
      const used = await ctx.use({ tokenId: mage.id, identifier: "guiding-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      marked = !!r.targets.find(t => t.name === "Zombi")?.hit;
    }
    if ( !ctx.expect(marked, "Rayon traçant touche le Zombi (20 essais au plus)") ) return;
    await pause(1200);
    ctx.expect((await zombiEffects(boltId)).length === 1, "marque posée sur le Zombi");
    const sword = await weaponOf(fighter);
    const second = await ctx.use({ tokenId: fighter.id, itemId: sword._id, activityType: "attack", targetTokenIds: [zombi.id] });
    await ctx.settle(second.usageMessageId);
    await pause(1500);
    const m1 = await modifiersOf(second.usageMessageId);
    ctx.expect((m1.advantage ?? []).some(r => r.who === "content"), `le Guerrier attaque avec l'avantage déclaré (${(m1.advantage ?? []).map(r => r.key).join(", ") || "aucun"})`);
    ctx.expect((await zombiEffects(boltId)).length === 0, "la marque est consommée par cette attaque");

    // 2. Moquerie cruelle.
    let mocked = false;
    for ( let i = 0; i < 20 && !mocked; i++ ) {
      await ctx.setHp(zombi, hp0.z);
      const used = await ctx.use({ tokenId: mage.id, identifier: "vicious-mockery", activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      mocked = r.targets.find(t => t.name === "Zombi")?.save?.success === false;
    }
    if ( !ctx.expect(mocked, "le Zombi rate sa sauvegarde contre la Moquerie cruelle (20 essais au plus)") ) return;
    await pause(1200);
    ctx.expect((await zombiEffects(mockId)).length === 1, "effet « Mocked » sur le Zombi");
    const slam = await weaponOf(zombi);
    const bite = await ctx.use({ tokenId: zombi.id, itemId: slam._id, activityType: "attack", targetTokenIds: [mage.id] });
    await ctx.settle(bite.usageMessageId);
    await pause(1500);
    const m2 = await modifiersOf(bite.usageMessageId);
    ctx.expect((m2.disadvantage ?? []).some(r => r.who === "content"), `le Zombi attaque avec le désavantage déclaré (${(m2.disadvantage ?? []).map(r => r.key).join(", ") || "aucun"})`);
    ctx.expect((await zombiEffects(mockId)).length === 0, "l'effet est consommé par son attaque");
  }
};
