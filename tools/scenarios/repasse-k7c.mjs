/**
 * §334, restes des lots K6 et K7 de la repasse des créatures. Arène des sorts : le Lanceur (PNJ) et la Cible (999 PV).
 *  - Contact du Magmin (« it starts burning ») : au toucher, la Cible est En feu ;
 *  - Rafale perturbatrice du Cerveau en bocal (Ravenloft, « The target can't take Reactions until the end of its next turn ») : au
 *    toucher, la Cible perd ses Réactions.
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
  name: "repasse-k7c — En feu au toucher, Réactions perdues lues dans le texte (Arène des sorts)",
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
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const clear = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: target.id });
      const w = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${target.id}.Actor.${data.actorId}` };
      for ( const e of (await ctx.engine("effectOrigins", { tokenId: target.id })) ?? [] ) {
        if ( ["touch", "disrupting-burst"].includes(e.identifier) ) await ctx.call("remove-embedded-effect", { ...w, effectId: e.id }).catch(() => {});
      }
      await ctx.call("set-status", { tokenId: target.id, statusId: "burning", active: false }).catch(() => {});
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
    const untilHit = async itemId => {
      for ( let i = 0; i < 20; i++ ) {
        await clear();
        await pause(400);
        const u = await ctx.use({ tokenId: caster.id, itemId, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.hit !== true ) continue;
        await pause(1500);
        return await stats();
      }
      return null;
    };

    const touch = await lend("Compendium.dnd-monster-manual.actors.Actor.mmMagmin00000000.Item.mmTouch000000000");
    const burned = await untilHit(touch);
    if ( ctx.expect(!!burned, "le Contact du Magmin touche (20 essais au plus)") ) ctx.expect(burned.statuses.includes("burning"), `touché : En feu (${burned.statuses.join(", ") || "aucun état"})`);

    if ( packs.includes("dnd-ravenloft-horrors-within.actors") ) {
      const burst = await lend("Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwBraininaJar00.Item.lO3iX6KYKp1VpjNI");
      const hit = await untilHit(burst);
      if ( ctx.expect(!!hit, "la Rafale perturbatrice touche (20 essais au plus)") ) ctx.expect(hit.reactionBlocked === true, `touché : Réactions perdues (${hit.reactionBlocked})`);
    }
  }
};
