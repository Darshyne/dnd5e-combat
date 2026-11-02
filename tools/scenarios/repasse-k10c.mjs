/**
 * §334, restes du lot K10 de la repasse des créatures : la charge exigée. Arène des sorts : le Lanceur (PNJ) et la Cible (999 PV).
 *  - Défenses de l'Éléphant (« moved 20+ feet straight toward it immediately before the hit, the target has the Prone condition ») :
 *    sans charge, un toucher ne met pas la Cible À terre.
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
  name: "repasse-k10c — À terre seulement après une charge (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const uuid = "Compendium.dnd-monster-manual.actors.Actor.mmElephant000000.Item.mmGore0000000000";
    const { data } = await ctx.call("get-compendium-entry", { uuid });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    setPath(itemData, "flags.dnd5e.sourceId", uuid);
    const gore = (await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } })).id;
    ctx.restore(async () => {
      await ctx.call("set-status", { tokenId: target.id, statusId: "prone", active: false }).catch(() => {});
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: gore }).catch(() => {});
    });
    const t0 = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
    await pause(1500);
    let checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      await ctx.call("set-status", { tokenId: target.id, statusId: "prone", active: false }).catch(() => {});
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: gore, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.hit !== true ) continue;
      await pause(1500);
      const statuses = (await ctx.engine("stats", { tokenId: target.id }))?.statuses ?? [];
      ctx.expect(!statuses.includes("prone"), `touché sans charge : la Cible reste debout (${statuses.join(", ") || "aucun état"})`);
      checked = true;
    }
    ctx.expect(checked, "les Défenses touchent (20 essais au plus)");
  }
};
