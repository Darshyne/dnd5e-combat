/**
 * §309, sous-lot C12-b de la repasse terme par terme : zones, émanations, auras. Arène des sorts (Lanceur, Allié, Cible, Héros).
 * Chaque partie prête ses items depuis le Manuel des joueurs (ou Ravenloft) et remet tout.
 *  - Invocation de céleste : l'Allié à 1 PV, déjà dans le Cylindre quand il apparaît, est soigné sans attendre sa fin de tour ;
 *  - Métal brûlant : la Cible tient une massue ; ratée, elle la lâche (pas de Désavantage) ; réussie, elle la garde avec « Heated Metal » ;
 *  - Choc de vie (Ravenloft) : le soin donné au Héros à 0 PV (un PJ : un PNJ à 0 PV est mort, §403) fait jaillir la foudre de lui, sur la Cible (ennemie) à côté, pas sur le Lanceur ;
 *  - Aura de protection contre la magie : l'Allié dans l'aura du Lanceur reçoit les résistances ;
 *  - Rage : le Héros en armure lourde ne peut pas entrer en Rage (souci de légalité).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook";
const RAVENLOFT = "Compendium.dnd-ravenloft-horrors-within";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c12b — Invocation de céleste à la pose, Métal brûlant, Choc de vie, Aura de protection contre la magie, Rage en armure lourde",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Cible", "Héros"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, target, hero] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, target, hero];
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
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const t of all ) {
        for ( const e of await ctx.effects(t) ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
        }
        for ( const s of ["dead", "unconscious", "prone"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        await ctx.setHp(t, 999).catch(() => {});
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
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async (first, ...others) => {
      await ctx.startCombat([first, ...others]);
      const c = await state();
      for ( const [i, t] of [first, ...others].entries() ) await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - (5 * i), combatId: ctx.ownCombat });
      for ( let i = 0; (i < 4) && ((await current()) !== first.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === first.id;
    };
    const tiny = async t => { const b = await ctx.box(t); return { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: b.width * 0.6 }; };
    /** Utilise, clique les dés laissés au système (dégâts, soin), attend la résolution. */
    const cast = async params => {
      const used = await ctx.use(params);
      await pause(1500);
      if ( used.usageMessageId ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null);
      return used.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
    };
    const until = async (test, tries=24) => { for ( let i = 0; i < tries; i++ ) { if ( await test() ) return true; await pause(500); } return false; };

    await part("Invocation de céleste", async () => {
      const id = await lend(caster, `${PHB}.spells.Item.phbsplConjureCel`, { "system.method": "atwill" });
      if ( !ctx.expect(await fight(caster, ally, target), "combat : au tour du Lanceur") ) return;
      await ctx.setHp(ally, 1);
      await pause(800);
      const used = await ctx.use({ tokenId: caster.id, itemId: id, activityId: "VjKltnyiWXZ0xDGZ", consume: false, area: await tiny(ally) });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
      ctx.expect(await until(async () => (await ctx.hp(ally)) > 1), `l'Allié, déjà dans le Cylindre, est soigné à son apparition (${await ctx.hp(ally)} PV)`);
    });

    await part("Métal brûlant", async () => {
      const heat = await lend(caster, `${PHB}.spells.Item.phbsplHeatMetal0`, { "system.method": "atwill" });
      const club = await lend(target, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      let seen = { failed: false, saved: false };
      for ( let i = 0; (i < 8) && !(seen.failed && seen.saved); i++ ) {
        await ctx.call("upsert-actor-item", { actorId: target.actorId, itemData: { "system.equipped": true }, match: { path: "_id", value: club } });
        for ( const e of await ctx.effects(target) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: target.actorId, effectId: e._id ?? e.id }).catch(() => {});
        await pause(600);
        const since = await ctx.lastMessageId();
        await cast({ tokenId: caster.id, itemId: heat, activityId: "2jWlvr2titPfBMEm", targetTokenIds: [target.id], consume: false });
        // L'éclat (la sauvegarde de Constitution) suit les dégâts : sa propre résolution, attendue jusqu'au bout.
        let burst = null;
        for ( let n = 0; (n < 30) && !burst; n++ ) { await pause(500); burst = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "burst"); }
        const r = burst ? await ctx.settle(burst.id, { timeoutMs: 30000 }).catch(() => null) : null;
        await pause(1500);
        const saved = r?.targets?.find(t => t.name === "Cible")?.save?.success ?? null;
        const equipped = ((await ctx.call("get-actor", { actorId: target.actorId })).items ?? []).find(i => i._id === club)?.system?.equipped;
        const heated = (await ctx.effects(target)).some(e => /Heated|brûlant/i.test(e.name));
        ctx.log(`essai ${i + 1} : sauvegarde ${saved === null ? "?" : (saved ? "réussie" : "ratée")}, massue ${equipped ? "gardée" : "lâchée"}, « Heated Metal » ${heated ? "posé" : "absent"}`);
        if ( saved === false ) { seen.failed = true; ctx.expect(!equipped && !heated, `ratée : la massue tombe, pas de Désavantage (essai ${i + 1})`); }
        else if ( saved === true ) { seen.saved = true; ctx.expect(equipped && heated, `réussie : la massue gardée, « Heated Metal » posé (essai ${i + 1})`); }
      }
      ctx.expect(seen.failed && seen.saved, `les deux issues vues (ratée ${seen.failed}, réussie ${seen.saved})`);
    });

    await part("Choc de vie", async () => {
      const packs = JSON.stringify(await ctx.call("list-compendiums", {}).catch(() => ""));
      if ( !packs.includes("dnd-ravenloft-horrors-within") ) { ctx.log("Ravenloft absent : non applicable"); return; }
      const jolt = await lend(caster, `${RAVENLOFT}.options.Item.AVoqeXk2ZFHWZzQB`, { "system.uses.spent": 0 });
      const a = homes.get(hero.id);
      await ctx.call("move-token", { tokenId: target.id, x: a.x + grid, y: a.y, elevation: 0 });
      await pause(800);
      await ctx.setHp(hero, 0);
      await pause(800);
      const since = await ctx.lastMessageId();
      await cast({ tokenId: caster.id, itemId: jolt, activityId: "xg84KvaBJVjFZQpV", targetTokenIds: [hero.id], consume: false });
      let burst = null;
      for ( let n = 0; (n < 24) && !burst; n++ ) { await pause(500); burst = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "burst"); }
      if ( !ctx.expect(!!burst, "la foudre jaillit après le soin") ) return;
      const r = await ctx.settle(burst.id, { timeoutMs: 30000 }).catch(() => null);
      const hit = (r?.targets ?? []).map(t => t.name);
      ctx.expect(hit.includes("Cible") && !hit.includes("Lanceur") && !hit.includes("Héros"), `elle frappe la Cible, ni le Lanceur ni le Héros (${hit.join(", ")})`);
      ctx.expect(burst.flags?.[MODULE_ID]?.areaTick?.token?.includes(hero.id), "centrée sur le Héros ranimé");
    });

    await part("Aura de protection contre la magie", async () => {
      await lend(caster, `${PHB}.classes.Item.phbpdnWardingAur`);
      await pause(3000);
      const warded = async () => (await ctx.effects(ally)).some(e => (e.system?.changes ?? e.changes ?? []).some(c => (c.key === "system.traits.dr.value") && (c.value === "necrotic")));
      ctx.expect(await until(warded), "l'Allié à côté du Lanceur a la Résistance aux dégâts nécrotiques (et psychiques, radiants)");
      ctx.expect(!(await ctx.effects(target)).some(e => /Warding|magie/i.test(e.name)), "la Cible (ennemie) ne l'a pas");
    });

    await part("Rage en armure lourde", async () => {
      const rage = await ctx.itemId(hero.id, "rage").catch(() => null) ?? await lend(hero, `${PHB}.classes.Item.phbbrbRage000000`);
      const free = await ctx.engine("issues", { tokenId: hero.id, itemId: rage });
      await lend(hero, `${PHB}.equipment.Item.phbarmPlateArmor`, { "system.equipped": true });
      await pause(800);
      const heavy = await ctx.engine("issues", { tokenId: hero.id, itemId: rage });
      ctx.expect(!free.some(l => /armure lourde|Heavy armor/i.test(l)), `sans armure lourde : pas de souci (${free.join(" | ") || "rien"})`);
      ctx.expect(heavy.some(l => /armure lourde|Heavy armor/i.test(l)), `en armure de plates : « pas de Rage en armure lourde » (${heavy.join(" | ")})`);
    });
  }
};
