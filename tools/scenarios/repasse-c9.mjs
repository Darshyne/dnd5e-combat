/**
 * §304, lot C9 de la repasse terme par terme : dons, clauses secondaires. Arène des sorts (Lanceur, Cible).
 *  - Faveur du destin : l'utilisation dépensée revient au jet d'initiative.
 * Les autres corrections du lot (Visée sans pareille sur un 1 naturel, Forte carrure à l'évasion, Lien occulte contre le désarmement) ne
 * se forcent pas par un jet : tests unitaires et lecture du code (SPEC §304).
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
  name: "repasse-c9 — Faveur du destin regagnée à l'initiative (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));

    const lent = [];
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
    });
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };

    const boon = await lend(caster, `${PHB}.feats.Item.phbBoonofFate000`, { "system.uses.spent": 1 });
    const spent = async () => Number(((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === boon)?.system?.uses?.spent) || 0;
    ctx.expect((await spent()) === 1, "Faveur du destin dépensée avant le combat");
    await ctx.startCombat([caster, target]);
    const c = await state();
    for ( const [i, t] of [caster, target].entries() ) {
      await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
      await pause(600);
    }
    await pause(1500);
    ctx.expect((await spent()) === 0, `à l'initiative, l'utilisation revient (dépensées : ${await spent()})`);
  }
};
