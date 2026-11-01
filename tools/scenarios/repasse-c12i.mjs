/**
 * §315, sous-lot C12-i de la repasse terme par terme : vision, furtivité. Arène des sorts (Lanceur, Cible).
 *  - Discret, Tireur embusqué : le Lanceur caché attaque la Cible ; raté, il reste caché ; touché, il ne l'est plus.
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
  name: "repasse-c12i — Tireur embusqué : un tir raté ne révèle pas (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
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
    ctx.restore(async () => {
      await ctx.engine("stealth", { op: "set", tokenId: caster.id, on: false }).catch(() => {});
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "flags.dnd5e-combat.-=hiddenBeforeAttack": null } }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
    });
    // En pleine lumière, à côté de la Cible, le Lanceur serait repéré aussitôt : la scène dans les ténèbres le temps de l'essai.
    const { sceneId } = await ctx.scene();
    const was = (await ctx.call("get-scene", { sceneId })).environment?.globalLight?.enabled ?? true;
    await ctx.call("update-scene", { sceneId, sceneData: { "environment.globalLight.enabled": false } });
    ctx.restore(() => ctx.call("update-scene", { sceneId, sceneData: { "environment.globalLight.enabled": was } }).catch(() => {}));
    await pause(1500);
    await lend(`${PHB}.feats.Item.phbftSkulker0000`);
    const club = await lend(`${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    const t = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t.x - grid, y: t.y, elevation: 0 });
    await pause(800);
    const seen = { missed: false, hit: false };
    for ( let n = 0; (n < 25) && !(seen.missed && seen.hit); n++ ) {
      // L'effet « caché » du moteur posé directement (la mise en cachette passe par un test de Furtivité, aléatoire).
      if ( !(await ctx.engine("stealth", { tokenId: caster.id })).hidden ) {
        await ctx.call("upsert-embedded-effect", { uuid: `Actor.${caster.actorId}`, effectData: { name: "Caché (essai)", img: "icons/svg/cowled.svg",
          transfer: false, disabled: false, flags: { "dnd5e-combat": { hidden: { dc: 30 } } } }, match: { path: "name", value: "Caché (essai)" } });
      }
      await pause(800);
      if ( !(await ctx.engine("stealth", { tokenId: caster.id })).hidden ) { ctx.expect(false, "le Lanceur n'a pas pu se cacher"); return; }
      const u = await ctx.use({ tokenId: caster.id, itemId: club, activityType: "attack", targetTokenIds: [target.id] });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const hit = r?.targets?.find(x => x.name === "Cible")?.hit;
      if ( typeof hit !== "boolean" ) continue;
      const hidden = (await ctx.engine("stealth", { tokenId: caster.id })).hidden;
      if ( !hit && !seen.missed ) { seen.missed = true; ctx.expect(hidden, `raté depuis la cachette : toujours caché (${hidden})`); }
      if ( hit && !seen.hit ) { seen.hit = true; ctx.expect(!hidden, `touché : plus caché (${hidden})`); }
    }
    ctx.expect(seen.missed && seen.hit, `les deux issues vues (raté ${seen.missed}, touché ${seen.hit})`);
  }
};
