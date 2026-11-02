/**
 * §334, rayons oculaires du Tyrannœil (identifiant propre `mm-beholder-eye-rays`). Arène des sorts : le Lanceur (PNJ), la Cible
 * (999 PV), le Mort-vivant.
 *  - Rayon pétrifiant : un premier échec rend Entravé, pas Pétrifié ;
 *  - Rayon ralentissant : un échec retire les Réactions et ne laisse qu'une action ou une action Bonus ;
 *  - Rayon de sommeil : le Mort-vivant n'est pas affecté.
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
  name: "repasse-rayons — rayons oculaires du Tyrannœil (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Mort-vivant"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target, undead] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const uuid = `${MM}.mmBeholder000000.Item.mmEyeRays0000000`;
    const { data } = await ctx.call("get-compendium-entry", { uuid });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    setPath(itemData, "flags.dnd5e.sourceId", uuid);
    const rays = (await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } })).id;
    const where = async t => {
      const scene = (await ctx.scene()).sceneId;
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return tok.actorLink ? { documentType: "Actor", id: tok.actorId } : { uuid: `Scene.${scene}.Token.${t.id}.Actor.${tok.actorId}` };
    };
    const clear = async t => {
      const w = await where(t);
      for ( const e of (await ctx.engine("effectOrigins", { tokenId: t.id })) ?? [] ) {
        if ( e.identifier === "mm-beholder-eye-rays" ) await ctx.call("remove-embedded-effect", { ...w, effectId: e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      for ( const t of [target, undead] ) { await clear(t); await ctx.setHp(t, 999).catch(() => {}); }
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: rays }).catch(() => {});
    });
    const stats = async t => (await ctx.engine("stats", { tokenId: t.id })) ?? {};
    const ids = await ctx.engine("identify", { tokenId: caster.id });
    ctx.expect(ids.find(r => r.id === rays)?.identifier === "mm-beholder-eye-rays", `identifiant ${ids.find(r => r.id === rays)?.identifier ?? "?"}`);
    const beside = async t => { const p = await ctx.position(t); await ctx.call("move-token", { tokenId: caster.id, x: p.x - grid, y: p.y, elevation: 0 }); await pause(800); };
    const failRay = async (t, activityId) => {
      for ( let i = 0; i < 20; i++ ) {
        await clear(t);
        await pause(400);
        const u = await ctx.use({ tokenId: caster.id, itemId: rays, activityId, activityType: "save", targetTokenIds: [t.id], consume: false, rollDamage: true });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(x => x.name === t.name)?.save?.success !== false ) continue;
        await pause(1500);
        return await stats(t);
      }
      return null;
    };

    await beside(target);
    const petrify = await failRay(target, "q67AgIfRplRO2e9p");
    if ( ctx.expect(!!petrify, "la Cible rate la sauvegarde du Rayon pétrifiant (20 essais au plus)") ) {
      ctx.expect(petrify.statuses.includes("restrained") && !petrify.statuses.includes("petrified"), `premier échec : Entravé, pas Pétrifié (${petrify.statuses.join(", ")})`);
    }
    const slow = await failRay(target, "lq2AtXFOVBz6IHMh");
    if ( ctx.expect(!!slow, "la Cible rate la sauvegarde du Rayon ralentissant (20 essais au plus)") ) {
      ctx.expect(slow.reactionBlocked === true && slow.actionOrBonus === true, `Rayon ralentissant : Réactions perdues (${slow.reactionBlocked}), action ou Bonus (${slow.actionOrBonus})`);
    }
    await clear(target);

    await beside(undead);
    let slept = false;
    for ( let i = 0; i < 4; i++ ) {
      const u = await ctx.use({ tokenId: caster.id, itemId: rays, activityId: "CSKrXM1Pkhlf23et", activityType: "save", targetTokenIds: [undead.id], consume: false });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1200);
      if ( r?.targets?.find(x => x.name === "Mort-vivant")?.save || (await stats(undead)).statuses?.includes("unconscious") ) slept = true;
    }
    ctx.expect(!slept, "Rayon de sommeil : le Mort-vivant n'est ni sauvegardé ni endormi (4 essais)");
  }
};
