/**
 * §300, lot C5 de la repasse terme par terme : zones, émanations, entrées. Arène des sorts (Lanceur, Allié, Cible, Cible voisine).
 * Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Esprits gardiens : la zone avance d'une case, la Cible déjà dedans ne resauvegarde pas ; sortie de l'émanation, sa Vitesse divisée
 *    par deux tombe ; au round suivant, elle y revient et resauvegarde ;
 *  - Tempête de neige : rien à l'incantation, la sauvegarde vient au début du tour de la Cible ;
 *  - Croissance végétale : la zone reste, terrain ×4 ; l'incantation coûte l'action ;
 *  - Aura de vitalité, Soins de groupe : une créature au choix (resp. six) — seules les cochées sont soignées ;
 *  - Courroux des mers : une seule créature de l'émanation sauvegarde et prend les dégâts, pas sa voisine.
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
  name: "repasse-c5 — zones, émanations, entrées (Arène des sorts)",
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
    const regions = [];
    const clearEffects = async () => {
      for ( const t of all ) for ( const e of (await ctx.call("get-actor", { actorId: t.actorId })).effects ?? [] ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
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
    const ticks = async (since, event) => (await ctx.messagesSince(since)).filter(m => m.flags?.["dnd5e-combat"]?.areaTick?.event === event);
    const moveTo = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(1200); };
    const shiftRegion = async (id, dx) => {
      const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: id });
      const shapes = (data.shapes ?? []).map(s => ({ ...s, x: s.x + dx }));
      await ctx.call("update-scene-object", { type: "Region", objectId: id, data: { shapes } });
      await pause(3000);
    };
    const combatOf = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const startFight = async order => {
      await ctx.startCombat(order);
      const c = await combatOf();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; i < 6; i++ ) {
        const now = await combatOf();
        if ( now.combatants?.find(x => x.id === now.currentCombatantId)?.tokenId === order[0].id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200);
      }
      await pause(1500);
    };
    /** L'Allié et la Cible voisine écartés : seule la Cible compte. */
    const clearField = async () => {
      const c = await ctx.position(caster);
      await moveTo(ally, c.x, c.y - 8 * grid);
      await moveTo(other, c.x + 10 * grid, c.y + 8 * grid);
      return c;
    };

    await part("Esprits gardiens", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplSpiritGuar`, { "system.method": "atwill" });
      const c = await clearField();
      await moveTo(target, c.x - 2 * grid, c.y);
      const used = await ctx.use({ tokenId: caster.id, itemId: spell, activityType: "save",
        area: { shape: "circle", x: c.x + grid / 2, y: c.y + grid / 2, radius: 3.5 * grid } });
      if ( used?.regionId ) regions.push(used.regionId);
      const r = await settled(used);
      ctx.expect(named(r).includes("Cible"), `à la pose, la Cible sauvegarde (${named(r).join(", ")})`);
      ctx.expect(await has(target, "spirit-guardians"), "la Cible a la Vitesse divisée par deux");
      const since = used.usageMessageId;
      await shiftRegion(used.regionId, grid);
      ctx.expect((await ticks(since, "enter")).length === 0, "la zone avance d'une case : la Cible, déjà dedans, ne resauvegarde pas");
      await moveTo(target, c.x - 2 * grid, c.y + 7 * grid);
      await pause(1500);
      ctx.expect(!await has(target, "spirit-guardians"), "sortie de l'émanation, la Vitesse divisée par deux tombe");
      // Une fois par tour : la zone revient sur la Cible au round suivant.
      await startFight([caster, target]);
      await ctx.nextTurn(); await ctx.nextTurn(); await pause(1500);
      const before = (await ticks(since, "enter")).length;
      await moveTo(target, c.x - grid, c.y);
      let n = before;
      for ( let i = 0; (i < 10) && (n <= before); i++ ) { await pause(1000); n = (await ticks(since, "enter")).length; }
      ctx.expect(n > before, "au round suivant, la Cible revient dans l'émanation : elle « entre » et resauvegarde");
    });

    await part("Tempête de neige", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplSleetStorm`, { "system.method": "atwill" });
      const c = await clearField();
      await moveTo(target, c.x - 4 * grid, c.y);
      await startFight([caster, target]);
      const used = await ctx.use({ tokenId: caster.id, itemId: spell, activityType: "save",
        area: { shape: "circle", x: c.x - 4 * grid + grid / 2, y: c.y + grid / 2, radius: 2 * grid } });
      if ( used?.regionId ) regions.push(used.regionId);
      await pause(5000);
      const res = await ctx.resolution(used.usageMessageId);
      ctx.expect(!named(res).includes("Cible"), `à l'incantation, la Cible ne sauvegarde pas (${named(res).join(", ") || "aucune résolution"})`);
      await ctx.nextTurn();
      let tick = [];
      for ( let i = 0; (i < 10) && !tick.length; i++ ) { await pause(1000); tick = await ticks(used.usageMessageId, "turnStart"); }
      ctx.expect(tick.length >= 1, "au début de son tour dans la tempête, la Cible sauvegarde");
    });

    await part("Croissance végétale", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplPlantGrowt`, { "system.method": "atwill" });
      const c = await clearField();
      await startFight([caster, target]);
      const before = await ctx.engine("budget", { tokenId: caster.id });
      const used = await ctx.use({ tokenId: caster.id, itemId: spell, activityId: "dnd5eactivity000",
        area: { shape: "circle", x: c.x - 4 * grid + grid / 2, y: c.y + grid / 2, radius: 2 * grid } });
      if ( used?.regionId ) regions.push(used.regionId);
      await pause(4000);
      const after = await ctx.engine("budget", { tokenId: caster.id });
      ctx.expect((before?.action === 1) && (after?.action === 0), `Embroussaillement coûte l'action (${before?.action} → ${after?.action})`);
      const region = used?.regionId ? (await ctx.call("get-scene-object", { type: "Region", objectId: used.regionId }).catch(() => null))?.data : null;
      const cost = (region?.behaviors ?? []).find(b => b.type === "modifyMovementCost");
      const walk = cost?.system?.difficulties?.walk;
      ctx.expect(!!region && (walk === 4), `la zone reste, terrain ×4 (${region ? `comportements : ${(region.behaviors ?? []).map(b => b.type).join(", ")}, marche ×${walk}` : "zone retirée"})`);
    });

    await part("Aura de vitalité", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplAuraofVita`, { "system.method": "atwill" });
      const c = await ctx.position(caster);
      await moveTo(ally, c.x + grid, c.y);
      await ctx.setHp(ally, 500); await ctx.setHp(caster, 500);
      const list = await ctx.engine("pickTargets", { tokenId: caster.id, itemId: spell, activityId: "dnd5eactivity000" });
      const checked = (list.creatures ?? []).filter(x => x.checked).length;
      ctx.expect((list.max === 1) && (checked === 1), `une seule créature au choix (max ${list.max}, ${checked} cochée)`);
      await settled(await ctx.engine("castPicked", { tokenId: caster.id, itemId: spell, activityId: "dnd5eactivity000", targetIds: [ally.id] }));
      await pause(3000);
      const [a, l] = [await ctx.hp(ally), await ctx.hp(caster)];
      ctx.expect((a > 500) && (l === 500), `seul l'Allié est soigné (Allié ${a}, Lanceur ${l})`);
    });

    await part("Soins de groupe", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplMassCureWo`, { "system.method": "atwill" });
      const c = await ctx.position(caster);
      await moveTo(ally, c.x + grid, c.y);
      await ctx.setHp(ally, 500); await ctx.setHp(caster, 500); await ctx.setHp(target, 500);
      const list = await ctx.engine("pickTargets", { tokenId: caster.id, itemId: spell, activityId: "dnd5eactivity000" });
      ctx.expect(list.max === 6, `jusqu'à six créatures (max ${list.max})`);
      await settled(await ctx.engine("castPicked", { tokenId: caster.id, itemId: spell, activityId: "dnd5eactivity000", targetIds: [ally.id, caster.id] }));
      await pause(3000);
      const [a, l, t] = [await ctx.hp(ally), await ctx.hp(caster), await ctx.hp(target)];
      ctx.expect((a > 500) && (l > 500) && (t === 500), `les cochées sont soignées, pas la Cible (Allié ${a}, Lanceur ${l}, Cible ${t})`);
    });

    await part("Courroux des mers", async () => {
      await lend(caster, `${PHB}.classes.Item.phbdrdDruid00000`, { "system.levels": 6 });
      await lend(caster, `${PHB}.classes.Item.phbdrdCirsea0000`);
      await lend(caster, `${PHB}.classes.Item.phbdrdWildShape0`, { "system.uses.spent": 0 });
      const item = await lend(caster, `${PHB}.classes.Item.phbdrdWrathOfThe`);
      const c = await ctx.position(caster);
      await moveTo(ally, c.x, c.y - 8 * grid);
      await moveTo(target, c.x - grid, c.y);
      await moveTo(other, c.x + grid, c.y);
      const list = await ctx.engine("pickTargets", { tokenId: caster.id, itemId: item, activityId: "nNTYj4vqURV4Dhjt" });
      const shown = (list.creatures ?? []).map(x => `${x.name}${x.checked ? " ✓" : ""}`);
      ctx.expect((list.max === 1) && shown.some(s => s.startsWith("Cible")) && (shown.filter(s => s.endsWith("✓")).length === 1),
        `une créature au choix dans l'émanation (${shown.join(", ")}, rayon ${list.radius} ${list.units})`);
      const r = await settled(await ctx.engine("castPicked", { tokenId: caster.id, itemId: item, activityId: "nNTYj4vqURV4Dhjt", targetIds: [target.id] }));
      ctx.expect(named(r).includes("Cible") && !named(r).includes("Cible voisine"), `seule la Cible sauvegarde (${named(r).join(", ")})`);
      ctx.expect(await ctx.hp(other) === 999, "la Cible voisine ne prend rien");
    });
  }
};
