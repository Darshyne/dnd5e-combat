/**
 * §402 : écarts moyens de la repasse des sorts, corrigés — joués dans l'« Arène des sorts ». `PART=<mot>` ne joue que les parties dont
 * le nom le contient.
 *  - repli : Repli expéditif (Foncer en action Bonus) puis Foncer avec l'action → trois fois la Vitesse au budget du tour.
 *  - dedale : Dédale pose « Banished » d'office (activité de test de la donnée) → la Cible est cachée, puis revient à la fin.
 *  - parole : Parole divine sur une Cible faite Fiélon (999 PV) qui rate → renvoyée (token cachée), quels que soient ses PV.
 *  - petrification : Pétrification sur la Créature artificielle → réussite d'office, sans jet.
 *  - oeil : Mauvais œil — une cible qui a réussi n'est plus affectée par les reprises du sort.
 *  - rappel : Rappel à la vie — les quatre effets de −1 posés, un Repos long en retire un.
 *  - renvoi : Dissipation du mal et du bien, « Renvoi » sur la Cible faite Fiélon → renvoyée (cachée) sur un échec.
 *  - duel : Duel forcé posé sur la Cible (à 20 ft du Lanceur) — un pas à 25 ft passe, un pas à 45 ft est refusé.
 *  - vent : Frappe du vent d'acier sur la Cible et sa voisine — après les attaques, la question « se téléporter près d'une cible ».
 *  - discours : Discours captivant en combat sur la Cible hostile → réussite d'office (« vous la combattez »).
 *  - cercle : l'effet de Cercle de pouvoir sur la Cible ; une Boule de feu réussie → aucun dégât.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = id => `Compendium.dnd-players-handbook.spells.Item.${id}`;
const pause = ms => new Promise(r => setTimeout(r, ms));
const only = (process.env.PART ?? "").toLowerCase();
const wanted = name => !only || name.toLowerCase().includes(only);

/** Lance `use` et répond aux fenêtres qui s'ouvrent chez le MJ pendant ce temps (même aide que choix-sorts). `tail` : tours d'attente
 * après la fin de `use` (une question qui suit la résolution, comme la téléportation de Frappe du vent d'acier). */
async function usingWith(ctx, use, answer, { tail=3 }={}) {
  const seen = [];
  const known = new Set(((await ctx.call("list-dialogs", {}).catch(() => null))?.windows ?? []).map(w => w.id));
  let done = false;
  const using = use().catch(err => ({ used: false, reason: err.message })).finally(() => { done = true; });
  for ( let after = 0; after < tail; ) {
    const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1500, details: true }).catch(() => null);
    for ( const d of r?.windows ?? [] ) {
      known.add(d.id);
      seen.push(d);
      const params = answer(d);
      if ( params ) await ctx.call("answer-dialog", { id: d.id, ...params }).catch(() => {});
    }
    if ( done ) after++;
  }
  return { used: await using, seen };
}

/** L'état « caché » d'un token. */
async function hidden(ctx, token) {
  const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
  return data.hidden === true;
}
async function unhide(ctx, token) {
  await ctx.call("update-scene-object", { type: "Token", objectId: token.id, data: { hidden: false, "flags.dnd5e-combat.-=banished": null } }).catch(() => {});
}
/** Change le type de créature d'un token non lié (son delta), et le remet à la fin. */
async function setType(ctx, token, type) {
  // L'acteur du token (synthétique pour un token non lié : la modification va dans son delta) — un update-scene-object du delta par
  // chemin à points est refusé par le cœur.
  const set = value => ctx.call("run-script", { code: `const a = canvas.scene.tokens.get("${token.id}").actor; const before = a.system.details.type.value; await a.update({ "system.details.type.value": ${JSON.stringify("__V__")} }); return before;`.replace('"__V__"', JSON.stringify(value)) });
  const r = await set(type);
  const before = r?.result ?? "humanoid";
  ctx.restore(() => set(before).catch(() => {}));
}

