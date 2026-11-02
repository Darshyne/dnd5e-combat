/**
 * §334, restes du lot K10 de la repasse des créatures : la sensibilité au soleil. Arène des sorts (lumière globale vive, obscurité 0 :
 * le jour) : le Lanceur (PNJ) et la Cible.
 *  - Sensibilité au soleil du Drider prêtée au Lanceur : ses attaques ont le Désavantage au soleil.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k10d — Désavantage au soleil (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const lend = async (uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    ctx.restore(async () => {
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const t0 = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
    await pause(800);
    await lend("Compendium.dnd-monster-manual.actors.Actor.mmDrider00000000.Item.mmSunlightSensit");
    const club = await lend(`${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    const u = await ctx.use({ tokenId: caster.id, itemId: club, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
    await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(1200);
    const attack = (await ctx.messagesSince(u.usageMessageId)).find(m => m.type === "attack") ?? (await ctx.call("list-chat-messages", { limit: 6 })).messages.find(m => m.type === "attack");
    const formula = String(attack?.rolls?.[0]?.formula ?? "");
    ctx.expect(/2d20(?:kl|dis)/.test(formula), `au soleil : attaque avec le Désavantage (${formula})`);
  }
};
