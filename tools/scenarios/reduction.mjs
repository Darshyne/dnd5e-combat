/**
 * Brique B14 « réduction et absorption de dégâts » (SPEC §16.11), le Zombi frappant au contact :
 *  1. Égide arcanique (PHB, donnée au Magicien le temps du scénario, créée par son activité « Hha69hPMTYWhDE4A ») :
 *     un coup qui touche est absorbé par la réserve (utilisations de l'item) avant les PV ; carte « absorbe » ;
 *     puis Armure du mage (abjuration, emplacement de niveau 1) la recharge de 2.
 *  2. Esquive instinctive (PHB, donnée au Roublard) : touché, le Roublard réagit (`autoReact: "first"`), les dégâts de
 *     l'attaque sont divisés par deux (arrondi inférieur). `autoReact` est recopié sur la carte par le client qui UTILISE
 *     l'attaque — celui du MJ qui porte le connecteur : il doit avoir le code ≥ 0.38.0 (F5).
 *  3. Lien protecteur (PHB) lancé par le Magicien sur le Guerrier : le Guerrier touché, le Magicien subit le même montant
 *     — par le moteur, ou par BLFX s'il est actif (il l'automatise déjà : le moteur s'efface, un seul propriétaire).
 * Les items sont donnés AVANT d'inscrire les remises en état (qui s'exécutent de la dernière à la première) : les effets
 * tombent avant que leurs items ne soient retirés — une animation BLFX ne se retire que si l'item d'origine existe encore.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "réduction — Égide arcanique, Esquive instinctive, Lien protecteur",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const rogue = await ctx.token("Roublard");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();

    const wardId = await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.classes.Item.phbwzdArcaneWard");
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplMageArmor0");
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplWardingBon");
    await ctx.ensureItem(rogue, "Compendium.dnd-players-handbook.classes.Item.phbrgeUncannyDod");

    const tokens = [mage, zombi, rogue, fighter];
    const hp0 = new Map();   // PV d’origine : la remise en état
    const startHp = new Map();   // PV de départ d’une attaque, quand ils diffèrent
    const effects0 = new Map();
    for ( const t of tokens ) {
      hp0.set(t.id, await ctx.hp(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const zHome = await ctx.position(zombi);
    // Comme ctx.removeStatusEffects : acteur lié par son id, acteur de token par l'uuid de l'acteur synthétique.
    const clearNew = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    for ( const t of tokens ) ctx.restore(() => ctx.setHp(t, hp0.get(t.id)));
    for ( const t of tokens ) ctx.restore(() => clearNew(t));
    const items = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Zombi a une attaque au corps à corps (${weapon?.name})`) ) return;

    const nextTo = async t => {
      const p = await ctx.position(t);
      await ctx.call("move-token", { tokenId: zombi.id, x: p.x - grid, y: p.y, elevation: p.elevation });
      await pause(800);
    };
    /** Le Zombi frappe `target` jusqu'à toucher ; rend la résolution et les messages qui ont suivi. */
    const strike = async (target, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        for ( const t of [target, zombi] ) await ctx.setHp(t, startHp.get(t.id) ?? hp0.get(t.id));
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [target.id], ...extra });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 });
        if ( !r.targets.find(t => t.name === target.name)?.hit ) continue;
        await pause(2500);
        return { r, messages: await ctx.messagesSince(since) };
      }
      return null;
    };
    const wardUses = async () => {
      const a = await ctx.call("get-actor", { actorId: mage.actorId });
      const item = (a.items ?? []).find(i => i._id === wardId);
      const uses = item?.system?.uses ?? {};
      return { spent: Number(uses.spent) || 0, max: uses.max };
    };

    // 1. Égide arcanique.
    await ctx.use({ tokenId: mage.id, itemId: wardId, activityId: "Hha69hPMTYWhDE4A", consume: true });
    await pause(1200);
    const w0 = await wardUses();
    ctx.log(`égide créée : ${JSON.stringify(w0)}`);
    await nextTo(mage);
    // PV pleins : un plancher à 0 fausserait « perd le reste » (vu le 2026-09-24 : Magicien à 3 PV, 9 − 5 → 3).
    const mageMax1 = ((await ctx.call("get-actor", { actorId: mage.actorId })).system ?? {}).attributes?.hp?.max ?? hp0.get(mage.id);
    startHp.set(mage.id, mageMax1);
    const hit = await strike(mage);
    if ( !ctx.expect(!!hit, "le Zombi touche le Magicien (20 essais au plus)") ) return;
    const absorbed = hit.messages.find(m => m.flags?.["dnd5e-combat"]?.absorbed);
    const amount = absorbed?.flags?.["dnd5e-combat"]?.absorbed?.amount ?? 0;
    ctx.expect(amount > 0, `l'égide absorbe (${amount})`);
    const w1 = await wardUses();
    ctx.expect(w1.spent === w0.spent + amount, `réserve dépensée d'autant (${w0.spent} → ${w1.spent})`);
    const lostMage = mageMax1 - await ctx.hp(mage);
    const struck = hit.messages.find(m => m.type === "damage")?.rolls?.reduce?.((sum, r) => sum + (r.total ?? 0), 0) ?? null;
    // Plafonné à ses PV : un gros jet (critique, 17) dépasse ce qu'il peut perdre (vu le 2026-09-28 : 17 − 5 → 7 PV, tous).
    ctx.expect(lostMage === Math.min(mageMax1, Math.max(0, (struck ?? 0) - amount)), `le Magicien ne perd que le reste : ${lostMage} PV (${struck} lancés, ${amount} absorbés)`);
    await ctx.use({ tokenId: mage.id, identifier: "mage-armor", activityType: "utility", targetTokenIds: [mage.id] });
    await pause(1500);
    const w2 = await wardUses();
    ctx.expect(w2.spent === Math.max(0, w1.spent - 2), `Armure du mage (abjuration, niveau 1) recharge l'égide de 2 (${w1.spent} → ${w2.spent})`);

    // 2. Esquive instinctive.
    await nextTo(rogue);
    const dodge = await strike(rogue, { usageConfig: { "dnd5e-combat": { autoReact: "first" } } });
    if ( !ctx.expect(!!dodge, "le Zombi touche le Roublard (20 essais au plus)") ) return;
    const t = dodge.r.targets.find(x => x.name === "Roublard");
    ctx.expect(t?.halved === true, `réaction prise, dégâts divisés par deux (${t?.reaction ?? "aucune réaction"})`);
    const dmgMsg = dodge.messages.find(m => m.type === "damage");
    const total = dmgMsg?.rolls?.reduce?.((s, r) => s + (r.total ?? 0), 0);
    ctx.expect(t?.damage?.applied === Math.trunc((total ?? 0) / 2), `${t?.damage?.applied} PV perdus pour ${total} lancés`);

    // 3. Lien protecteur : Magicien → Guerrier. L'égide retirée d'abord : elle absorberait les dégâts partagés.
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: wardId }).catch(() => {});
    await ctx.use({ tokenId: mage.id, identifier: "warding-bond", activityType: "utility", targetTokenIds: [fighter.id] });
    await pause(1500);
    // PV pleins : un plancher à 0 fausserait la comparaison.
    const mageActor = await ctx.call("get-actor", { actorId: mage.actorId });
    const mageMax = (mageActor.system ?? mageActor.actor?.system)?.attributes?.hp?.max ?? hp0.get(mage.id);
    await ctx.setHp(mage, mageMax);
    await nextTo(fighter);
    const bond = await strike(fighter);
    if ( !ctx.expect(!!bond, "le Zombi touche le Guerrier (20 essais au plus)") ) return;
    const lostFighter = hp0.get(fighter.id) - await ctx.hp(fighter);
    const lostMage2 = mageMax - await ctx.hp(mage);
    // BLFX automatise déjà le Lien protecteur (son message « You share the same fate! ») : le moteur s'efface alors.
    const shared = bond.messages.find(m => m.flags?.["dnd5e-combat"]?.shared)
      ?? (await ctx.call("list-chat-messages", { limit: 12 })).messages?.find(m => /same fate/i.test(m.flavor ?? m.content ?? ""));
    ctx.expect(!!shared, `partage des dégâts annoncé (${shared?.flags?.["dnd5e-combat"]?.shared ? "par le moteur" : shared ? "par BLFX" : "absent"})`);
    ctx.expect((lostFighter > 0) && (lostMage2 === lostFighter), `le Guerrier perd ${lostFighter} PV, le Magicien aussi : ${lostMage2}`);
  }
};
