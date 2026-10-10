/**
 * §121 : durée et combustible des sources portées, sur un personnage qui a une Lampe (monde `ravenloft` : Alara ; `dnd-6` : le
 * premier token qui en porte une). La torche et la flasque d'huile sont prêtées depuis le Manuel des joueurs.
 *  1. Lampe allumée par son activité, consommation demandée : rien n'est dépensé par dnd5e, l'effet dure 6 h.
 *  2. Une heure passe, on l'éteint : 5 h notées sur la lampe ; rallumée : l'effet reprend à 5 h.
 *  3. Cinq heures de plus : l'effet expire, la lampe est vide (0), un message le dit.
 *  4. Rallumée : la flasque d'huile est prise (la dernière : l'item part), 6 h.
 *  5. Vide et sans huile : refusé, rien ne s'allume.
 *  6. Torche (2) allumée sans activité (menu de l'inventaire) : 1 h, équipée ; une bougie dans l'autre main ; la lampe, plus de main
 *     libre : refusée ; la bougie éteinte retourne au sac. Une heure passe : une torche de moins, la suivante éteinte, neuve, rangée.
 * Mains : armes et boucliers équipés sont rangés le temps du scénario (une source allumée se tient en main), puis rééquipés.
 * Remet le temps du monde, les drapeaux de la lampe et les effets.
 */
