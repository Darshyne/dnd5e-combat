/**
 * §410 (issue #44, lot 3) : plus d'emplacement, plus d'utilisation, sort non préparé — la fenêtre de légalité au lieu du refus sec de
 * dnd5e, et forcer n'en dépense rien. « Arène des refus » (`node tools/arene-refus.mjs`).
 *  1. Le Mage sans emplacement du 1er niveau lance Armure du mage sur lui-même : fenêtre « aucun emplacement » ; forcé, la carte part, marquée,
 *     les emplacements restent à 0 (rien de dépensé, pas d'erreur de dnd5e).
 *  2. Emplacements rendus, Armure du mage non préparée : fenêtre « non préparé ».
 *  3. Le Guerrier sans utilisation de Second souffle : fenêtre « plus d'utilisation » ; forcé, la carte part, les utilisations restent à 0.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "ressources forcées — emplacement, préparation, utilisations",
  scene: "Arène des refus",

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const fighter = await ctx.token("Guerrier des refus");
    const actorIdOf = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.actorId;
    const mageId = await actorIdOf(mage);
    const fighterId = await actorIdOf(fighter);
    const armor = await ctx.itemId(mage.id, "mage-armor");
    const wind = await ctx.itemId(fighter.id, "second-wind");
    const actor = id => ctx.call("get-actor", { actorId: id });
    const itemOf = async (id, itemId) => ((await actor(id)).items ?? []).find(i => i._id === itemId);

    const before = await actor(mageId);
    const slots = before.system?.spells?.spell1 ?? {};
    const prepared = (await itemOf(mageId, armor))?.system?.prepared ?? 1;
    const spent = (await itemOf(fighterId, wind))?.system?.uses?.spent ?? 0;
    ctx.restore(async () => {
      await ctx.call("update-actor", { actorId: mageId, actorData: { "system.spells.spell1.value": slots.value ?? slots.max ?? 2 } }).catch(() => {});
      await ctx.call("upsert-actor-item", { actorId: mageId, itemData: { "system.prepared": prepared }, match: { path: "_id", value: armor } }).catch(() => {});
      await ctx.call("upsert-actor-item", { actorId: fighterId, itemData: { "system.uses.spent": spent }, match: { path: "_id", value: wind } }).catch(() => {});
    });

    const legality = async (name, ms=6000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      for ( const n of [mage.name, fighter.name] ) {
        const d = await legality(n, 300);
        if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      }
    });
    const textOf = d => [d?.title, d?.content, d?.text].filter(Boolean).join(" ");
    /** Lance ; rend `{ dialog, messages }` après avoir répondu `button`. */
    const attempt = async (token, itemId, activityType, button) => {
      const since = await ctx.lastMessageId();
      await ctx.call("use-activity", { tokenId: token.id, itemId, activityType, configure: false, consume: true,
        targetTokenIds: [token.id], usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
      const dialog = await legality(token.name, 5000);
      if ( dialog ) await ctx.call("answer-dialog", { id: dialog.id, button });
      await pause(button === "go" ? 3000 : 1500);
      return { dialog, messages: await ctx.messagesSince(since) };
    };
    const marked = messages => messages.find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.overridden?.length);

    // 1. Plus d'emplacement.
    await ctx.call("update-actor", { actorId: mageId, actorData: { "system.spells.spell1.value": 0 } });
    let r = await attempt(mage, armor, "utility", "cancel");
    ctx.expect(!!r.dialog && /slot|emplacement/i.test(textOf(r.dialog)), `sans emplacement : la fenêtre le dit (${textOf(r.dialog).slice(0, 160)})`);
    ctx.expect(!marked(r.messages), "renoncé : aucune carte");
    r = await attempt(mage, armor, "utility", "go");
    const card = marked(r.messages);
    ctx.expect(!!card, `forcé : la carte part, marquée (${r.messages.map(m => m.type).join(", ")})`);
    const left = (await actor(mageId)).system?.spells?.spell1?.value;
    ctx.expect(left === 0, `forcé : aucun emplacement dépensé (${left})`);

    // 2. Non préparé.
    await ctx.call("update-actor", { actorId: mageId, actorData: { "system.spells.spell1.value": 2 } });
    await ctx.call("upsert-actor-item", { actorId: mageId, itemData: { "system.prepared": 0 }, match: { path: "_id", value: armor } });
    r = await attempt(mage, armor, "utility", "cancel");
    const said = textOf(r.dialog);
    ctx.expect(!!r.dialog && /prepared|préparé/i.test(said) && !/slot|emplacement/i.test(said), `non préparé : la fenêtre le dit, sans emplacement en cause (${said.slice(0, 160)})`);
    await ctx.call("upsert-actor-item", { actorId: mageId, itemData: { "system.prepared": prepared }, match: { path: "_id", value: armor } });

    // 3. Plus d'utilisation.
    const max = Number((await itemOf(fighterId, wind))?.system?.uses?.max) || 2;
    await ctx.call("upsert-actor-item", { actorId: fighterId, itemData: { "system.uses.spent": max }, match: { path: "_id", value: wind } });
    r = await attempt(fighter, wind, "heal", "go");
    ctx.expect(!!r.dialog && /uses|utilisation/i.test(textOf(r.dialog)), `sans utilisation : la fenêtre le dit (${textOf(r.dialog).slice(0, 160)})`);
    ctx.expect(!!marked(r.messages), "forcé : la carte part, marquée");
    const nowSpent = (await itemOf(fighterId, wind))?.system?.uses?.spent;
    ctx.expect(Number(nowSpent) === max, `forcé : rien de plus dépensé (${nowSpent} / ${max})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
