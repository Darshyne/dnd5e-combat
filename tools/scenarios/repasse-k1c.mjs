/**
 * §334, restes des lots K1 à K9 de la repasse des créatures. Arène des sorts : le Lanceur (PNJ) et la Cible (999 PV).
 *  - Morsure de l'Homoncule : identifiant propre `mm-homunculus-bite` (clé « acteur.item » de sa source ; « bite » est partagé) ;
 *  - Absorption de vie du Feu follet (« that has 0 Hit Points ») : une Cible debout n'est pas affectée (ni sauvegarde, ni Mort) ;
 *  - Brochette psychique de l'Ancien (Ravenloft, « If the target has the Charmed condition… ») : une Cible non Charmée qui rate n'est
 *    ni Étourdie ni Épuisée.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.Actor";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k1c — identifiant par créature, porte « à 0 PV », porte « Charmé » (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      setPath(itemData, "_stats.compendiumSource", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const where = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: target.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${target.id}.Actor.${data.actorId}` };
    };
    const clear = async () => {
      const w = await where();
      for ( const e of (await ctx.engine("effectOrigins", { tokenId: target.id })) ?? [] ) {
        if ( ["consume-life", "psychic-skewer"].includes(e.identifier) ) await ctx.call("remove-embedded-effect", { ...w, effectId: e.id }).catch(() => {});
      }
      for ( const s of ["dead", "stunned"] ) await ctx.call("set-status", { tokenId: target.id, statusId: s, active: false }).catch(() => {});
    };
    const stats = async () => (await ctx.engine("stats", { tokenId: target.id })) ?? {};
    ctx.restore(async () => {
      await clear();
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const t0 = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
    await pause(800);

    const bite = await lend(`${MM}.mmHomunculus0000.Item.mmBite0000000000`);
    const ids = await ctx.engine("identify", { tokenId: caster.id });
    const found = ids.find(r => r.id === bite) ?? ids.find(r => /bite|morsure/i.test(r.item ?? ""));
    ctx.expect(found?.identifier === "mm-homunculus-bite", `Morsure de l'Homoncule : identifiant ${found?.identifier ?? "?"} (mm-homunculus-bite attendu)`);

    const consume = await lend(`${MM}.mmWillowisp00000.Item.YPy3wAfsPZ7cNJoJ`);
    let touched = false;
    for ( let i = 0; i < 4; i++ ) {
      await clear();
      const u = await ctx.use({ tokenId: caster.id, itemId: consume, activityId: "1Hy8CdhpwQlLxDPq", activityType: "save", targetTokenIds: [target.id], consume: false });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1200);
      if ( r?.targets?.find(x => x.name === "Cible")?.save || (await stats()).statuses?.includes("dead") ) touched = true;
    }
    ctx.expect(!touched, "Absorption de vie : une Cible debout n'est ni sauvegardée ni tuée (4 essais)");
    await clear();

    if ( packs.includes("dnd-ravenloft-horrors-within.actors") ) {
      const skewer = await lend("Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwElderThing000.Item.oN3AG2uE1EvEY29r");
      let checked = false;
      for ( let i = 0; (i < 20) && !checked; i++ ) {
        await clear();
        await ctx.setHp(target, 999);
        await pause(400);
        const before = await stats();
        const u = await ctx.use({ tokenId: caster.id, itemId: skewer, activityId: "yRfvOqUdLa42N6qf", activityType: "save", targetTokenIds: [target.id], consume: false, rollDamage: true });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
        await pause(1500);
        const after = await stats();
        ctx.expect(!after.statuses?.includes("stunned") && (after.exhaustion === before.exhaustion),
          `Brochette psychique, échec sans Charmé : ni Étourdi ni Épuisement (${after.statuses?.join(", ") || "aucun état"}, Épuisement ${after.exhaustion})`);
        checked = true;
      }
      ctx.expect(checked, "la Cible rate la sauvegarde de la Brochette psychique (20 essais au plus)");
    }
  }
};
