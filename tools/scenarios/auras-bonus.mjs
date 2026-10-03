/**
 * §18.12 — auras à bonus du Monster Manual, effets réparés par le contenu. Monde `ravenloft`, capacités prêtées au Loup :
 *  1. Autorité (Capitaine hobgobelin) : le Zombi, allié à 1,50 m, reçoit la copie (12 changements, aucun état) ; sa
 *     sauvegarde contre la Flamme sacrée d'Alara se jette avec l'avantage (2d20), son Coup contre Bramo aussi ; éloigné de
 *     6 m, la copie tombe et la sauvegarde redevient 1d20. Le Loup (lui-même) a la sienne.
 *  2. Commandement des morts-vivants (Chevalier de la mort) : le Zombi (mort-vivant) la reçoit, l'Ours brun (bête) non.
 *  3. Aura de bravoure (Chevalier en quête) : la copie sur le Zombi rend immunisé à Charmé et Effrayé, sans les poser.
 */
const CAPTAIN = "Compendium.dnd-monster-manual.actors.Actor.mmHobgoblinCapta";
const DEATH_KNIGHT = "Compendium.dnd-monster-manual.actors.Actor.mmDeathKnight000";
const QUESTING = "Compendium.dnd-monster-manual.actors.Actor.mmQuestingKnight";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "auras à bonus — Autorité, Commandement des morts-vivants, Bravoure",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi", "Ours brun", "Alara", "Bramo"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup, Zombi, Ours brun, Alara ou Bramo absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const bear = await ctx.token("Ours brun");
    const alara = await ctx.token("Alara");
    const bramo = await ctx.token("Bramo");
    const grid = await ctx.gridSize();
    for ( const t of [wolf, zombi, bear, bramo] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const { data: wolfTok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });

    /** Prête l'item `identifier` d'un acteur du compendium au Loup ; rend de quoi le retirer. */
    const lend = async (uuid, identifier) => {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === identifier);
      const r = await ctx.call("upsert-actor-item", { actorId: wolfTok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(wolf.id, identifier));
      const remove = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: wolfTok.actorId, itemId }).catch(() => {});
      ctx.restore(remove);
      await sleep(1500);
      return remove;
    };
    const copies = async t => (await ctx.effects(t)).filter(e => e.flags?.[MODULE_ID]?.aura);
    const copyOf = async (t, key) => (await copies(t)).find(e => e.flags[MODULE_ID].aura.key === key) ?? null;
    const changesOf = e => e?.system?.changes ?? e?.changes ?? [];

    // Loup au centre, Zombi et Ours à côté, Bramo à portée du Coup du Zombi.
    const at = await ctx.position(wolf);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: bear.id, x: at.x - grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: bramo.id, x: at.x + 2 * grid, y: at.y, elevation: at.elevation });
    await sleep(1000);

    /** La Flamme sacrée d'Alara sur le Zombi : la formule de sa sauvegarde. */
    const saveFormula = async () => {
      await ctx.setHp(zombi, 100);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: alara.id, identifier: "sacred-flame", activityType: "save", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      return (await ctx.messagesSince(since)).find(m => m.type === "save")?.rolls?.[0]?.formula ?? "";
    };

    // 1. Autorité.
    const removeAuthority = await lend(CAPTAIN, "aura-of-authority");
    const authority = await copyOf(zombi, "aura-of-authority");
    ctx.expect(!!authority, "Autorité : le Zombi, allié à 1,50 m, reçoit la copie");
    ctx.expect(changesOf(authority).length === 12 && !(authority?.statuses ?? []).length, `copie : 12 changements, aucun état (${changesOf(authority).length}, ${JSON.stringify(authority?.statuses)})`);
    ctx.expect(!!(await copyOf(wolf, "aura-of-authority")), "Autorité : le Loup lui-même aussi (« le hobgobelin et ses alliés »)");
    ctx.expect(!(await copyOf(bramo, "aura-of-authority")), "Autorité : Bramo (ennemi) non");
    ctx.expect(/^2d20/.test(await saveFormula()), "sauvegarde du Zombi dans l'aura : avantage (2d20)");
    const since = await ctx.lastMessageId();
    const slam = await ctx.use({ tokenId: zombi.id, identifier: "slam", activityType: "attack", targetTokenIds: [bramo.id] });
    await ctx.settle(slam.usageMessageId).catch(() => null);
    const attack = (await ctx.messagesSince(since)).find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "";
    ctx.expect(/^2d20/.test(attack), `Coup du Zombi dans l'aura : avantage (${attack})`);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + 5 * grid, y: at.y, elevation: at.elevation });
    await sleep(1500);
    ctx.expect(!(await copyOf(zombi, "aura-of-authority")), "le Zombi à 7,50 m : la copie tombe");
    ctx.expect(/^1d20/.test(await saveFormula()), "sauvegarde hors de l'aura : 1d20");
    await removeAuthority();
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await sleep(1500);

    // 2. Commandement des morts-vivants.
    const removeMarshal = await lend(DEATH_KNIGHT, "marshal-undead");
    ctx.expect(!!(await copyOf(zombi, "marshal-undead")), "Commandement : le Zombi (mort-vivant) la reçoit");
    ctx.expect(!(await copyOf(bear, "marshal-undead")), "Commandement : l'Ours brun (bête) non");
    ctx.expect(!(await copyOf(wolf, "marshal-undead")), "Commandement : pas le porteur (« lui exclu »)");
    await removeMarshal();
    await sleep(1000);

    // 3. Aura de bravoure.
    await lend(QUESTING, "aura-of-bravery");
    const bravery = await copyOf(zombi, "aura-of-bravery");
    ctx.expect(!!bravery, "Bravoure : le Zombi la reçoit");
    ctx.expect(!(bravery?.statuses ?? []).length, `Bravoure : la copie ne pose ni Charmé ni Effrayé (${JSON.stringify(bravery?.statuses)})`);
    ctx.expect(changesOf(bravery).map(c => c.value).sort().join(",") === "charmed,frightened", `Bravoure : immunité à Charmé et Effrayé (${changesOf(bravery).map(c => `${c.key}=${c.value}`).join(", ")})`);
  }
};
