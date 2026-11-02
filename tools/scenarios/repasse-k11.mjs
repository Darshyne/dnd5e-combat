/**
 * §332, lot K11 de la repasse des créatures : pas de moitié des dégâts sur une sauvegarde réussie quand le texte n'en donne pas
 * (`monsterSaveDamage`). Arène des sorts : le Lanceur (PNJ) reçoit le Regard glaçant du Yéti abominable ; la Cible (999 PV).
 *  - Cible qui réussit sa sauvegarde : aucun dégât (la donnée disait « moitié »).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k11 — pas de dégâts sur une réussite quand le texte n'en donne pas (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const uuid = "Compendium.dnd-monster-manual.actors.Actor.mmAbominableYeti.Item.mmChillingGaze00";
    const lent = [];
    const clear = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: target.id });
      const where = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${target.id}.Actor.${data.actorId}` };
      for ( const e of await ctx.effectsFrom(target, "chilling-gaze") ) await ctx.call("remove-embedded-effect", { ...where, effectId: e.id }).catch(() => {});
      await ctx.call("set-status", { tokenId: target.id, statusId: "paralyzed", active: false }).catch(() => {});
    };
    ctx.restore(async () => {
      await clear();
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const { data } = await ctx.call("get-compendium-entry", { uuid });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    setPath(itemData, "flags.dnd5e.sourceId", uuid);
    const gaze = (await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } })).id;
    lent.push(gaze);
    const t = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t.x - 2 * grid, y: t.y, elevation: 0 });
    await pause(800);
    let checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      await clear();
      await ctx.setHp(target, 999);
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: gaze, activityId: "EREXmcv7YU7T9pj6", activityType: "save", targetTokenIds: [target.id], consume: false, rollDamage: true });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== true ) continue;
      const hp = await ctx.hp(target);
      ctx.expect(hp === 999, `sauvegarde réussie : aucun dégât (999 → ${hp})`);
      checked = true;
    }
    ctx.expect(checked, "la Cible réussit la sauvegarde du Regard glaçant (20 essais au plus)");
  }
};
