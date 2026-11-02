/**
 * §334, restes du lot K6 de la repasse des créatures : la fenêtre d'une Réaction de monstre lue dans son déclencheur. Arène des sorts :
 * le Lanceur (PNJ) et l'« Ennemi au contact » (Massue).
 *  - Bouclier collant du Kuo-toa (« A creature misses the kuo-toa with a melee attack roll ») : l'Ennemi rate le Lanceur au contact, la
 *    Réaction est prise (`autoReact: "first"`) — sa carte d'utilisation paraît ;
 *  - Sang démoniaque du Baron sahuagin (« takes Piercing or Slashing damage ») : touché par une Massue (contondant), rien n'est proposé.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
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
  name: "repasse-k6b — Réactions de monstres proposées d'après leur déclencheur (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const casterHp = await ctx.hp(caster);
    const lent = [];
    const lend = async (token, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: token.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([token.actorId, r.id]);
      return { id: r.id, name: data.name };
    };
    ctx.restore(async () => {
      await ctx.setHp(caster, casterHp).catch(() => {});
      for ( const [actorId, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: id }).catch(() => {});
    });
    const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    /** Une utilisation de la Réaction parue après ce message : une carte du moteur liée à l'item (son nom ou son uuid). */
    const reactedSince = async (messageId, name) => {
      const found = m => JSON.stringify(m).includes(name);
      const engine = await ctx.messagesSince(messageId).catch(() => []);
      if ( engine.some(found) ) return true;
      const { messages } = await ctx.call("list-chat-messages", { limit: 60 }).catch(() => ({ messages: [] }));
      const all = messages ?? [];
      const from = all.findIndex(m => m.id === messageId);
      return all.slice(from < 0 ? 0 : from).some(found) || all.slice(0, from < 0 ? all.length : from).some(found);
    };

    const shield = await lend(caster, `${MM}.mmKuotoa00000000.Item.mmStickyShield00`);
    let checked = false;
    for ( let i = 0; (i < 30) && !checked; i++ ) {
      await ctx.setHp(caster, casterHp);
      await pause(300);
      const u = await ctx.use({ tokenId: enemy.id, itemId: club.id, activityType: "attack", targetTokenIds: [caster.id], rollDamage: true,
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Lanceur")?.hit !== false ) continue;
      await pause(2500);
      ctx.expect(await reactedSince(u.usageMessageId, "A8a55LxaAvNmIUnj"), `raté au contact : le Bouclier collant est pris (${shield.name})`);
      checked = true;
    }
    ctx.expect(checked, "l'Ennemi rate le Lanceur (30 essais au plus)");

    const blood = await lend(caster, `${MM}.mmSahuaginBaron0.Item.mmFiendishBlood0`);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      await ctx.setHp(caster, casterHp);
      await pause(300);
      const u = await ctx.use({ tokenId: enemy.id, itemId: club.id, activityType: "attack", targetTokenIds: [caster.id], rollDamage: true,
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Lanceur")?.hit !== true ) continue;
      await pause(2500);
      ctx.expect(!(await reactedSince(u.usageMessageId, "9JNSVEpH1x9MUvsZ")), "touché par la Massue (contondant) : le Sang démoniaque n'est pas proposé");
      checked = true;
    }
    ctx.expect(checked, "l'Ennemi touche le Lanceur (20 essais au plus)");
  }
};
