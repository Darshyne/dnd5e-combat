/**
 * §317, sous-lot C12-j de la repasse terme par terme : divers. Arène des sorts (Lanceur).
 *  - Source d'inspiration : sans l'aptitude, un Repos court ne rend pas les Inspirations bardiques ; avec, il les rend toutes.
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
  name: "repasse-c12j — Source d'inspiration au Repos court (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Lanceur") ) { ctx.log("Lanceur requis (tools/arene-sorts.mjs) : non applicable"); return; }
    const caster = await ctx.token("Lanceur");
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
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const spentOf = async id => Number(((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === id)?.system?.uses?.spent) || 0;
    const inspiration = await lend(`${PHB}.classes.Item.phbbrdBardicInsp`, { "system.uses.spent": 2 });
    await pause(800);
    await ctx.engine("shortRest", { tokenId: caster.id });
    await pause(2000);
    ctx.expect((await spentOf(inspiration)) === 2, `sans Source d'inspiration : rien au Repos court (dépensées : ${await spentOf(inspiration)})`);
    await lend(`${PHB}.classes.Item.phbbrdFontOfInsp`);
    await pause(800);
    await ctx.engine("shortRest", { tokenId: caster.id });
    let back = false;
    for ( let n = 0; (n < 12) && !back; n++ ) { await pause(500); back = (await spentOf(inspiration)) === 0; }
    ctx.expect(back, `avec Source d'inspiration : toutes reviennent (dépensées : ${await spentOf(inspiration)})`);
  }
};
