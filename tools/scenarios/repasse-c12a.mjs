/**
 * §316, sous-lot C12-a de la repasse terme par terme : réactions et fenêtres. Arène des sorts (Lanceur, Cible).
 *  - Rage persistante : les Rages dépensées reviennent au jet d'initiative, une fois (l'utilisation de l'aptitude) ;
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
  name: "repasse-c12a — Rage persistante à l'initiative (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
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
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.call("set-status", { tokenId: caster.id, statusId: s, active: false }).catch(() => {});
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } }).catch(() => {});
      await ctx.setHp(caster, 999).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const itemOf = async id => ((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === id);

    await part("Rage persistante", async () => {
      await lend(`${PHB}.classes.Item.phbbrbBarbarian0`, { "system.levels": 15 });
      const rage = await lend(`${PHB}.classes.Item.phbbrbRage000000`);
      const persistent = await lend(`${PHB}.classes.Item.phbbrbPersistent`, { "system.uses.spent": 0 });
      await pause(800);
      await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData: { "system.uses.spent": 3 }, match: { path: "_id", value: rage } });
      await pause(600);
      await ctx.startCombat([caster, target]);
      const s = await ctx.combat();
      const combat = s.combat ?? s.combats?.[0] ?? s;
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === caster.id).id, value: 18, combatId: ctx.ownCombat });
      await pause(2500);
      const spent = Number((await itemOf(rage))?.system?.uses?.spent) || 0;
      const paid = Number((await itemOf(persistent))?.system?.uses?.spent) || 0;
      ctx.expect(spent === 0, `au jet d'initiative, les Rages reviennent (dépensées : 3 → ${spent})`);
      ctx.expect(paid === 1, `une utilisation de Rage persistante dépensée (${paid})`);
    });

  }
};
