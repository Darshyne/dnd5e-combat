/**
 * §302, lot C7 de la repasse terme par terme : Avantage et Désavantage oubliés. Arène des sorts (Lanceur, Cible, Cible voisine).
 * Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Contagion : la Cible « Infectée (Force) » fait sa sauvegarde de Force au Désavantage ;
 *  - Combattant clairvoyant : le Lanceur a l'Avantage contre la Cible liée, elle le Désavantage contre lui ;
 *  - Rayon affaiblissant : la Cible Affaiblie attaque au gourdin (Force) avec Désavantage ;
 *  - Vision suprême : le Lanceur à vision véritable n'a plus de Désavantage contre la Cible Invisible ;
 *  - Motif hypnotique : la Cible Aveuglée n'est pas affectée ; Sommeil : la Cible elfe (Transe) non plus.
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
  name: "repasse-c7 — Avantage et Désavantage oubliés (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Cible voisine"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target, other] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, target, other];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));
    const senses0 = (await ctx.call("get-actor", { actorId: caster.actorId })).system?.attributes?.senses?.ranges?.truesight ?? 0;

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
    const regions = [];
    const reset = async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await unlend();
      await clearEffects();
      for ( const t of all ) {
        for ( const s of ["invisible", "blinded"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.attributes.senses.ranges.truesight": senses0 } }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const club = t => lend(t, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    const reasons = (attacker, defender, itemId) => ctx.engine("attackReasons", { attackerId: attacker.id, targetId: defender.id, itemId });
    const place = (t, from, itemId, effectId) => ctx.engine("placeItemEffect", { tokenId: t.id, casterId: from.id, itemId, effectId });
    const named = r => (r?.targets ?? []).map(x => x.name ?? "?");
    const settled = async used => (used?.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 40000 }).catch(() => null) : null);

    await part("Contagion", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplContagion0`, { "system.method": "atwill" });
      await place(target, caster, spell, "S8jxTZQbT8KKSg5V");
      await pause(1500);
      const r = await ctx.engine("rollSave", { tokenId: target.id, ability: "str" });
      ctx.expect(/kl|dis/.test(r?.formula ?? ""), `Infectée (Force) : sauvegarde de Force au Désavantage (${r?.formula})`);
      const dex = await ctx.engine("rollSave", { tokenId: target.id, ability: "dex" });
      ctx.expect(!/kl|dis/.test(dex?.formula ?? ""), `pas sur les autres caractéristiques (${dex?.formula})`);
    });

    await part("Combattant clairvoyant", async () => {
      const item = await lend(caster, `${PHB}.classes.Item.phbwlkClairvoyan`);
      const mine = await club(caster); const theirs = await club(target);
      await place(target, caster, item, "HMegeL0quWtCaUFV");
      await pause(1500);
      const a = await reasons(caster, target, mine);
      const d = await reasons(target, caster, theirs);
      ctx.expect(a.advantage.some(x => /clairvoyant/i.test(x)), `le Lanceur a l'Avantage contre la Cible (${a.advantage.join(", ") || "rien"})`);
      ctx.expect(d.disadvantage.some(x => /clairvoyant/i.test(x)), `la Cible a le Désavantage contre lui (${d.disadvantage.join(", ") || "rien"})`);
    });

    await part("Rayon affaiblissant", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplRayofEnfee`, { "system.method": "atwill" });
      const theirs = await club(target);
      const before = await reasons(target, caster, theirs);
      await place(target, caster, spell, "uaHZaHEalgWa6eoC");
      await pause(1500);
      const after = await reasons(target, caster, theirs);
      ctx.expect(!before.disadvantage.some(x => /enfeeble/i.test(x)) && after.disadvantage.some(x => /enfeeble/i.test(x)),
        `Affaiblie, la Cible attaque au gourdin avec Désavantage (${after.disadvantage.join(", ") || "rien"})`);
    });

    await part("Vision suprême", async () => {
      const mine = await club(caster);
      await ctx.call("set-status", { tokenId: target.id, statusId: "invisible", active: true });
      await pause(1200);
      const blind = await reasons(caster, target, mine);
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.attributes.senses.ranges.truesight": 120 } });
      await pause(1200);
      const seen = await reasons(caster, target, mine);
      ctx.expect(blind.disadvantage.length > 0, `sans vision véritable, Désavantage contre l'Invisible (${blind.disadvantage.join(", ")})`);
      ctx.expect(seen.disadvantage.length < blind.disadvantage.length, `avec vision véritable 36 m, plus de Désavantage dû à l'invisibilité (${seen.disadvantage.join(", ") || "rien"})`);
    });

    await part("Motif hypnotique", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplHypnoticPa`, { "system.method": "atwill" });
      await ctx.call("set-status", { tokenId: target.id, statusId: "blinded", active: true });
      await pause(1000);
      const p = await ctx.position(target);
      const used = await ctx.use({ tokenId: caster.id, itemId: spell, activityType: "save", area: { shape: "circle", x: p.x + ARENE_SORTS.grid, y: p.y + ARENE_SORTS.grid / 2, radius: ARENE_SORTS.grid * 1.4 } });
      if ( used?.regionId ) regions.push(used.regionId);
      const r = await settled(used);
      const t = (r?.targets ?? []).find(x => x.name === "Cible");
      ctx.expect(named(r).includes("Cible voisine") && (!t || t.unaffected || !t.save), `la Cible Aveuglée n'est pas affectée (${JSON.stringify((r?.targets ?? []).map(x => ({ n: x.name, u: x.unaffected ?? null, s: x.save?.total ?? null })))})`);
    });

    await part("Sommeil et Transe", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplSleep00000`, { "system.method": "atwill" });
      await lend(target, `${PHB}.origins.Item.phbsptTrance0000`);
      await pause(1000);
      const p = await ctx.position(target);
      const used = await ctx.use({ tokenId: caster.id, itemId: spell, activityType: "save", area: { shape: "circle", x: p.x + ARENE_SORTS.grid, y: p.y + ARENE_SORTS.grid / 2, radius: ARENE_SORTS.grid * 1.4 } });
      if ( used?.regionId ) regions.push(used.regionId);
      const r = await settled(used);
      const t = (r?.targets ?? []).find(x => x.name === "Cible");
      ctx.expect(named(r).includes("Cible voisine") && (!t || t.unaffected || !t.save), `l'elfe (Transe) n'est pas affecté (${JSON.stringify((r?.targets ?? []).map(x => ({ n: x.name, u: x.unaffected ?? null, s: x.save?.total ?? null })))})`);
      ctx.expect(!(await ctx.effectsFrom(target, "sleep")).length, "la Cible ne s'endort pas");
    });
  }
};