export default {
  name: "écarts moyens des sorts corrigés (§402)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const target = await ctx.token("Cible");
    const hero = await ctx.token("Héros");

    // ---- Repli expéditif puis Foncer ----
    if ( wanted("repli") ) {
      await ctx.ensureItem(caster, PHB("phbsplExpeditiou"));
      const fight = await ctx.startCombat([caster, target]);
      // Le lanceur ne referme que le dernier combat ouvert (`ctx.ownCombat`) : celui-ci se referme ici.
      ctx.restore(() => (fight?.id ? ctx.call("end-combat", { combatId: fight.id }).catch(() => {}) : null));
      // Le tour du Lanceur : Foncer se paie avec son action.
      await ctx.call("run-script", { code: `const c = game.combats.find(x => x.combatants.some(k => k.tokenId === "${caster.id}")); const i = c.turns.findIndex(k => k.tokenId === "${caster.id}"); await c.update({ turn: i }); return i;` });
      await pause(1000);
      const speed = Number((await ctx.call("get-actor", { actorId: caster.actorId })).system?.attributes?.movement?.walk) || 30;
      await ctx.use({ tokenId: caster.id, identifier: "expeditious-retreat" });
      await pause(1500);
      const afterBonus = await ctx.engine("budget", { tokenId: caster.id });
      await ctx.call("run-script", { code: `const t = canvas.scene.tokens.get("${caster.id}"); return game.modules.get("dnd5e-combat").api.basics.take(t.actor, "dash");` });
      const afterAction = await ctx.engine("budget", { tokenId: caster.id });
      ctx.expect((afterBonus?.dashes ?? (afterBonus?.dashed ? 1 : 0)) === 1, `Repli expéditif : un Foncer (${afterBonus?.dashes}, action Bonus ${afterBonus?.bonus})`);
      ctx.expect(afterAction?.dashes === 2, `puis Foncer avec l'action : deux Foncer (${afterAction?.dashes}, action ${afterAction?.action})`);
      ctx.expect(afterAction?.cap === speed * 3 || afterAction?.cap === null, `déplacement du tour : trois fois la Vitesse (${afterAction?.cap} pour ${speed})`);
    }

    // ---- Dédale ----
    if ( wanted("dedale") ) {
      await ctx.ensureItem(caster, PHB("phbsplMaze000000"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "maze"); await unhide(ctx, target); });
      const u = await ctx.use({ tokenId: caster.id, identifier: "maze", targetTokenIds: [target.id] });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId).catch(() => null);
      await pause(1500);
      const on = await ctx.effectsFrom(target, "maze");
      ctx.expect(on.length > 0, `Dédale : « Banished » posé d'office sur la Cible (${on.map(e => e.name).join(", ") || "rien"})`);
      ctx.expect(await hidden(ctx, target), "Dédale : la Cible quitte la scène (cachée)");
      await ctx.removeEffectsFrom(target, "maze");
      await pause(1500);
      ctx.expect(!(await hidden(ctx, target)), "Dédale fini : la Cible revient");
    }

    // ---- Parole divine ----
    if ( wanted("parole") ) {
      await ctx.ensureItem(caster, PHB("phbsplDivineWord"));
      await setType(ctx, target, "fiend");
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "divine-word"); await unhide(ctx, target); });
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await unhide(ctx, target);
        const u = await ctx.use({ tokenId: caster.id, identifier: "divine-word", activityType: "save", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Cible");
        if ( t?.save?.success !== false ) continue;
        failed = true;
        await pause(1500);
        ctx.expect(await hidden(ctx, target), "Parole divine : le Fiélon à 999 PV qui rate est renvoyé (caché)");
      }
      if ( !failed ) ctx.expect(false, "Parole divine : aucun échec en 20 essais");
      await unhide(ctx, target);
    }

    // ---- Dissipation du mal et du bien : le Renvoi ----
    if ( wanted("renvoi") ) {
      await ctx.ensureItem(caster, PHB("phbsplDispelEvil"));
      await setType(ctx, target, "fiend");
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "dispel-evil-and-good"); await unhide(ctx, target); });
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await unhide(ctx, target);
        const u = await ctx.use({ tokenId: caster.id, identifier: "dispel-evil-and-good", activityId: "dnd5eactivity000", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
        failed = true;
        await pause(1500);
        ctx.expect(await hidden(ctx, target), "Renvoi : le Fiélon qui rate est renvoyé (caché)");
      }
      if ( !failed ) ctx.expect(false, "Renvoi : aucun échec en 20 essais");
      await unhide(ctx, target);
    }

    // ---- Duel forcé : la laisse de 9 m ----
    if ( wanted("duel") ) {
      const itemId = await ctx.ensureItem(caster, PHB("phbsplCompelledD"));
      const grid = await ctx.gridSize();
      const home = await ctx.position(target);
      ctx.restore(async () => {
        await ctx.removeEffectsFrom(target, "compelled-duel");
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId, effectId: "FqWUxRHs4LAj7IIb" });
      const walk = x => ctx.call("update-scene-object", { type: "Token", objectId: target.id, data: { x, y: home.y } }).catch(err => ({ error: err.message }));
      await walk(home.x + grid);
      await pause(1500);
      const near = await ctx.position(target);
      ctx.expect(Math.round((near.x - home.x) / grid) === 1, `Duel forcé : un pas à 25 ft du lanceur passe (${Math.round((near.x - home.x) / grid)} case)`);
      await walk(home.x + 5 * grid);
      await pause(1500);
      const far = await ctx.position(target);
      ctx.expect(far.x === near.x, `Duel forcé : un pas à 45 ft du lanceur est refusé (${Math.round((far.x - home.x) / grid)} cases)`);
    }

    // ---- Pétrification ----
    if ( wanted("petrification") ) {
      const golem = await ctx.token("Créature artificielle");
      await ctx.ensureItem(caster, PHB("phbsplFleshtoSto"));
      ctx.restore(() => ctx.removeEffectsFrom(golem, "flesh-to-stone"));
      const u = await ctx.use({ tokenId: caster.id, identifier: "flesh-to-stone", targetTokenIds: [golem.id] });
      const r = await ctx.settle(u.usageMessageId).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Créature artificielle");
      ctx.expect(t?.save?.success === true && (t.save.auto ?? "").startsWith("type:"), `Pétrification : la Créature artificielle réussit d'office (${JSON.stringify(t?.save)})`);
      const on = (await ctx.effectsFrom(golem, "flesh-to-stone")).map(e => e.name);
      ctx.expect(!on.some(n => /Turning to Stone|Pétrifi/i.test(n)), `pas d'Entravé de l'échec (${on.join(", ") || "aucun effet"})`);
    }

    // ---- Mauvais œil ----
    if ( wanted("oeil") ) {
      await ctx.ensureItem(caster, PHB("phbsplEyebite000"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "eyebite"); });
      let saved = false;
      for ( let i = 0; (i < 20) && !saved; i++ ) {
        await ctx.removeEffectsFrom(target, "eyebite");
        const u = await ctx.use({ tokenId: caster.id, identifier: "eyebite", activityId: "r5eaxtkEdeKOXeHb", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== true ) continue;
        saved = true;
        await pause(1000);
        const again = await ctx.use({ tokenId: caster.id, identifier: "eyebite", activityId: "3PZbzzH8sBJl3heA", targetTokenIds: [target.id] });
        const r2 = again.usageMessageId ? await ctx.settle(again.usageMessageId).catch(() => null) : null;
        const t2 = r2?.targets?.find(x => x.name === "Cible");
        ctx.expect(!r2 || !t2 || t2.unaffected, `Mauvais œil : la Cible qui a réussi n'est plus affectée (${t2 ? JSON.stringify({ unaffected: t2.unaffected, save: t2.save?.success }) : "aucune résolution"})`);
      }
      if ( !saved ) ctx.expect(false, "Mauvais œil : aucune réussite en 20 essais");
    }

    // ---- Rappel à la vie ----
    if ( wanted("rappel") ) {
      const itemId = await ctx.ensureItem(caster, PHB("phbsplRaiseDead0"));
      ctx.restore(() => ctx.removeEffectsFrom(hero, "raise-dead"));
      for ( const effectId of ["etY0sDrXe6DcFEzc", "QUWVMgg2HidYsUxy", "0EAyGy8YaKbvgvkm", "vyf4vVVoGkZPyAqa"] ) {
        await ctx.engine("placeItemEffect", { tokenId: hero.id, casterId: caster.id, itemId, effectId });
      }
      const before = await ctx.effectsFrom(hero, "raise-dead");
      await ctx.engine("longRest", { tokenId: hero.id });
      await pause(1500);
      const after = await ctx.effectsFrom(hero, "raise-dead");
      ctx.expect(before.length === 4, `Rappel à la vie : quatre effets de −1 posés (${before.length})`);
      ctx.expect(after.length === 3, `un Repos long en retire un (${after.length} restants : ${after.map(e => e.name).join(", ")})`);
      ctx.expect(!after.some(e => /Day 4|Jour 4/.test(e.name)), "le jour 4 tombe le premier");
    }

    // ---- Frappe du vent d'acier : la téléportation proposée après les attaques ----
    if ( wanted("vent") ) {
      const other = await ctx.token("Cible voisine");
      await ctx.ensureItem(caster, PHB("phbsplSteelWindS"));
      const home = await ctx.position(caster);
      ctx.restore(() => ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "steel-wind-strike", targetTokenIds: [target.id, other.id] }),
        d => {
          const stay = (d.buttons ?? []).find(b => b.action === "stay");
          if ( stay ) return { button: "stay" };
          const ok = (d.buttons ?? []).find(b => /ok|confirm/i.test(b.action ?? ""));
          return ok ? { button: ok.action } : null;
        }, { tail: 30 });
      ctx.expect(run.seen.some(d => (d.buttons ?? []).some(b => b.action === "stay")),
        `Frappe du vent d'acier : la téléportation près d'une cible est proposée (${run.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
    }

    // ---- Discours captivant : réussite d'office d'une créature combattue ----
    if ( wanted("discours") ) {
      await ctx.ensureItem(caster, PHB("phbsplEnthrall00"));
      await ctx.startCombat([caster, target]);
      ctx.restore(() => ctx.removeEffectsFrom(target, "enthrall"));
      const u = await ctx.use({ tokenId: caster.id, identifier: "enthrall", targetTokenIds: [target.id] });
      const r = await ctx.settle(u.usageMessageId).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Cible");
      ctx.expect(t?.save?.success === true && t.save.auto === "fighting", `Discours captivant : la Cible combattue réussit d'office (${JSON.stringify(t?.save)})`);
    }

    // ---- Cercle de pouvoir : rien sur une sauvegarde réussie contre la magie ----
    if ( wanted("cercle") ) {
      const circleId = await ctx.ensureItem(caster, PHB("phbsplCircleofPo"));
      await ctx.ensureItem(caster, PHB("phbsplFireball00"));
      ctx.restore(() => ctx.removeEffectsFrom(target, "circle-of-power"));
      // §438 : Manuel 3.0.0, l'effet n'est plus sur l'item : un effet du compendium d'effets, posé par le comportement de zone de dnd5e
      // (`applyActiveEffect`) — copié ici avec le sort pour origine, comme le fait ce comportement (`system.origin.activity`).
      const circle = ((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === circleId);
      const remote = Object.values(circle?.system?.activities ?? {}).flatMap(a => (a.behaviors ?? []).flatMap(b => b.config?.effects ?? []))
        .find(u => /ActiveEffect/.test(u ?? ""));
      if ( (circle?.effects ?? []).some(e => e._id === "WuYsg2mftQltuDIK") || !remote ) {
        await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: circleId, effectId: "WuYsg2mftQltuDIK" });
      } else {
        ctx.log(`forme 3.0.0 : effet du compendium ${remote}`);
        await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: circleId, uuid: remote });
      }
      const grid = await ctx.gridSize();
      let checked = false;
      for ( let i = 0; (i < 20) && !checked; i++ ) {
        const p = await ctx.position(target);
        const before = await ctx.hp(target);
        const u = await ctx.use({ tokenId: caster.id, identifier: "fireball", activityType: "save", area: { shape: "circle", x: p.x + grid / 2, y: p.y + grid / 2, radius: grid / 2 } });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Cible");
        await pause(1000);
        if ( t?.save?.success !== true ) { await ctx.setHp(target, before); continue; }
        checked = true;
        const after = await ctx.hp(target);
        ctx.expect(after === before, `Cercle de pouvoir : Boule de feu réussie → aucun dégât (${before} → ${after})`);
      }
      if ( !checked ) ctx.expect(false, "Cercle de pouvoir : aucune réussite en 20 essais");
    }
  }
};
