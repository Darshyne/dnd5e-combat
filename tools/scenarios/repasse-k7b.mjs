/**
 * §334, restes du lot K7 de la repasse des créatures : dégâts « at the start of each of the …'s turns » (`originTurnStart`). Arène des
 * sorts : le Lanceur (PNJ) et l'« Ennemi au contact ».
 *  - Submersion de l'Élémentaire de l'eau : l'Ennemi qui rate est Agrippé ; au début du tour suivant du Lanceur, il subit les dégâts
 *    de l'activité « turnStart » de la capacité.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.Actor";
// §435 : la Submersion a son identifiant propre (« mm-whelm », content/sources.mjs) — « whelm » est le marteau légendaire du Guide.
const WHELM = new Set(["mm-whelm", "whelm"]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k7b — dégâts au début du tour de la créature qui a posé l'effet (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const uuid = `${MM}.mmWaterElemental.Item.mmWhelm000000000`;
    const { data } = await ctx.call("get-compendium-entry", { uuid });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    setPath(itemData, "flags.dnd5e.sourceId", uuid);
    const whelm = (await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } })).id;
    const clear = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: enemy.id });
      const w = tok.actorLink ? { documentType: "Actor", id: tok.actorId } : { uuid: `Scene.${scene}.Token.${enemy.id}.Actor.${tok.actorId}` };
      for ( const e of (await ctx.engine("effectOrigins", { tokenId: enemy.id })) ?? [] ) {
        if ( WHELM.has(e.identifier) ) await ctx.call("remove-embedded-effect", { ...w, effectId: e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await clear();
      await ctx.setHp(enemy, 999).catch(() => {});
      await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: whelm }).catch(() => {});
    });

    await ctx.startCombat([caster, enemy]);
    const s = await ctx.combat();
    const combat = s.combat ?? s.combats?.[0] ?? s;
    for ( const [t, v] of [[caster, 20], [enemy, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = await ctx.combat(); const cc = c.combat ?? c.combats?.[0] ?? c; return cc.combatants?.find(x => x.id === cc.currentCombatantId)?.tokenId; };
    for ( let i = 0; (i < 3) && ((await current()) !== caster.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    let grappled = false;
    for ( let i = 0; (i < 20) && !grappled; i++ ) {
      await clear();
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: whelm, activityId: "TQchFj2VXXJgU7Lq", activityType: "save", targetTokenIds: [enemy.id], consume: false, rollDamage: true,
        area: { shape: "rectangle", ...(await ctx.box(enemy)) } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      grappled = (await ctx.engine("effectOrigins", { tokenId: enemy.id }) ?? []).some(e => WHELM.has(e.identifier));
    }
    if ( !ctx.expect(grappled, "l'Ennemi est pris par la Submersion (20 essais au plus)") ) return;
    await ctx.setHp(enemy, 999);
    await pause(600);
    await ctx.nextTurn();   // tour de l'Ennemi : rien
    await pause(2500);
    const mid = await ctx.hp(enemy);
    await ctx.nextTurn();   // début du tour du Lanceur : dégâts
    await pause(4000);
    const after = await ctx.hp(enemy);
    ctx.expect(mid === 999, `au tour de l'Ennemi : pas de dégâts (${mid})`);
    ctx.expect(after < mid, `au début du tour du Lanceur : l'Ennemi subit les dégâts de la Submersion (${mid} → ${after})`);
  }
};
