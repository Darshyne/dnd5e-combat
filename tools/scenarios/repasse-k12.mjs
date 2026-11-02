/**
 * §333, lot K12 de la repasse des créatures : capacités propres lues dans le texte. Arène des sorts : le Lanceur (PNJ), la Cible
 * (999 PV), l'« Ennemi au contact ».
 *  - Décharge aquatique du Plieur de vagues (attaque sans effet) : au toucher, la Cible tombe À terre ;
 *  - Filet collant du Kuo-toa (l'activité ne cite pas l'effet) : sur un échec, la Cible est Entravée ;
 *  - Renvoi de sort du Spectateur (donnée : tous les dégâts sur une réussite) : une réussite n'inflige rien ;
 *  - Sape du Yithien (« Hit Points maximum », pluriel) : sur un échec, le maximum de PV de la Cible baisse ;
 *  - Miasme nocif du Dragon vert adulte (action légendaire « can't take this action again until the start of its next turn ») :
 *    verrouillée après usage, rendue au début du tour du Lanceur.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const MM = "Compendium.dnd-monster-manual.actors.Actor";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k12 — capacités propres des monstres lues dans le texte (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const before = (await ctx.call("get-actor", { actorId: caster.actorId })).system?.resources?.legact ?? {};
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
    const clear = async () => {
      const w = await where(target);
      for ( const e of (await ctx.engine("effectOrigins", { tokenId: target.id })) ?? [] ) {
        if ( ["sticky-net", "sup", "aquatic-burst"].includes(e.identifier) || /maxim/i.test(e.name ?? "") ) await ctx.call("remove-embedded-effect", { ...w, effectId: e.id }).catch(() => {});
      }
      for ( const s of ["prone", "restrained"] ) await ctx.call("set-status", { tokenId: target.id, statusId: s, active: false }).catch(() => {});
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.resources.legact.max": before.max ?? 0, "system.resources.legact.spent": before.spent ?? 0,
        [`flags.${MODULE_ID}.-=legendaryTurn`]: null, [`flags.${MODULE_ID}.-=legendaryWindow`]: null, [`flags.${MODULE_ID}.-=legendaryLocked`]: null } }).catch(() => {});
      await clear();
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];
    const t0 = await ctx.position(target);
    await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
    await pause(800);

    // Décharge aquatique : au toucher, À terre.
    const burst = await lend(`${MM}.mmMerfolkWaveben.Item.mmAquaticBurst00`);
    let checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      await clear();
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: burst, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.hit !== true ) continue;
      await pause(1500);
      ctx.expect((await statuses(target)).includes("prone"), "Décharge aquatique, touché : la Cible tombe À terre");
      checked = true;
    }
    ctx.expect(checked, "la Décharge aquatique touche (20 essais au plus)");

    // Filet collant : sur un échec, Entravé.
    const net = await lend(`${MM}.mmKuotoa00000000.Item.BnRLQOEcoPDYB7fx`);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      await clear();
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: net, activityId: "MxEs7KnCVGemObHx", activityType: "save", targetTokenIds: [target.id], consume: false });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
      await pause(1500);
      ctx.expect((await statuses(target)).includes("restrained"), "Filet collant, échec : la Cible est Entravée");
      checked = true;
    }
    ctx.expect(checked, "la Cible rate la sauvegarde du Filet collant (20 essais au plus)");
    await clear();

    // Renvoi de sort : une réussite n'inflige rien.
    const reflect = await lend(`${MM}.mmSpectator00000.Item.mmSpellReflectio`);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      await ctx.setHp(target, 999);
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: reflect, activityId: "ZYmB6aUHCqkMh0Ji", activityType: "save", targetTokenIds: [target.id], consume: false, rollDamage: true });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== true ) continue;
      await pause(1500);
      const hp = await ctx.hp(target);
      ctx.expect(hp === 999, `Renvoi de sort, réussite : aucun dégât (999 → ${hp})`);
      checked = true;
    }
    ctx.expect(checked, "la Cible réussit la sauvegarde du Renvoi de sort (20 essais au plus)");

    // Sape du Yithien : le maximum de PV baisse.
    if ( packs.includes("dnd-ravenloft-horrors-within.actors") ) {
      const sup = await lend("Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwYithian000000.Item.SOwEgdjXcYSEXaSo");
      checked = false;
      for ( let i = 0; (i < 20) && !checked; i++ ) {
        await clear();
        await ctx.setHp(target, 999);
        await pause(400);
        const u = await ctx.use({ tokenId: caster.id, itemId: sup, activityId: "47eSQFTRLYTDqN2f", activityType: "save", targetTokenIds: [target.id], consume: false, rollDamage: true });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
        await pause(2000);
        const all = (await ctx.engine("effectOrigins", { tokenId: target.id })) ?? [];
        const drained = all.some(e => (e.identifier === "sup") || /maxim/i.test(e.name ?? ""));
        ctx.expect(drained, `Sape, échec : le maximum de PV de la Cible baisse (${all.map(e => e.name).join(", ") || "aucun effet"})`);
        checked = true;
      }
      ctx.expect(checked, "la Cible rate la sauvegarde de la Sape (20 essais au plus)");
      await clear();
    }

    // Miasme nocif : verrou jusqu'au début du tour du Lanceur.
    await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.resources.legact.max": 3, "system.resources.legact.spent": 0 } });
    const miasma = await lend(`${MM}.mmAdultGreenDrag.Item.mmNoxiousMiasma0`);
    await ctx.startCombat([caster, enemy]);
    const s = await ctx.combat();
    const combat = s.combat ?? s.combats?.[0] ?? s;
    for ( const [t, v] of [[enemy, 20], [caster, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = await ctx.combat(); const cc = c.combat ?? c.combats?.[0] ?? c; return cc.combatants?.find(x => x.id === cc.currentCombatantId)?.tokenId; };
    for ( let i = 0; (i < 3) && ((await current()) !== enemy.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( !ctx.expect((await current()) === enemy.id, "combat : au tour de l'Ennemi") ) return;
    await pause(1000);
    const again = l => /again|reprise/i.test(l);
    const u = await ctx.use({ tokenId: caster.id, itemId: miasma, activityId: "Blm8nddvCOH69bL8", activityType: "save", targetTokenIds: [enemy.id], consume: false,
      area: { shape: "rectangle", ...(await ctx.box(enemy)) } });
    await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(2000);
    const locked = await ctx.engine("issues", { tokenId: caster.id, itemId: miasma });
    ctx.expect(locked.some(again), `après le Miasme : verrouillé jusqu'à son prochain tour (${locked.join(" | ")})`);
    await ctx.nextTurn();
    await pause(2500);
    if ( (await current()) === caster.id ) {
      const own = await ctx.engine("issues", { tokenId: caster.id, itemId: miasma });
      ctx.expect(!own.some(again), `au début de son tour : le verrou est levé (${own.join(" | ") || "aucun souci"})`);
    }
  }
};
