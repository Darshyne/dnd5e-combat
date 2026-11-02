/**
 * §334, restes des lots K1 et K9 de la repasse des créatures. Arène des sorts : le Lanceur (PNJ), la Cible (999 PV), le Mort-vivant.
 *  - Regard soporifique du Chacal-garou (« Success: The target is immune to this jackalwere's Sleep Gaze for 24 hours ») : une réussite
 *    pose la marque d'immunité ; l'utilisation suivante laisse la Cible hors d'atteinte (ni sauvegarde, ni effet) ;
 *  - Gémissement funeste de la Banshie (« each creature … that isn't a Construct or an Undead ») : le Mort-vivant n'est pas affecté.
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
  name: "repasse-k1b — immunité temporaire après une réussite, porte « qui n'est pas un Mort-vivant » (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Mort-vivant"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target, undead] = await Promise.all(names.map(n => ctx.token(n)));
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
    const where = async t => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clear = async t => {
      const w = await where(t);
      for ( const e of (await ctx.engine("effectOrigins", { tokenId: t.id })) ?? [] ) {
        if ( ["sleep-gaze", "deathly-wail"].includes(e.identifier) ) await ctx.call("remove-embedded-effect", { ...w, effectId: e.id }).catch(() => {});
      }
      await ctx.call("set-status", { tokenId: t.id, statusId: "unconscious", active: false }).catch(() => {});
    };
    ctx.restore(async () => {
      for ( const t of [target, undead] ) { await clear(t); await ctx.setHp(t, 999).catch(() => {}); }
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const beside = async t => {
      const p = await ctx.position(t);
      await ctx.call("move-token", { tokenId: caster.id, x: p.x - grid, y: p.y, elevation: 0 });
      await pause(800);
    };

    // Regard soporifique : réussite → immunité.
    await beside(target);
    const gaze = await lend(`${MM}.mmJackalwere0000.Item.mmSleepGaze00000`);
    let saved = false;
    for ( let i = 0; (i < 20) && !saved; i++ ) {
      await clear(target);
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: gaze, activityId: "TXstlDE42CZicPAk", activityType: "save", targetTokenIds: [target.id], consume: false });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== true ) continue;
      saved = true;
    }
    if ( ctx.expect(saved, "la Cible réussit la sauvegarde du Regard soporifique (20 essais au plus)") ) {
      await pause(1500);
      const marks = ((await ctx.engine("effectOrigins", { tokenId: target.id })) ?? []).filter(e => e.identifier === "sleep-gaze");
      ctx.expect(marks.length > 0, `réussite : marque d'immunité posée (${marks.map(e => e.effect).join(", ") || "aucune"})`);
      let slept = false;
      for ( let i = 0; i < 4; i++ ) {
        const u = await ctx.use({ tokenId: caster.id, itemId: gaze, activityId: "TXstlDE42CZicPAk", activityType: "save", targetTokenIds: [target.id], consume: false });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1200);
        const entry = r?.targets?.find(x => x.name === "Cible");
        if ( entry?.save || (await ctx.engine("stats", { tokenId: target.id }))?.statuses?.includes("unconscious") ) slept = true;
      }
      ctx.expect(!slept, "immunisée : ni sauvegarde ni sommeil sur 4 nouveaux regards");
    }

    // Gémissement funeste : le Mort-vivant n'est pas affecté.
    await beside(undead);
    const wail = await lend(`${MM}.mmBanshee0000000.Item.PgG2vKHFrfCXVlQZ`);
    await ctx.setHp(undead, 999);
    const u = await ctx.use({ tokenId: caster.id, itemId: wail, activityId: "mnlRA4ivGOORPiBs", activityType: "save", targetTokenIds: [undead.id], consume: false, rollDamage: true,
      area: { shape: "rectangle", ...(await ctx.box(undead)) } });
    const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(1500);
    const hp = await ctx.hp(undead);
    ctx.expect(hp === 999 && !r?.targets?.find(x => x.name === "Mort-vivant")?.save, `Gémissement funeste : le Mort-vivant n'est pas affecté (PV ${hp})`);
  }
};
