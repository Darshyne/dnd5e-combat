/**
 * §313, sous-lot C12-g de la repasse terme par terme : états, durées, fins d'effet. Arène des sorts (Lanceur, Allié, Cible).
 * Chaque partie prête ses items depuis le Manuel des joueurs et remet tout.
 *  - Double illusoire : le double invoqué, c'est le Lanceur qui devient Invisible (et non le double) ;
 *  - Main de l'ultime miséricorde : l'Allié Mort et Empoisonné revient à la vie, sans l'état ;
 *  - Toucher restaurateur : l'Allié Effrayé ne l'est plus ;
 *  - Concentration parfaite : le Lanceur (Moine 15) à 1 point de concentration remonte à 4 au jet d'initiative.
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
  name: "repasse-c12g — Double illusoire, Main de l'ultime miséricorde, Toucher restaurateur, Concentration parfaite (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, target] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, target];
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const summoned = [];
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
      for ( const id of summoned.splice(0) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const t of all ) {
        for ( const e of await ctx.effects(t) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
        for ( const s of ["dead", "unconscious", "prone", "poisoned", "frightened", "invisible"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        await ctx.setHp(t, 999).catch(() => {});
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];
    const cast = async params => {
      const used = await ctx.use(params);
      await pause(1500);
      if ( used.usageMessageId ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null);
      return used.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
    };

    await part("Double illusoire", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplMislead000`, { "system.method": "atwill" });
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: spell, x: home.x + 2 * grid, y: home.y }).catch(err => ({ error: err.message }));
      const double = s?.tokens?.[0];
      if ( !ctx.expect(!!double, `le double apparaît${s?.error ? ` (${s.error})` : ""}`) ) return;
      summoned.push(double.id);
      let invisible = false;
      for ( let n = 0; (n < 20) && !invisible; n++ ) { await pause(500); invisible = (await statuses(caster)).includes("invisible"); }
      ctx.expect(invisible, "le Lanceur est Invisible");
      const doubleStatuses = (await ctx.engine("stats", { tokenId: double.id }).catch(() => null))?.statuses ?? [];
      ctx.expect(!doubleStatuses.includes("invisible"), `le double ne l'est pas (${doubleStatuses.join(", ") || "aucun état"})`);
    });

    await part("Main de l'ultime miséricorde", async () => {
      const mercy = await lend(caster, `${PHB}.classes.Item.phbmnkHandOfUlti`, { "system.uses.spent": 0 });
      await ctx.setHp(ally, 0);
      await ctx.call("set-status", { tokenId: ally.id, statusId: "dead", active: true });
      await ctx.call("set-status", { tokenId: ally.id, statusId: "poisoned", active: true });
      await pause(1200);
      await cast({ tokenId: caster.id, itemId: mercy, activityId: "XtgmW9115BzcLiFr", targetTokenIds: [ally.id], consume: false });
      await pause(2500);
      const st = await statuses(ally);
      ctx.expect(!st.includes("dead") && !st.includes("poisoned") && ((await ctx.hp(ally)) > 0), `l'Allié revient : ${await ctx.hp(ally)} PV, ${st.join(", ") || "aucun état"}`);
    });

    await part("Toucher restaurateur", async () => {
      const touch = await lend(caster, `${PHB}.classes.Item.phbpdnRestoringT`);
      await ctx.call("set-status", { tokenId: ally.id, statusId: "frightened", active: true });
      await pause(1000);
      await cast({ tokenId: caster.id, itemId: touch, activityId: "PgTPWedvQHDlQ7LQ", targetTokenIds: [ally.id], consume: false });
      await pause(2500);
      const st = await statuses(ally);
      ctx.expect(!st.includes("frightened"), `l'Allié n'est plus Effrayé (${st.join(", ") || "aucun état"})`);
    });

    await part("Concentration parfaite", async () => {
      await lend(caster, `${PHB}.classes.Item.phbmnkMonk000000`, { "system.levels": 15 });
      const focus = await lend(caster, `${PHB}.classes.Item.phbmnkMonksFocus`);
      await lend(caster, `${PHB}.classes.Item.phbmnkPerfectFoc`);
      await pause(1000);
      const item = async () => ((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === focus);
      const max = Number((await ctx.engine("stats", { tokenId: caster.id }))?.uses?.[focus]?.max) || 15;
      await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData: { "system.uses.spent": max - 1 }, match: { path: "_id", value: focus } });
      await pause(800);
      await ctx.startCombat([caster, target]);
      const c = await ctx.combat();
      const combat = c.combat ?? c.combats?.[0] ?? c;
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === caster.id).id, value: 15, combatId: ctx.ownCombat });
      await pause(2500);
      const spent = Number((await item())?.system?.uses?.spent) || 0;
      ctx.log(`points dépensés : ${max - 1} → ${spent} (sur ${max})`);
      ctx.expect(max - spent >= 4, `au jet d'initiative, 4 points au moins (${max - spent} restants)`);
    });
  }
};
