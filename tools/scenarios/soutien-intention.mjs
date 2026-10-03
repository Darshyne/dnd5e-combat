/**
 * Soutien et Intention (SPEC §15.2, vocabulaire 2024 : Help = Soutien, Ready = Intention) :
 *  1. le Magicien, au contact du Zombi, utilise Soutien sur lui : une marque « distrait » est posée ;
 *  2. le Paladin, son allié, attaque le Zombi : avantage « soutien d'un allié », puis la marque tombe ;
 *  3. le Magicien prend l'Intention : son budget consigne `readied`.
 * Remet tokens, PV, items et marques en place.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "soutien et intention — avantage d'un allié, action préparée",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const paladin = await ctx.token("Paladin");
    const size = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const move = async (token, x, y) => {
      const r = await ctx.call("move-token", { tokenId: token.id, x, y });
      if ( !r?.moved && ((r?.after?.x !== x) || (r?.after?.y !== y)) ) throw new Error(`${token.name} non déplacé en ${x},${y}`);
    };
    for ( const t of [mage, paladin] ) ctx.restore(() => move(t, t.x, t.y));

    const zombiMarks = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
      return (data.delta?.effects ?? []).filter(e => e.flags?.[MODULE_ID]?.help);
    };
    ctx.restore(async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
      const scene = (await ctx.scene()).sceneId;
      for ( const e of (data.delta?.effects ?? []).filter(e => e.flags?.[MODULE_ID]?.help) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${scene}.Token.${zombi.id}.Actor.${data.actorId}`, effectId: e._id });
      }
    });
    const engineItem = async (token, kind) => ((await ctx.call("get-actor", { actorId: token.actorId })).items ?? [])
      .find(i => i.flags?.[MODULE_ID]?.basicAction === kind);

    await move(mage, zombi.x + size, zombi.y);
    await move(paladin, zombi.x, zombi.y - size);
    await ctx.startCombat([mage, paladin, zombi]);
    let help = null;
    for ( const until = Date.now() + 6000; !help && (Date.now() < until); await sleep(400) ) help = await engineItem(mage, "help");
    ctx.expect(!!help, `Soutien posé sur le Magicien (${help?.name ?? "absent"})`);
    if ( !help ) return;

    // 1. Soutien sur le Zombi.
    await ctx.use({ tokenId: mage.id, itemId: help._id, activityType: "utility", targetTokenIds: [zombi.id] });
    let marks = [];
    for ( const until = Date.now() + 5000; !marks.length && (Date.now() < until); await sleep(400) ) marks = await zombiMarks();
    ctx.expect(marks.length === 1, `marque posée sur le Zombi (${marks.map(e => e.name).join(", ") || "aucune"})`);

    // 2. Le Paladin attaque le Zombi.
    const weapon = ((await ctx.call("get-actor", { actorId: paladin.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && i.system?.equipped && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    const used = await ctx.use({ tokenId: paladin.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [zombi.id] });
    await ctx.settle(used.usageMessageId).catch(() => null);
    const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
    const adv = (attack?.flags?.[MODULE_ID]?.modifiers ?? attack?.flags?.modifiers)?.advantage ?? [];
    ctx.expect(adv.some(r => r.key === "helped"), `attaque du Paladin (${weapon.name}) : avantage du soutien (${adv.map(r => `${r.who}.${r.key}`).join(", ") || "aucun"})`);
    let left = marks;
    for ( const until = Date.now() + 5000; left.length && (Date.now() < until); await sleep(400) ) left = await zombiMarks();
    ctx.expect(!left.length, "la marque est consommée par l'attaque");

    // 3. Intention.
    const ready = await engineItem(mage, "ready");
    const r = await ctx.use({ tokenId: mage.id, itemId: ready._id, activityType: "utility" });
    let spent = null;
    for ( const until = Date.now() + 5000; !spent && (Date.now() < until); await sleep(400) ) {
      const m = (await ctx.call("list-chat-messages", { limit: 20, flagScope: MODULE_ID })).messages?.find(x => x.id === r.usageMessageId);
      spent = m?.flags?.[MODULE_ID]?.spent ?? m?.flags?.spent ?? null;
    }
    ctx.expect(spent?.after?.readied === true, `Intention : consignée au budget (readied ${spent?.after?.readied})`);
  }
};
