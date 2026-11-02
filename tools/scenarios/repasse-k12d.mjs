/**
 * §333, lot K12 de la repasse des créatures (suite). Arène des sorts : le Lanceur (PNJ) et l'« Ennemi au contact ».
 *  - Posture défensive (Amiral pirate, « adds 4 to its AC against melee attack rolls (including the triggering attack) ») prêtée au
 *    Lanceur : l'Ennemi le frappe au contact, la réaction est prise (`autoReact: "first"`) et l'effet « +4 CA » posé.
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
  name: "repasse-k12d — Posture défensive lue dans le texte (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, enemy] = await Promise.all(names.map(n => ctx.token(n)));
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
    const clearOn = async (token, ...idents) => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${token.id}.Actor.${data.actorId}` };
      for ( const e of await ctx.effectsFrom(token, ...idents) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e.id }).catch(() => {});
    };
    ctx.restore(async () => {
      await clearOn(caster, "defensive-stance");
      for ( const [actorId, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: id }).catch(() => {});
    });

    await lend(caster, `${MM}.mmPirateAdmiral0.Item.mmDefensiveStanc`);
    const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    let reacted = false;
    for ( let i = 0; (i < 20) && !reacted; i++ ) {
      await clearOn(caster, "defensive-stance");
      await pause(400);
      const u = await ctx.use({ tokenId: enemy.id, itemId: club, activityType: "attack", targetTokenIds: [caster.id], rollDamage: true,
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      reacted = (await ctx.effectsFrom(caster, "defensive-stance")).some(e => !e.disabled);
    }
    ctx.expect(reacted, "touché au contact, le Lanceur prend sa Posture défensive : effet « +4 CA » posé (20 essais au plus)");
  }
};
