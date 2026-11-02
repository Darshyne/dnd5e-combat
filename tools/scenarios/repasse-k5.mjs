/**
 * §326, lot K5 de la repasse des créatures : les actions légendaires. Arène des sorts : le Lanceur (PNJ, trois actions légendaires le
 * temps du scénario) reçoit le Fouet et le Tentacule de l'Aboleth ; combat avec l'« Ennemi au contact ».
 *  - au tour de l'Ennemi, le Fouet (action légendaire) dépense une action légendaire ;
 *  - le Tentacule qu'il annonce passe gratuit (`cost: "free"` sur la carte) ;
 *  - une seconde action légendaire pendant ce même tour est signalée ; à son propre tour aussi.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const MM = "Compendium.dnd-monster-manual.actors.Actor.mmAboleth0000000.Item";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k5 — actions légendaires : dépense, attaque annoncée gratuite, une par tour (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const before = (await ctx.call("get-actor", { actorId: caster.actorId })).system?.resources?.legact ?? {};
    await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.resources.legact.max": 3, "system.resources.legact.spent": 0 } });
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.resources.legact.max": before.max ?? 0, "system.resources.legact.spent": before.spent ?? 0,
        [`flags.${MODULE_ID}.-=legendaryTurn`]: null, [`flags.${MODULE_ID}.-=legendaryWindow`]: null } }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await ctx.setHp(target, 999).catch(() => {});
    });
    const lash = await lend(`${MM}.ko31Vae4lE8qo5Ez`);
    const tentacle = await lend(`${MM}.mmTentacle000000`);
    const spent = async () => Number((await ctx.call("get-actor", { actorId: caster.actorId })).system?.resources?.legact?.spent) || 0;

    // Combat : l'Ennemi d'abord.
    await ctx.startCombat([caster, target]);
    const s = await ctx.combat();
    const combat = s.combat ?? s.combats?.[0] ?? s;
    for ( const [t, v] of [[target, 20], [caster, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = (await ctx.combat()); const cc = c.combat ?? c.combats?.[0] ?? c; return cc.combatants?.find(x => x.id === cc.currentCombatantId)?.tokenId; };
    for ( let i = 0; (i < 3) && ((await current()) !== target.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( !ctx.expect((await current()) === target.id, "combat : au tour de l'Ennemi") ) return;
    await pause(1000);

    ctx.expect(!(await ctx.engine("issues", { tokenId: caster.id, itemId: lash })).some(l => /legendary|légendaire/i.test(l)), "au tour de l'Ennemi : le Fouet est permis");
    const u = await ctx.use({ tokenId: caster.id, itemId: lash, activityType: "utility" });
    await pause(2500);
    ctx.expect((await spent()) === 1, `le Fouet dépense une action légendaire (dépensées : ${await spent()})`);
    const issues = await ctx.engine("issues", { tokenId: caster.id, itemId: lash });
    ctx.expect(issues.some(l => /already|déjà/i.test(l)), `seconde action légendaire dans ce tour : signalée (${issues.join(" | ")})`);
    const a = await ctx.use({ tokenId: caster.id, itemId: tentacle, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
    await ctx.settle(a.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    const card = (await ctx.messagesSince(u.usageMessageId)).find(m => m.id === a.usageMessageId);
    ctx.expect(card?.flags?.[MODULE_ID]?.cost === "free", `le Tentacule annoncé passe gratuit (coût : ${card?.flags?.[MODULE_ID]?.cost ?? "aucun"})`);

    // Son propre tour.
    await ctx.nextTurn();
    await pause(2500);
    if ( (await current()) === caster.id ) {
      const own = await ctx.engine("issues", { tokenId: caster.id, itemId: lash });
      ctx.expect(own.some(l => /own|sien/i.test(l)), `à son propre tour : signalé (${own.join(" | ")})`);
    }
  }
};
