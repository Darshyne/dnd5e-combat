/**
 * §334, restes du lot K10 de la repasse des créatures. Arène des sorts : le Lanceur (PNJ), la Cible (999 PV), l'« Ennemi au contact ».
 *  - Morsure du Requin géant (condition d'activation « with Advantage if the target doesn't have all its Hit Points ») : Avantage contre
 *    la Cible blessée, pas contre la Cible indemne ;
 *  - Déplacement de la Bête éclipsante prêté au Lanceur (« Attack rolls against the displacer beast have Disadvantage ») : l'Ennemi
 *    l'attaque avec le Désavantage.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.Actor";
const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k10b — Avantage de la condition d'activation, Désavantage contre la créature (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const casterHp = await ctx.hp(caster);
    const lent = [];
    const lend = async (token, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: token.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([token.actorId, r.id]);
      return r.id;
    };
    ctx.restore(async () => {
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.setHp(caster, casterHp).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const [actorId, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: id }).catch(() => {});
    });
    const formulaOf = async (tokenId, itemId, targetId) => {
      const u = await ctx.use({ tokenId, itemId, activityType: "attack", targetTokenIds: [targetId], rollDamage: true });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1200);
      const attack = (await ctx.messagesSince(u.usageMessageId)).find(m => m.type === "attack") ?? (await ctx.call("list-chat-messages", { limit: 6 })).messages.find(m => m.type === "attack");
      return String(attack?.rolls?.[0]?.formula ?? "");
    };

    const bite = await lend(caster, `${MM}.mmGiantShark0000.Item.mmBite0000000000`);
    const t0 = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
    await pause(800);
    await ctx.setHp(target, 900);
    await pause(500);
    const wounded = await formulaOf(caster.id, bite, target.id);
    ctx.expect(/2d20(?:kh|adv)/.test(wounded), `Morsure contre la Cible blessée : Avantage (${wounded})`);
    await ctx.setHp(target, 999);
    await pause(500);
    const healthy = await formulaOf(caster.id, bite, target.id);
    ctx.expect(!/2d20/.test(healthy), `Morsure contre la Cible indemne : sans Avantage (${healthy})`);

    await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 });
    await pause(800);
    await lend(caster, `${MM}.mmDisplacerBeast.Item.mmDisplacement00`);
    const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    const against = await formulaOf(enemy.id, club, caster.id);
    ctx.expect(/2d20(?:kl|dis)/.test(against), `l'Ennemi attaque la créature au Déplacement avec le Désavantage (${against})`);
  }
};
