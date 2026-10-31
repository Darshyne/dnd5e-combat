/**
 * §303, lot C8 de la repasse terme par terme : sorts à logique propre. Arène des sorts (Lanceur, Allié, Cible).
 * Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Protection contre la mort : la Cible protégée, à 50 PV, subit Mot de pouvoir mortel — elle n'est pas tuée, la protection tombe ;
 *  - Aide : l'Allié à pleins PV gagne les 5 PV actuels en plus de son maximum relevé.
 * La Concentration qui tombe à 0 PV est jouée par le scénario `concentration-zero` (Arène de test).
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
  name: "repasse-c8 — Protection contre la mort contre Mot de pouvoir mortel, Aide à pleins PV (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, target] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, target];

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
    const unlend = async () => { for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {}); };
    const clearEffects = async () => {
      for ( const t of all ) for ( const e of (await ctx.call("get-actor", { actorId: t.actorId })).effects ?? [] ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      await unlend();
      await clearEffects();
      for ( const t of all ) {
        for ( const s of ["dead", "unconscious", "prone"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    /** Utilise, clique les dés laissés au système (dégâts, soin), attend la résolution. */
    const cast = async (itemId, targets) => {
      const used = await ctx.use({ tokenId: caster.id, itemId, targetTokenIds: targets.map(t => t.id), consume: false });
      await pause(1500);
      if ( used.usageMessageId ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null);
      return used.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
    };

    await part("Protection contre la mort", async () => {
      const ward = await lend(caster, `${PHB}.spells.Item.phbsplDeathWard0`, { "system.method": "atwill" });
      const kill = await lend(caster, `${PHB}.spells.Item.phbsplPowerWordK`, { "system.method": "atwill" });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: ward, effectId: "mLUL8mRFsCzleR5d" });
      await ctx.setHp(target, 50);
      await pause(1200);
      ctx.expect((await ctx.effectsFrom(target, "death-ward")).length === 1, "la Cible est protégée");
      await cast(kill, [target]);
      await pause(2500);
      const statuses = (await ctx.engine("stats", { tokenId: target.id }))?.statuses ?? [];
      ctx.expect(!statuses.includes("dead") && (await ctx.hp(target)) === 50, `Mot de pouvoir mortel : la Cible n'est pas tuée (${await ctx.hp(target)} PV, ${statuses.join(", ") || "aucun état"})`);
      ctx.expect((await ctx.effectsFrom(target, "death-ward")).length === 0, "la protection tombe à la place");
    });

    await part("Aide à pleins PV", async () => {
      const aid = await lend(caster, `${PHB}.spells.Item.phbsplAid0000000`, { "system.method": "atwill" });
      await ctx.setHp(ally, 999);
      await cast(aid, [ally]);
      await pause(2500);
      const hp = await ctx.hp(ally);
      ctx.expect(hp === 1004, `l'Allié à pleins PV gagne 5 PV au-delà de son ancien maximum (${hp} ; attendu 1004)`);
    });
  }
};
