/**
 * §314, sous-lot C12-h de la repasse terme par terme : déplacement. Arène des sorts (Lanceur, Cible).
 *  - Décharge répulsive posée sur Contact glacial (pas sur la Décharge occulte) : la Cible touchée recule de 3 m ;
 *  - Révélation charnelle, Envol scintillant : une Vitesse de vol égale à la Vitesse (la donnée la doublait).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c12h — Décharge répulsive sur un autre tour de magie, vol de Révélation charnelle (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, target] ) homes.set(t.id, await ctx.position(t));
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
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      for ( const e of await ctx.effects(caster) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id ?? e.id }).catch(() => {});
      for ( const t of [caster, target] ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };

    await part("Décharge répulsive sur Contact glacial", async () => {
      const chill = await lend(`${PHB}.spells.Item.phbsplChillTouch`);
      const repel = await lend(`${PHB}.classes.Item.phbinvRepellingB`);
      const { effectId } = await ctx.engine("enchant", { tokenId: caster.id, itemId: repel, activityId: "OXhI1TDQxORrGAgc", targetItemId: chill }).catch(err => ({ error: err.message }));
      if ( !ctx.expect(!!effectId, "Contact glacial porte l'enchantement « Répulsive »") ) return;
      // Deux rangées plus bas : à l'est de la case d'origine de la Cible se tient la « Cible voisine », qui arrêterait la poussée.
      const t0 = { x: homes.get(target.id).x, y: homes.get(target.id).y + 2 * grid };
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
        await ctx.call("move-token", { tokenId: target.id, x: t0.x, y: t0.y, elevation: 0 });
        await pause(800);
        const u = await ctx.use({ tokenId: caster.id, itemId: chill, activityType: "attack", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Cible")?.hit !== true ) continue;
        await pause(2000);
        const pos = await ctx.position(target);
        const moved = Math.round(Math.hypot(pos.x - t0.x, pos.y - t0.y) / grid);
        ctx.expect(moved === 2, `touchée : la Cible recule de ${moved} case(s) (attendu 2 = 3 m)`);
        checked = true;
      }
      ctx.expect(checked, "Contact glacial touche la Cible (20 essais au plus)");
    });

    await part("Révélation charnelle", async () => {
      const revelation = await lend(`${PHB}.classes.Item.phbscrRevelation`);
      await ctx.engine("placeItemEffect", { tokenId: caster.id, casterId: caster.id, itemId: revelation, effectId: "CxuVthyUWdT2ARMn" });
      await pause(1200);
      const flight = (await ctx.effects(caster)).find(e => /Glistening|scintillant/i.test(e.name));
      const fly = (flight?.system?.changes ?? flight?.changes ?? []).filter(c => c.key === "system.attributes.movement.fly").map(c => String(c.value));
      ctx.expect(fly.length === 1 && !fly[0].includes("2 *"), `Vitesse de vol : ${fly.join(" | ") || "aucune"} (la Vitesse, pas le double)`);
    });
  }
};
