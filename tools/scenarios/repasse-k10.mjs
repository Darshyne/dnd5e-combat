/**
 * §331, lot K10 de la repasse des créatures : l'Avantage conditionnel lu dans le texte (`monsterAdvantage`). Arène des sorts : le Lanceur
 * (PNJ) reçoit la Frénésie sanguinaire du Baron sahuagin et une Massue ; la Cible (999 PV).
 *  - Cible blessée (900 PV) : l'attaque se fait avec l'Avantage (deux d20, le meilleur gardé) ;
 *  - Cible indemne (999 PV) : sans Avantage.
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
  name: "repasse-k10 — Avantage conditionnel des monstres lu dans le texte (Arène des sorts)",
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
    await lend("Compendium.dnd-monster-manual.actors.Actor.mmSahuaginBaron0.Item.mmBloodFrenzy000");
    const club = await lend(`${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    const t = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t.x - grid, y: t.y, elevation: 0 });
    await pause(800);
    /** Le jet d'attaque de l'utilisation : deux d20 (Avantage) ou un. */
    const attackDice = async hp => {
      await ctx.setHp(target, hp);
      await pause(600);
      const u = await ctx.use({ tokenId: caster.id, itemId: club, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1200);
      const attack = (await ctx.messagesSince(u.usageMessageId)).find(m => m.type === "attack") ?? (await ctx.call("list-chat-messages", { limit: 6 })).messages.find(m => m.type === "attack");
      const f = String(attack?.rolls?.[0]?.formula ?? "");
      return { formula: f, advantage: /2d20(?:kh|adv)/.test(f) };
    };
    const wounded = await attackDice(900);
    ctx.expect(wounded.advantage, `Cible blessée : attaque avec l'Avantage (${wounded.formula})`);
    const healthy = await attackDice(999);
    ctx.expect(!healthy.advantage, `Cible indemne : sans Avantage (${healthy.formula})`);
  }
};
