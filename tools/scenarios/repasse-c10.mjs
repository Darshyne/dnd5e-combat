/**
 * §305, lot C10 de la repasse terme par terme : invocations, compagnons, familiers. Arène des sorts (Lanceur).
 * Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Appel de destrier : le Lanceur meurt, le destrier disparaît ;
 *  - Compagnon sauvage : le familier reste au-delà de la durée de 2014 (heures), et part au Repos long du Lanceur. §438 : le Compagnon
 *    sauvage du Manuel 3.0.0 n'a plus d'activité d'invocation ; son activité « cast » lance Appel de familier, dont dnd5e pose une copie
 *    sur la fiche (`flags.dnd5e.cachedFor`) : l'invocation part de cette copie, et la règle du Compagnon doit encore s'appliquer.
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
  name: "repasse-c10 — invocations : destrier à la mort du lanceur, Compagnon sauvage au Repos long (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Lanceur") ) { ctx.log("Lanceur requis (tools/arene-sorts.mjs) : non applicable"); return; }
    const caster = await ctx.token("Lanceur");
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const summoned = [];
    const lend = async (uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const revive = async () => {
      for ( const s of ["dead", "unconscious", "prone"] ) {
        await ctx.removeStatusEffects?.(caster, s)?.catch?.(() => {});
        await ctx.call("set-status", { tokenId: caster.id, statusId: s, active: false }).catch(() => {});
      }
      await ctx.setHp(caster, 999);
    };
    ctx.restore(async () => {
      for ( const id of summoned ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await revive();
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
    });
    const present = async id => !!(await ctx.call("get-scene-object", { type: "Token", objectId: id }).catch(() => null))?.data;
    const until = async test => { for ( let i = 0; i < 20; i++ ) { if ( await test() ) return true; await pause(500); } return false; };

    // 1. Appel de destrier, puis la mort du Lanceur.
    const steed = await lend(`${PHB}.spells.Item.phbsplFindSteed0`, { "system.method": "atwill" });
    const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: steed, x: home.x + 2 * grid, y: home.y });
    const st = s.tokens?.[0];
    if ( ctx.expect(!!st, "le destrier est invoqué") ) {
      summoned.push(st.id);
      await pause(1500);
      await ctx.engine("hurt", { tokenId: caster.id, amount: 5000 });
      ctx.expect(await until(async () => !(await present(st.id))), "le Lanceur mort, le destrier disparaît");
    }
    await revive();
    await pause(1000);

    // 2. Compagnon sauvage, puis un Repos long.
    await lend(`${PHB}.classes.Item.phbdrdDruid00000`, { "system.levels": 2 });
    await lend(`${PHB}.classes.Item.phbdrdWildShape0`, { "system.uses.spent": 0 });
    const companion = await lend(`${PHB}.classes.Item.phbdrdWildCompan`);
    // La créature que le scénario `familier` fournit à l'invocation (un acteur du monde), sans le navigateur de compendium.
    const owl = "Actor.mmStirge00000000";
    // §438 : forme 3.0.0, la copie d'Appel de familier que dnd5e a posée pour l'activité « cast » du Compagnon (créée avec l'item).
    let from = companion;
    for ( let i = 0; i < 10; i++ ) {
      const items = (await ctx.call("get-actor", { actorId: caster.actorId })).items ?? [];
      const own = items.find(x => x._id === companion);
      if ( Object.values(own?.system?.activities ?? {}).some(a => a.type === "summon") ) break;
      const copy = items.find(x => String(x.flags?.dnd5e?.cachedFor ?? "").includes(`Item.${companion}.`));
      if ( copy ) { from = copy._id; lent.push(copy._id); ctx.log(`forme 3.0.0 : invocation depuis la copie « ${copy.name} »`); break; }
      await pause(500);
    }
    const c = await ctx.engine("summonAt", { tokenId: caster.id, itemId: from, x: home.x, y: home.y + 2 * grid, ...(owl ? { actorUuid: owl } : {}) }).catch(err => ({ error: err.message }));
    const ct = c?.tokens?.[0];
    if ( ctx.expect(!!ct, `le familier du Compagnon sauvage est invoqué${c?.error ? ` (${c.error})` : ""}`) ) {
      summoned.push(ct.id);
      await pause(1500);
      await ctx.engine("advanceTime", { seconds: 2 * 3600 });

      await pause(2500);
      ctx.expect(await present(ct.id), "deux heures plus tard, il est toujours là (règle 2024 : jusqu'au Repos long)");
      await ctx.engine("longRest", { tokenId: caster.id });
      ctx.expect(await until(async () => !(await present(ct.id))), "au Repos long du Lanceur, il part");
    }
  }
};