const MODULE_ID = "dnd5e-combat";
const TORCH = "Compendium.dnd-players-handbook.equipment.Item.phbagTorch000000";
const OIL = "Compendium.dnd-players-handbook.equipment.Item.phbagOil00000000";
const CANDLE = "Compendium.dnd-players-handbook.equipment.Item.phbagCandle00000";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "lumières portées — durée, extinction, huile, torche consumée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    let token = null, lampId = null;
    for ( const t of tokens ) {
      if ( !t.actorId ) continue;
      const id = await ctx.itemId(t.id, "lamp").catch(() => null);
      if ( id ) { token = await ctx.token(t.name); lampId = id; break; }
    }
    if ( !token ) { ctx.log("aucun token avec une Lampe : non applicable"); return; }
    const actorId = token.actorId;
    const state = itemId => ctx.engine("lightState", { actorId, itemId });
    const advance = async seconds => { await ctx.engine("advanceTime", { seconds }); await pause(2500); };
    const effects = async () => (await ctx.effects(token)).filter(e => e.flags?.[MODULE_ID]?.carriedLightOf);
    const lamp = async () => ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === lampId);
    const start = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
    ctx.restore(async () => {
      const now = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
      await ctx.engine("advanceTime", { seconds: start - now });
      for ( const e of await effects() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => null);
      await ctx.call("upsert-actor-item", { actorId, itemData: { [`flags.${MODULE_ID}.-=burnLeft`]: null, "system.uses.spent": 0 }, match: { path: "_id", value: lampId } });
    });
    // Une lampe déjà allumée par la partie : on part d'une lampe éteinte et remplie.
    if ( (await state(lampId))?.lit ) await ctx.engine("toggleLight", { actorId, itemId: lampId, on: false });
    await ctx.call("upsert-actor-item", { actorId, itemData: { [`flags.${MODULE_ID}.-=burnLeft`]: null, "system.uses.spent": 0 }, match: { path: "_id", value: lampId } });
    const H = 3600;
    const item = async id => ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === id);
    const setItem = (id, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: id } });
    // Les mains libres : armes et boucliers rangés le temps du scénario.
    const inHand = ((await ctx.call("get-actor", { actorId })).items ?? []).filter(i => i.system?.equipped
      && ((i.type === "weapon") || ((i.type === "equipment") && (i.system?.type?.value === "shield")))).map(i => i._id);
    for ( const id of inHand ) await setItem(id, { "system.equipped": false });
    ctx.restore(async () => { for ( const id of inHand ) await setItem(id, { "system.equipped": true }); });
    if ( (await item(lampId))?.system?.equipped ) await setItem(lampId, { "system.equipped": false });

    // 1. Allumée par l'activité.
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    let s = await state(lampId);
    ctx.expect(s?.lit && (Math.round(s.left) === 6 * H), `lampe allumée par son activité, 6 h (${s?.left})`);
    ctx.expect((await lamp())?.system?.uses?.spent === 0, "dnd5e n'a rien dépensé sur la lampe");
    ctx.expect((await lamp())?.system?.equipped === true, "allumée : la lampe est équipée");
    const fx = await effects();
    ctx.expect(fx.length === 1 && (fx[0].duration?.value === 6 * H), `un effet lumineux, durée 6 h (${fx[0]?.duration?.value})`);

    // 2. Une heure, éteinte, rallumée.
    await advance(H);
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    s = await state(lampId);
    ctx.expect(!s?.lit && (Math.round(s.left) === 5 * H), `éteinte après 1 h : 5 h notées (${s?.left})`);
    ctx.expect(!(await effects()).length, "éteinte : plus d'effet lumineux");
    ctx.expect((await lamp())?.system?.equipped === false, "éteinte : la lampe retourne au sac");
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    s = await state(lampId);
    ctx.expect(s?.lit && (Math.round(s.left) === 5 * H), `rallumée : reprend à 5 h (${s?.left})`);

    // 3. Elle s'épuise.
    const since = await ctx.lastMessageId();
    await advance(5 * H + 60);
    s = await state(lampId);
    ctx.expect(!s?.lit && (s.left === 0), `5 h plus tard : éteinte, vide (${s?.left})`);
    ctx.expect(!(await effects()).length, "l'effet expiré est retiré");
    const msgs = await ctx.messagesSince(since);
    ctx.expect(msgs.some(m => m.flags?.[MODULE_ID]?.burnOut), "un message dit que la lampe n'a plus d'huile");

    // 4. Rallumée avec une flasque (la sienne s'il en a, sinon celle prêtée).
    await ctx.ensureItem(token, OIL, { system: { quantity: 1 } });
    const oils = async () => ((await ctx.call("get-actor", { actorId })).items ?? []).filter(i => (i.system?.identifier === "oil"));
    const flasks = async () => (await oils()).reduce((n, i) => n + (i.system?.quantity ?? 1), 0);
    const before = await flasks();
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    s = await state(lampId);
    ctx.expect(s?.lit && (Math.round(s.left) === 6 * H), `vide, rallumée : une flasque versée, 6 h (${s?.left})`);
    ctx.expect((await flasks()) === before - 1, `une flasque de moins (${before} → ${await flasks()})`);

    // 5. Vide et sans huile.
    await ctx.engine("toggleLight", { actorId, itemId: lampId, on: false });
    await ctx.call("upsert-actor-item", { actorId, itemData: { [`flags.${MODULE_ID}.burnLeft`]: 0 }, match: { path: "_id", value: lampId } });
    // Plus une goutte d'huile sur la fiche (le filet de sécurité remet les quantités).
    for ( const o of await oils() ) await ctx.call("upsert-actor-item", { actorId, itemData: { "system.quantity": 0 }, match: { path: "_id", value: o._id } });
    const refused = await ctx.engine("toggleLight", { actorId, itemId: lampId, on: true });
    ctx.expect(!refused.changed && (refused.reason === "noFuel") && !(await effects()).length, `vide sans huile : refusé (${refused.reason})`);

    // 6. La torche.
    const torchId = await ctx.ensureItem(token, TORCH, { system: { quantity: 2 } });
    const lit = await ctx.engine("toggleLight", { actorId, itemId: torchId, on: true });
    ctx.expect(lit.changed && lit.lit && (Math.round(lit.left) === H), `torche allumée sans activité : 1 h (${lit.left})`);
    ctx.expect((await item(torchId))?.system?.equipped === true, "allumée : la torche est équipée");
    const candleId = await ctx.ensureItem(token, CANDLE, { system: { quantity: 1 } });
    const candle = await ctx.engine("toggleLight", { actorId, itemId: candleId, on: true });
    ctx.expect(candle.changed && candle.lit, "une bougie dans l'autre main");
    await setItem(lampId, { [`flags.${MODULE_ID}.burnLeft`]: H });
    const full = await ctx.engine("toggleLight", { actorId, itemId: lampId, on: true });
    ctx.expect(!full.changed && (full.reason === "noHand"), `torche et bougie en main : la lampe est refusée (${full.reason} : ${(full.held ?? []).join(", ")})`);
    const out = await ctx.engine("toggleLight", { actorId, itemId: candleId, on: false });
    ctx.expect(out.changed && ((await item(candleId))?.system?.equipped === false), "la bougie éteinte retourne au sac");
    await advance(H + 60);
    const torch = ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === torchId);
    s = await state(torchId);
    ctx.expect(torch?.system?.quantity === 1, `une heure plus tard : une torche de moins (${torch?.system?.quantity})`);
    ctx.expect(s && !s.lit && (Math.round(s.left) === H), `la torche suivante est éteinte et neuve (${s?.left})`);
    ctx.expect(torch?.system?.equipped === false, "la torche suivante est rangée");
  }
};
