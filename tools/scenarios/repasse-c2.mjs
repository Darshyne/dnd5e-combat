/**
 * §296, lot C2 de la repasse terme par terme : « de votre choix », plafond de créatures, réserve à répartir. Arène des sorts (Lanceur,
 * Allié, Cible, Cible voisine). Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Lenteur et Sommeil : l'Allié pris dans la zone n'est ni visé ni affecté ;
 *  - Survivance : la liste ne propose que les créatures En sang (l'Allié), cochées ; la réserve (100, formule d'essai) le soigne jusqu'à la
 *    moitié de ses PV maximum, pas au-delà ;
 *  - Guérison de groupe : 700 PV répartis entre l'Allié et le Lanceur — chacun remonte à son maximum, pas 700 chacun.
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
  name: "repasse-c2 — créatures de votre choix, plafond, réserve à répartir (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Cible", "Cible voisine"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, target, other] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, target, other];
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));

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
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const settled = async used => (used?.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 40000 }).catch(() => null) : null);
    const has = async (t, id) => (await ctx.effectsFrom(t, id)).length > 0;
    const named = r => (r?.targets ?? []).map(x => x.name ?? x.token ?? "?");
    /** L'Allié collé à la Cible, côté opposé à la Cible voisine. */
    const allyBesideTarget = async () => {
      const p = await ctx.position(target);
      await ctx.call("move-token", { tokenId: ally.id, x: p.x, y: p.y + grid, elevation: 0 });
      await pause(800);
      return p;
    };

    await part("Lenteur", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplSlow000000`, { "system.method": "atwill" });
      const p = await allyBesideTarget();
      const r = await settled(await ctx.use({ tokenId: caster.id, itemId: spell, activityType: "save",
        area: { shape: "circle", x: p.x + grid, y: p.y + grid, radius: grid * 2 } }));
      ctx.expect(!named(r).includes("Allié") && named(r).length >= 1, `Lenteur : l'Allié n'est pas visé (${named(r).join(", ")})`);
      ctx.expect(!await has(ally, "slow"), "Lenteur : l'Allié n'est pas ralenti");
    });

    await part("Sommeil", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplSleep00000`, { "system.method": "atwill" });
      const p = await allyBesideTarget();
      const r = await settled(await ctx.use({ tokenId: caster.id, itemId: spell, activityType: "save",
        area: { shape: "circle", x: p.x + grid / 2, y: p.y + grid, radius: grid } }));
      ctx.expect(!named(r).includes("Allié"), `Sommeil : l'Allié n'est pas visé (${named(r).join(", ")})`);
      ctx.expect(!await has(ally, "sleep"), "Sommeil : l'Allié ne s'endort pas");
    });

    await part("Survivance", async () => {
      // Le Lanceur n'a pas de niveau de Clerc : la réserve d'essai vaut 100. L'activité dépense une utilisation de Conduit divin.
      await lend(caster, `${PHB}.classes.Item.phbclcChannelDiv`, { "system.uses.max": "9", "system.uses.spent": 0 });
      const item = await lend(caster, `${PHB}.classes.Item.phbclcPreserveLi`, {
        "system.activities.dnd5eactivity000.healing.custom": { enabled: true, formula: "100" } });
      await ctx.setHp(ally, 400);
      const list = await ctx.engine("pickTargets", { tokenId: caster.id, itemId: item, activityId: "dnd5eactivity000" });
      const shown = (list.creatures ?? []).map(x => `${x.name}${x.checked ? " ✓" : ""}`);
      ctx.expect(shown.includes("Allié ✓") && !shown.some(s => /^(Cible|Lanceur)/.test(s)), `Survivance : seules les créatures En sang, cochées (${shown.join(", ")})`);
      const r = await ctx.engine("castPicked", { tokenId: caster.id, itemId: item, activityId: "dnd5eactivity000", targetIds: [ally.id] });
      await settled(r);
      await pause(4000);
      const hp = await ctx.hp(ally);
      ctx.expect(hp === 499, `Survivance : l'Allié remonte à la moitié de ses PV maximum, pas au-delà (${hp} ; attendu 499)`);
    });

    await part("Guérison de groupe", async () => {
      const item = await lend(caster, `${PHB}.spells.Item.phbsplMassHeal00`, { "system.method": "atwill" });
      await ctx.setHp(ally, 500); await ctx.setHp(caster, 990);
      const r = await ctx.engine("castPicked", { tokenId: caster.id, itemId: item, activityId: "eCa5jzMXR0Pgp3ZV", targetIds: [ally.id, caster.id] });
      await settled(r);
      await pause(4000);
      const [a, l] = [await ctx.hp(ally), await ctx.hp(caster)];
      ctx.expect((a === 999) && (l === 999), `Guérison de groupe : 700 PV répartis — Allié ${a}, Lanceur ${l} (attendu 999 et 999)`);
    });
  }
};
