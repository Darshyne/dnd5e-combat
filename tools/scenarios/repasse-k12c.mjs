/**
 * §333, lot K12 de la repasse des créatures (suite). Arène des sorts : le Lanceur (PNJ), la Cible (999 PV), le Mort-vivant.
 *  - Protection ésotérique de Gennifer (Ravenloft, « If the target is an Undead creature, it has the Stunned condition ») : sur un
 *    échec, la Cible n'est pas Étourdie, le Mort-vivant l'est (`effectsIf` sur les effets d'une sauvegarde) ;
 *  - Disparition de l'Esprit frappeur : l'Invisibilité tombe après un jet d'attaque (`breaksOn`).
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
  name: "repasse-k12c — porte Mort-vivant d'un effet de sauvegarde, Invisibilité rompue à l'attaque (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Mort-vivant"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target, undead] = await Promise.all(names.map(n => ctx.token(n)));
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
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];
    const clear = async () => {
      for ( const t of [target, undead] ) await ctx.call("set-status", { tokenId: t.id, statusId: "stunned", active: false }).catch(() => {});
      await ctx.call("set-status", { tokenId: caster.id, statusId: "invisible", active: false }).catch(() => {});
    };
    ctx.restore(async () => {
      await clear();
      for ( const t of [target, undead] ) await ctx.setHp(t, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });

    if ( packs.includes("dnd-ravenloft-horrors-within.actors") ) {
      const ward = await lend("Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwGenniferWeath.Item.qUmmFsq50zF5ktmw");
      for ( const [t, stunnedExpected] of [[target, false], [undead, true]] ) {
        const p = await ctx.position(t);
        await ctx.call("move-token", { tokenId: caster.id, x: p.x - grid, y: p.y, elevation: 0 });
        await pause(800);
        let checked = false;
        for ( let i = 0; (i < 20) && !checked; i++ ) {
          await clear();
          await pause(400);
          const u = await ctx.use({ tokenId: caster.id, itemId: ward, activityId: "wTip1ZJiumWKzEGZ", activityType: "save", targetTokenIds: [t.id], consume: false,
            area: { shape: "rectangle", ...(await ctx.box(t)) } });
          const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
          if ( r?.targets?.find(x => x.name === t.name)?.save?.success !== false ) continue;
          await pause(1500);
          const stunned = (await statuses(t)).includes("stunned");
          ctx.expect(stunned === stunnedExpected, `Protection ésotérique, échec du ${t.name} : ${stunned ? "Étourdi" : "pas Étourdi"} (${stunnedExpected ? "Étourdi" : "pas Étourdi"} attendu)`);
          checked = true;
        }
        ctx.expect(checked, `${t.name} rate la sauvegarde de la Protection ésotérique (20 essais au plus)`);
      }
    }

    // Disparition : Invisible, puis une attaque la rompt.
    const t0 = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
    await pause(800);
    await clear();
    const vanish = await lend("Compendium.dnd-monster-manual.actors.Actor.mmPoltergeist000.Item.mmVanish00000000");
    const club = await lend(`${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    await ctx.use({ tokenId: caster.id, itemId: vanish, activityId: "RYoAjqR06oGKDiVC", activityType: "utility", targetTokenIds: [caster.id] });
    await pause(2000);
    if ( ctx.expect((await statuses(caster)).includes("invisible"), "Disparition : le Lanceur est Invisible") ) {
      const u = await ctx.use({ tokenId: caster.id, itemId: club, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      ctx.expect(!(await statuses(caster)).includes("invisible"), "après son jet d'attaque : plus Invisible");
    }
  }
};
