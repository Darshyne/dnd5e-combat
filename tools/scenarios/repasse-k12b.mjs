/**
 * §333, lot K12 de la repasse des créatures (suite). Arène des sorts : le Lanceur (PNJ), le Héros (PJ : CA calculée — une CA fixe
 * ignore les bonus de CA dans dnd5e) et la Cible (999 PV).
 *  - Miasme nocif du Dragon vert (l'effet visait `system.armor.value`) : sur un échec, la CA du Héros baisse de 2 ;
 *  - Maléfice déformant du Fomorien : sur un échec, le Héros gagne un niveau d'Épuisement (un seul) ;
 *  - Visage troublant du Doppelganger (« that can see the doppelganger ») : une Cible Aveuglée n'est jamais Effrayée.
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
  name: "repasse-k12b — CA du Miasme, Épuisement, porte « qui voit la créature » (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Héros"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target, hero] = await Promise.all(names.map(n => ctx.token(n)));
    const heroBefore = (await ctx.engine("stats", { tokenId: hero.id })) ?? {};
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
    const clearOn = async t => {
      const w = await where(t);
      for ( const e of (await ctx.engine("effectOrigins", { tokenId: t.id })) ?? [] ) {
        if ( ["noxious-miasma", "warping-hex", "unsettling-visage"].includes(e.identifier) ) await ctx.call("remove-embedded-effect", { ...w, effectId: e.id }).catch(() => {});
      }
      for ( const s of ["frightened", "blinded"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
    };
    const clear = async () => { await clearOn(target); await clearOn(hero); };
    const stats = async (t=target) => (await ctx.engine("stats", { tokenId: t.id })) ?? {};
    ctx.restore(async () => {
      await clear();
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: hero.id });
      if ( data.actorLink ) await ctx.call("update-actor", { actorId: data.actorId, actorData: { "system.attributes.exhaustion": heroBefore.exhaustion ?? 0 } }).catch(() => {});
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const beside = async t => {
      const p = await ctx.position(t);
      await ctx.call("move-token", { tokenId: caster.id, x: p.x - grid, y: p.y, elevation: 0 });
      await pause(800);
    };
    /** Rejoue la sauvegarde jusqu'à un échec de la créature, puis rend ses statistiques. */
    const untilFailed = async (itemId, activityId, area=false, who=target) => {
      const before = await stats(who);
      for ( let i = 0; i < 20; i++ ) {
        await clear();
        await pause(400);
        const u = await ctx.use({ tokenId: caster.id, itemId, activityId, activityType: "save", targetTokenIds: [who.id], consume: false,
          ...(area ? { area: { shape: "rectangle", ...(await ctx.box(who)) } } : {}) });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(x => x.name === who.name)?.save?.success !== false ) continue;
        await pause(1500);
        return { before, after: await stats(who) };
      }
      return null;
    };

    await beside(hero);
    const miasma = await lend(`${MM}.mmAdultGreenDrag.Item.mmNoxiousMiasma0`);
    const m = await untilFailed(miasma, "Blm8nddvCOH69bL8", true, hero);
    if ( ctx.expect(!!m, "le Héros rate la sauvegarde du Miasme (20 essais au plus)") ) ctx.expect(m.after.ac === m.before.ac - 2, `Miasme, échec : CA ${m.before.ac} → ${m.after.ac} (−2 attendu)`);
    await clear();

    const hex = await lend(`${MM}.mmFomorian000000.Item.mmWarpingHex0000`);
    const h = await untilFailed(hex, "KaTc2c6hOHAqtywC", false, hero);
    if ( ctx.expect(!!h, "le Héros rate la sauvegarde du Maléfice déformant (20 essais au plus)") ) ctx.expect(h.after.exhaustion === h.before.exhaustion + 1, `Maléfice, échec : Épuisement ${h.before.exhaustion} → ${h.after.exhaustion} (+1 attendu)`);
    await beside(target);

    const visage = await lend(`${MM}.mmDoppelganger00.Item.mmUnsettlingVisa`);
    let frightened = false;
    for ( let i = 0; i < 6; i++ ) {
      await clear();
      await ctx.call("set-status", { tokenId: target.id, statusId: "blinded", active: true });
      await pause(500);
      const u = await ctx.use({ tokenId: caster.id, itemId: visage, activityId: "USxIbGZPLvfPnnoI", activityType: "save", targetTokenIds: [target.id], consume: false,
        area: { shape: "rectangle", ...(await ctx.box(target)) } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      if ( (await stats(target)).statuses?.includes("frightened") ) frightened = true;
    }
    ctx.expect(!frightened, "Visage troublant : une Cible Aveuglée n'est jamais Effrayée (6 essais)");
  }
};
