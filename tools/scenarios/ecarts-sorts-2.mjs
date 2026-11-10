/**
 * §403 : écarts moyens de la repasse des sorts, second lot — joués dans l'« Arène des sorts ». `PART=<mot>` ne joue que les parties dont
 * le nom le contient.
 *  - malediction : Malédiction lancée au niveau 5 → pas de Concentration, la malédiction dure 8 heures.
 *  - liberte : Liberté de mouvement sur la Cible, puis l'effet « Slowed » de Lenteur → sans ses changements de Vitesse.
 *  - choc : Choc de vie (Ravenloft) sur la Cible debout → ni soin ni foudre ; à 0 PV → affectée.
 *  - vent : Frappe du vent d'acier sur la Cible et sa voisine → deux attaques, une par créature, sans fenêtre de répartition.
 *  - elementaires : Invocation d'élémentaires mineurs (« Cast ») → une émanation sur le Lanceur, terrain difficile sauf pour sa
 *    disposition.
 *  - bourrasque : en combat, au tour de la Cible, deux cases dans la Ligne vers le Lanceur → 10 ft de plus au budget (`windward`).
 *  - rayon : le Lanceur dans un Rayon de lune → Métamorphose (activité « transform ») refusée par la légalité.
 *  - symbole : le glyphe « Death » déclenché → sa sphère dure (heure de fin à 10 minutes), elle n'est pas retirée après la résolution.
 *  - dissipation : un Rayon de lune posé, Dissipation de la magie sans cible → la question « quel effet » ; le Rayon choisi cesse.
 *  - compulsion : en combat — sans direction, la Cible ne refait pas sa sauvegarde ; direction « est » au tour du Lanceur → la Cible
 *    marche vers l'est à son tour, puis refait sa sauvegarde.
 *  - contre : Ennemi au contact contre le Rayon de givre du Lanceur ; le Lanceur peut contrer ce Contresort (fenêtre) → carte de porte.
 *  - meute : Invocation d'animaux — la meute au contact du Lanceur → l'effet « Strength Save Advantage » sur lui seul ; éloignée → retiré.
 *  - liane : Liane avide — la liane posée à 4 cases de la Cible ; son attaque touche → tirée vers la liane (distance demandée), Agrippée.
 *  - sphere : Sphère de feu — en combat, au tour du Lanceur, la sphère poussée au contact de la Cible → sauvegarde, puis arrêtée.
 *  - tempete : Tempête vengeresse au-dessus de la Cible et de l'Allié — au tour 3, les éclairs : la question « créatures de votre choix ».
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = id => `Compendium.dnd-players-handbook.spells.Item.${id}`;
const RAVENLOFT = id => `Compendium.dnd-ravenloft-horrors-within.options.Item.${id}`;
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));
const only = (process.env.PART ?? "").toLowerCase();
const wanted = name => !only || name.toLowerCase().includes(only);

/** Lance `use` et répond aux fenêtres qui s'ouvrent chez le MJ pendant ce temps. `tail` : tours d'attente après la fin de `use`. */
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

/** Un script dans le client du MJ ; rend son résultat. */
const script = async (ctx, code) => (await ctx.call("run-script", { code }))?.result;

/** Attend qu'une région posée soit retenue comme zone qui dure (son état `area`), 15 s au plus. */
async function lastingZone(ctx, regionId) {
  for ( let i = 0; i < 30; i++ ) {
    if ( await script(ctx, `return !!canvas.scene.regions.get("${regionId ?? ""}")?.getFlag("${MODULE_ID}", "area")?.usage;`) ) return true;
    await pause(500);
  }
  return false;
}

/** Met le tour du combat du scénario sur ce token. */
async function turnTo(ctx, token) {
  await script(ctx, `const c = game.combats.get("${ctx.ownCombat}"); const i = c.turns.findIndex(k => k.tokenId === "${token.id}"); await c.update({ turn: i }); return i;`);
  await pause(1200);
}

/** Termine le combat du scénario (le lanceur ne referme que le dernier). */
async function endFight(ctx) {
  if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
  ctx.ownCombat = null;
}

export default {
  name: "écarts moyens des sorts, second lot (§403)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const target = await ctx.token("Cible");
    const grid = await ctx.gridSize();
    // La remise en état ne joue qu'à la fin du scénario : une partie qui a besoin des places de départ les reprend ici.
    const targetHome = await ctx.position(target);

    // ---- Malédiction au niveau 5 : sans Concentration, 8 heures ----
    if ( wanted("malediction") ) {
      await ctx.ensureItem(caster, PHB("phbsplBestowCurs"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "bestow-curse"); await ctx.removeEffectsFrom(caster, "bestow-curse"); });
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await ctx.removeEffectsFrom(target, "bestow-curse");
        const u = await ctx.use({ tokenId: caster.id, identifier: "bestow-curse", activityId: "azVyTkiGPeIqMzxu", targetTokenIds: [target.id],
          usageConfig: { scaling: 2, spell: { slot: "spell5" } } });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
        failed = true;
        await pause(1500);
        const state = await script(ctx, `const t = canvas.scene.tokens.get("${target.id}"); const c = canvas.scene.tokens.get("${caster.id}");
          const curse = t.actor.effects.find(e => e.name === "Cursed Attacks" || /Attaques maudites|Cursed Attacks/.test(e.name));
          return { duration: curse?.duration?.seconds ?? curse?.duration?.value ?? null, dependent: curse?.getFlag("dnd5e", "dependentOn") ?? null,
            concentrating: c.actor.effects.some(e => e.statuses.has("concentrating") && /Bestow|Malédiction/i.test(e.name)) };`);
        ctx.expect(state?.concentrating === false, `Malédiction niveau 5 : le Lanceur ne se concentre pas (${JSON.stringify(state)})`);
        ctx.expect(state?.duration === 28800, `la malédiction dure 8 heures (${state?.duration} s)`);
      }
      if ( !failed ) ctx.expect(false, "Malédiction : aucun échec en 20 essais");
    }

    // ---- Liberté de mouvement : Lenteur ne réduit pas la Vitesse ----
    if ( wanted("liberte") ) {
      const fom = await ctx.ensureItem(caster, PHB("phbsplFreedomofM"));
      const slow = await ctx.ensureItem(caster, PHB("phbsplSlow000000"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "freedom-of-movement", "slow"); });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: fom, effectId: "bcTPZ6dJ4kHwaBRD" });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: slow, effectId: "z1lkguBohjqXRSHm" });
      await pause(800);
      const changes = await script(ctx, `const t = canvas.scene.tokens.get("${target.id}");
        const e = t.actor.effects.find(x => x.name === "Slowed" || /Ralenti/.test(x.name)); return e ? (e.system?.changes ?? e.changes).map(c => c.key) : null;`);
      ctx.expect(Array.isArray(changes) && changes.length && !changes.some(k => k.includes("movement")),
        `Liberté de mouvement : « Slowed » posé sans réduction de Vitesse (${JSON.stringify(changes)})`);
    }

    // ---- Choc de vie : seulement à 0 PV ----
    if ( wanted("choc") ) {
      // Le Héros (personnage joueur) : à 0 PV il est inconscient, pas mort — un PNJ à 0 PV est mort pour dnd5e.
      const ally = await ctx.token("Héros");
      await ctx.ensureItem(caster, RAVENLOFT("AVoqeXk2ZFHWZzQB"));
      const hp0 = await ctx.hp(ally);
      ctx.restore(() => ctx.setHp(ally, hp0));
      const standing = await ctx.use({ tokenId: caster.id, identifier: "jolt-to-life", activityId: "xg84KvaBJVjFZQpV", targetTokenIds: [ally.id], rollDamage: true });
      const r1 = standing.usageMessageId ? await ctx.settle(standing.usageMessageId).catch(() => null) : null;
      const t1 = r1?.targets?.find(x => x.name === "Héros");
      ctx.expect(!!t1?.unaffected, `Choc de vie sur une créature debout : non affectée (${JSON.stringify(t1?.unaffected ?? null)})`);
      await ctx.setHp(ally, 0);
      const down = await ctx.use({ tokenId: caster.id, identifier: "jolt-to-life", activityId: "xg84KvaBJVjFZQpV", targetTokenIds: [ally.id], rollDamage: true });
      const r2 = down.usageMessageId ? await ctx.settle(down.usageMessageId).catch(() => null) : null;
      const t2 = r2?.targets?.find(x => x.name === "Héros");
      ctx.expect(!!t2 && !t2.unaffected, `à 0 PV : affectée (${t2 ? JSON.stringify(t2.unaffected) : "pas de cible"})`);
    }

    // ---- Frappe du vent d'acier : une attaque par créature ----
    if ( wanted("vent") ) {
      const other = await ctx.token("Cible voisine");
      await ctx.ensureItem(caster, PHB("phbsplSteelWindS"));
      const home = await ctx.position(caster);
      ctx.restore(() => ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      const since = await ctx.lastMessageId();
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "steel-wind-strike", targetTokenIds: [target.id, other.id] }),
        d => ((d.buttons ?? []).some(b => b.action === "stay") ? { button: "stay" } : null), { tail: 30 });
      const usages = (await ctx.messagesSince(since)).filter(m => m.type === "usage" && /Steel Wind|vent d'acier/i.test(m.flavor ?? m.content ?? m.speakerItem ?? "") || (m.flags?.[MODULE_ID]?.projectileOf));
      ctx.expect(!run.seen.some(d => /répartir|allocate/i.test(d.title ?? "")), `pas de fenêtre de répartition (${run.seen.map(d => d.title).join(" | ") || "aucune"})`);
      const chained = (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.projectileOf).length;
      ctx.expect(chained === 1, `une seule attaque enchaînée pour la seconde créature (${chained})`);
      ctx.log(`messages du lancement : ${usages.length}`);
    }

    // ---- Invocation d'élémentaires mineurs : terrain difficile pour les ennemis ----
    if ( wanted("elementaires") ) {
      await ctx.ensureItem(caster, PHB("phbsplConjureMin"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Conjure Minor|élémentaires mineurs/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(caster, "conjure-minor-elementals");
      });
      const u = await ctx.use({ tokenId: caster.id, identifier: "conjure-minor-elementals", activityId: "VSwMJFQoi3KU3Ais" });
      await pause(2500);
      const zone = await script(ctx, `const c = canvas.scene.tokens.get("${caster.id}");
        const r = canvas.scene.regions.find(x => x.getFlag("dnd5e", "item")?.includes?.("${caster.id}") || /Conjure Minor|élémentaires mineurs/i.test(x.name));
        if ( !r ) return null; const b = r.behaviors.find(x => x.type === "dnd5e.difficultTerrain");
        return { attached: r.attachment?.token ?? null, ignored: b ? [...b.system.ignoredDispositions] : null, disposition: c.disposition };`);
      ctx.expect(!!zone, `Invocation d'élémentaires mineurs : une émanation posée (${JSON.stringify(u.reason ?? null)})`);
      if ( zone ) ctx.expect(Array.isArray(zone.ignored) && zone.ignored.includes(zone.disposition),
        `terrain difficile, sauf pour la disposition du Lanceur (${JSON.stringify(zone)})`);
    }

    // ---- Bourrasque : vers le lanceur dans la Ligne, le double ----
    if ( wanted("bourrasque") ) {
      await ctx.ensureItem(caster, PHB("phbsplGustofWind"), { system: { method: "atwill" } });
      const home = await ctx.position(target);
      ctx.restore(async () => {
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
        await ctx.removeEffectsFrom(caster, "gust-of-wind");
      });
      const fight = await ctx.startCombat([caster, target]);
      // La Ligne d'est en ouest devant le Lanceur, 12 cases × 2 ; la sauvegarde ne compte pas ici (la Cible peut être repoussée).
      const p = await ctx.position(caster);
      const u = await ctx.use({ tokenId: caster.id, identifier: "gust-of-wind", activityType: "save", consume: false,
        area: { shape: "rectangle", x: p.x + grid, y: p.y, width: 12 * grid, height: grid } });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      // La Cible remise à 6 cases du Lanceur, dans la Ligne, et c'est son tour.
      await ctx.call("move-token", { tokenId: target.id, x: p.x + 6 * grid, y: p.y, elevation: 0 });
      await turnTo(ctx, target);
      const before = await ctx.engine("budget", { tokenId: target.id });
      await ctx.engine("move", { tokenId: target.id, point: { x: p.x + 4 * grid + grid / 2, y: p.y + grid / 2 } }).catch(err => ctx.log(`move : ${err.message}`));
      await pause(2000);
      const after = await ctx.engine("budget", { tokenId: target.id });
      const pos = await ctx.position(target);
      ctx.log(`Cible : ${Math.round((p.x + 6 * grid - pos.x) / grid)} case(s) vers le Lanceur`);
      ctx.expect(((after?.windward ?? 0) - (before?.windward ?? 0)) === 10, `Bourrasque : deux cases vers le Lanceur dans la Ligne → 10 ft de plus (${before?.windward ?? 0} → ${after?.windward ?? 0})`);
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Rayon de lune : pas d'autre forme dans la lumière ----
    if ( wanted("rayon") ) {
      await ctx.ensureItem(caster, PHB("phbsplMoonbeam00"));
      const poly = await ctx.ensureItem(caster, PHB("phbsplPolymorph0"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Moonbeam|Rayon de lune/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(caster, "moonbeam");
      });
      const p = await ctx.position(caster);
      const before = await ctx.engine("issues", { tokenId: caster.id, itemId: poly, activityType: "transform" }).catch(err => [`erreur : ${err.message}`]);
      // Le Lanceur subit son propre Rayon : une concentration ratée emporte la zone — on relance (5 fois au plus).
      let placed = false;
      for ( let i = 0; (i < 5) && !placed; i++ ) {
        const u = await ctx.use({ tokenId: caster.id, identifier: "moonbeam", activityType: "save", consume: false,
          area: { shape: "circle", x: p.x + grid / 2, y: p.y + grid / 2, radius: grid } });
        if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(2000);
        placed = await lastingZone(ctx, u.regionId);
      }
      ctx.expect(placed, "le Rayon de lune est posé sur le Lanceur");
      const inside = await ctx.engine("issues", { tokenId: caster.id, itemId: poly, activityType: "transform" }).catch(err => [`erreur : ${err.message}`]);
      ctx.expect(!before.some(l => /lumière|light/i.test(l)), `hors du Rayon : Métamorphose permise (${before.join(" | ") || "aucun souci"})`);
      ctx.expect(inside.some(l => /forme|form/i.test(l)), `dans le Rayon de lune : Métamorphose refusée (${inside.join(" | ") || "aucun souci"})`);
    }

    // ---- Symbole : la sphère dure ----
    if ( wanted("symbole") ) {
      await ctx.ensureItem(caster, PHB("phbsplSymbol0000"));
      const p = await ctx.position(target);
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => r.getFlag("dnd5e", "item")?.includes?.("Item.") && /Symbol|Symbole/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(target, "symbol");
      });
      const u = await ctx.use({ tokenId: caster.id, identifier: "symbol", activityId: "oCs1sUAtUAQJwxPU", consume: false,
        area: { shape: "circle", x: p.x + grid / 2, y: p.y + grid / 2, radius: grid } });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const zone = await script(ctx, `const r = canvas.scene.regions.get("${u.regionId ?? ""}"); if ( !r ) return null;
        return { area: !!r.getFlag("${MODULE_ID}", "area")?.usage, expiresAt: r.getFlag("${MODULE_ID}", "expiresAt") ?? null, now: game.time.worldTime };`);
      ctx.expect(!!zone?.area, `Symbole (Mort) : la sphère reste, zone qui dure (${JSON.stringify(zone)})`);
      if ( zone?.expiresAt ) ctx.expect(Math.round(zone.expiresAt - zone.now) === 600, `fin dans 10 minutes (${Math.round(zone.expiresAt - zone.now)} s)`);
    }

    // ---- Dissipation de la magie sur une zone ----
    if ( wanted("dissipation") ) {
      const other = await ctx.token("Cible voisine");
      await ctx.ensureItem(other, PHB("phbsplMoonbeam00"));
      await ctx.ensureItem(caster, PHB("phbsplDispelMagi"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Moonbeam|Rayon de lune/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(other, "moonbeam");
      });
      const p = await ctx.position(other);
      const mb = await ctx.use({ tokenId: other.id, identifier: "moonbeam", activityType: "save", consume: false,
        area: { shape: "circle", x: p.x + 3 * grid, y: p.y + grid / 2, radius: grid } });
      if ( mb.usageMessageId ) await ctx.settle(mb.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      ctx.expect(await lastingZone(ctx, mb.regionId), "le Rayon de lune de la Cible voisine est posé");
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "dispel-magic", targetTokenIds: [] }),
        d => {
          const zoneButton = (d.buttons ?? []).find(b => /Moonbeam|Rayon de lune/i.test(b.label ?? "") && /Cible voisine/.test(b.label ?? ""));
          return zoneButton ? { button: zoneButton.action } : null;
        }, { tail: 6 });
      await pause(1500);
      const still = await script(ctx, `return !!canvas.scene.regions.get("${mb.regionId ?? ""}");`);
      ctx.expect(run.seen.some(d => (d.buttons ?? []).some(b => /Moonbeam|Rayon de lune/i.test(b.label ?? ""))),
        `Dissipation sans cible : la question propose le Rayon de lune (${run.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
      ctx.expect(still === false, "le Rayon de lune choisi cesse (zone retirée)");
    }

    // ---- Compulsion : direction, marche, puis sauvegarde ----
    if ( wanted("compulsion") ) {
      await ctx.ensureItem(caster, PHB("phbsplCompulsion"));
      const home = await ctx.position(target);
      ctx.restore(async () => {
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
        await ctx.removeEffectsFrom(target, "compulsion");
        await ctx.removeEffectsFrom(caster, "compulsion");
      });
      const fight = await ctx.startCombat([caster, target]);
      await turnTo(ctx, caster);
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await ctx.removeEffectsFrom(target, "compulsion");
        const u = await ctx.use({ tokenId: caster.id, identifier: "compulsion", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        failed = r?.targets?.find(x => x.name === "Cible")?.save?.success === false;
      }
      if ( ctx.expect(failed, "Compulsion : la Cible rate sa sauvegarde (20 essais au plus)") ) {
        await pause(1000);
        // Le tour de la Cible sans direction : à sa fin, pas de sauvegarde.
        await turnTo(ctx, target);
        const since = await ctx.lastMessageId();
        const toCaster = await usingWith(ctx, async () => { await ctx.nextTurn(); await pause(3000); }, d => {
          if ( /Compulsion|Injonction/i.test(d.title ?? "") ) return { fields: { pick: "3" }, button: "list" };   // 3 : l'est
          return null;
        }, { tail: 6 });
        // Seulement les sauvegardes de Compulsion : les zones des parties précédentes (Symbole…) restent posées jusqu'à la fin.
        const resaveEarly = (await ctx.messagesSince(since)).some(m => m.flags?.[MODULE_ID]?.resave && /Compulsion|Injonction/i.test(JSON.stringify(m)));
        ctx.expect(!resaveEarly, "sans direction, la Cible ne refait pas sa sauvegarde en fin de tour");
        ctx.expect(toCaster.seen.some(d => /Compulsion|Injonction/i.test(d.title ?? "")), `au tour du Lanceur, la question de la direction (${toCaster.seen.map(d => d.title).join(" | ") || "aucune"})`);
        const start = await ctx.position(target);
        await ctx.nextTurn();   // le tour de la Cible : elle marche
        await pause(5000);
        const walked = await ctx.position(target);
        ctx.expect(walked.x > start.x && walked.y === start.y, `la Cible marche vers l'est (${Math.round((walked.x - start.x) / grid)} case(s))`);
        const since2 = await ctx.lastMessageId();
        await ctx.nextTurn();   // fin de son tour : la sauvegarde
        await pause(3000);
        const resave = (await ctx.messagesSince(since2)).some(m => m.flags?.[MODULE_ID]?.resave);
        ctx.expect(resave, "après la marche, la Cible refait sa sauvegarde en fin de tour");
      }
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Contre-Contresort ----
    if ( wanted("contre") ) {
      const enemy = await ctx.token("Ennemi au contact");
      await ctx.ensureItem(enemy, PHB("phbsplCounterspe"), { system: { method: "atwill" } });
      await ctx.ensureItem(caster, PHB("phbsplCounterspe"), { system: { method: "atwill" } });
      await ctx.ensureItem(caster, PHB("phbsplRayofFrost"));
      const since = await ctx.lastMessageId();
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [target.id],
        usageConfig: { [MODULE_ID]: { autoReact: true } } }),
        d => {
          // Le Lanceur contre le Contresort de l'Ennemi ; une troisième fenêtre (l'Ennemi contre à son tour) : non.
          const use = (d.buttons ?? []).find(b => b.action === "use0");
          if ( !use ) return null;
          return /Lanceur/.test(d.title ?? "") ? { button: "use0" } : { button: "none" };
        }, { tail: 20 });
      const gates = (await ctx.messagesSince(since)).map(m => m.flags?.[MODULE_ID]?.gate).filter(g => g?.kind === "counterspell");
      ctx.expect(run.seen.some(d => /Lanceur/.test(d.title ?? "")), `le Lanceur peut contrer le Contresort de l'Ennemi (${run.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
      ctx.expect(gates.some(g => /Counterspell|Contresort/i.test(g.spell ?? "") || (g.spell === "counterspell")),
        `une carte de porte pour le Contresort contré ou tenu (${JSON.stringify(gates.map(g => ({ spell: g.spell, dissipated: g.dissipated })))})`);
    }

    // ---- Invocation d'animaux : l'Avantage de Force du lanceur près de la meute ----
    if ( wanted("meute") ) {
      const spell = await ctx.ensureItem(caster, PHB("phbsplConjureAni"));
      const p = await ctx.position(caster);
      const fight = await ctx.startCombat([caster, target]);   // les auras ne jouent qu'en combat (réglage de monde)
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: spell, x: p.x + grid, y: p.y + grid });
      const pack = s?.tokens?.[0];
      ctx.restore(async () => {
        if ( pack ) await ctx.call("delete-scene-object", { type: "Token", objectId: pack.id }).catch(() => {});
        await ctx.removeEffectsFrom(caster, "conjure-animals", "grant-save-advantage");
      });
      const has = async () => script(ctx, `const t = canvas.scene.tokens.get("${caster.id}"); return t.actor.effects.some(e => /Save Advantage|Avantage/i.test(e.name));`);
      let near = false;
      for ( let i = 0; (i < 10) && !near; i++ ) { await pause(800); near = await has(); }
      ctx.expect(!!pack && near, `meute au contact : l'Avantage de Force sur le Lanceur (${pack?.name ?? "aucune invocation"})`);
      const others = await script(ctx, `return canvas.scene.tokens.filter(t => t.id !== "${caster.id}" && t.actor?.effects.some(e => /Save Advantage|Avantage/i.test(e.name))).map(t => t.name);`);
      ctx.expect(!others?.length, `personne d'autre (${JSON.stringify(others)})`);
      if ( pack ) {
        await ctx.call("move-token", { tokenId: pack.id, x: p.x + 6 * grid, y: p.y + grid, elevation: 0 });
        let gone = false;
        for ( let i = 0; (i < 10) && !gone; i++ ) { await pause(800); gone = !(await has()); }
        ctx.expect(gone, "meute éloignée : l'Avantage tombe");
      }
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Liane avide : attaque, traction, Agrippé ----
    if ( wanted("liane") ) {
      const spell = await ctx.ensureItem(caster, PHB("phbsplGraspingVi"));
      const home = await ctx.position(target);
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: spell, x: home.x + 4 * grid, y: home.y });
      const vine = s?.tokens?.[0];
      ctx.restore(async () => {
        if ( vine ) await ctx.call("delete-scene-object", { type: "Token", objectId: vine.id }).catch(() => {});
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
        await script(ctx, `const t = canvas.scene.tokens.get("${target.id}"); await t.actor.toggleStatusEffect("grappled", { active: false }); return true;`);
        await ctx.removeEffectsFrom(caster, "grasping-vine");
      });
      if ( ctx.expect(!!vine, "Liane avide : la liane est posée") ) {
        let hit = null;
        for ( let i = 0; (i < 20) && !hit; i++ ) {
          await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: 0 });
          const run = await usingWith(ctx, () => ctx.use({ tokenId: vine.id, identifier: "vine-attack", activityType: "attack", targetTokenIds: [target.id], rollDamage: true }),
            d => { const b = (d.buttons ?? []).filter(x => /^\d+\s/.test(x.label ?? "")).sort((a, b) => parseInt(b.label) - parseInt(a.label))[0]; return b ? { button: b.action ?? b.label } : null; }, { tail: 4 });
          const r = run.used?.usageMessageId ? await ctx.settle(run.used.usageMessageId).catch(() => null) : null;
          if ( r?.targets?.find(x => x.name === "Cible")?.hit === true ) hit = run;
        }
        if ( ctx.expect(!!hit, "l'attaque de la liane touche (20 essais au plus)") ) {
          await pause(1500);
          const pos = await ctx.position(target);
          const grappled = await script(ctx, `return canvas.scene.tokens.get("${target.id}").actor.statuses.has("grappled");`);
          ctx.expect(hit.seen.some(d => /Pull|Tirer/i.test(d.title ?? "")), `la distance de traction est demandée (${hit.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
          ctx.expect(Math.round((pos.x - home.x) / grid) === 3, `tirée jusqu'au contact de la liane (${Math.round((pos.x - home.x) / grid)} case(s) sur 4)`);
          ctx.expect(grappled === true, "Agrippée");
        }
      }
    }

    // ---- Sphère de feu : arrêtée au contact ----
    if ( wanted("sphere") ) {
      const spell = await ctx.ensureItem(caster, PHB("phbsplFlamingSph"));
      // La Cible a pu être déplacée (Compulsion, Liane) et Agrippée : retour à sa place, libre, avant la sphère.
      await ctx.removeEffectsFrom(target, "grasping-vine");
      await script(ctx, `const a = canvas.scene.tokens.get("${target.id}").actor; const ids = a.effects.filter(e => e.statuses.has("grappled")).map(e => e.id); if ( ids.length ) await a.deleteEmbeddedDocuments("ActiveEffect", ids); return ids.length;`);
      await ctx.call("move-token", { tokenId: target.id, x: targetHome.x, y: targetHome.y, elevation: targetHome.elevation });
      await pause(800);
      const p = await ctx.position(caster);
      const t = await ctx.position(target);
      const fight = await ctx.startCombat([caster, target]);
      await turnTo(ctx, caster);
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: spell, x: p.x + grid, y: p.y + 2 * grid });
      const ball = s?.tokens?.[0];
      ctx.restore(async () => {
        if ( ball ) await ctx.call("delete-scene-object", { type: "Token", objectId: ball.id }).catch(() => {});
        await ctx.removeEffectsFrom(caster, "flaming-sphere");
      });
      if ( ctx.expect(!!ball, "Sphère de feu : la sphère est posée") ) {
        await pause(1500);
        const since = await ctx.lastMessageId();
        // Au contact de la Cible (la case sous elle).
        await ctx.engine("move", { tokenId: ball.id, point: { x: t.x + grid / 2, y: t.y + 1.5 * grid } }).catch(err => ctx.log(`move : ${err.message}`));
        await pause(3000);
        const pulsed = (await ctx.messagesSince(since)).some(m => m.flags?.[MODULE_ID]?.areaTick?.event === "pulse" || m.flags?.[MODULE_ID]?.areaTick);
        const stopped = await script(ctx, `const b = canvas.scene.tokens.get("${ball.id}"); return b.getFlag("${MODULE_ID}", "stoppedOn") ?? null;`);
        ctx.expect(pulsed, "roulée au contact : la Cible fait la sauvegarde");
        ctx.expect(!!stopped, `puis la sphère s'arrête pour le tour (${stopped})`);
      }
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Tempête vengeresse : les six éclairs au choix ----
    if ( wanted("tempete") ) {
      const ally = await ctx.token("Allié");
      await ctx.ensureItem(caster, PHB("phbsplStormofVen"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Storm of Vengeance|Tempête/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(caster, "storm-of-vengeance");
        await ctx.removeEffectsFrom(target, "storm-of-vengeance");
        await ctx.removeEffectsFrom(ally, "storm-of-vengeance");
      });
      // Le nuage au-dessus de la Cible, de sa voisine et de l'Allié (amené à côté d'elles) ; le Lanceur dehors — sa concentration
      // ne se joue pas à chaque tour.
      const t = await ctx.position(target);
      const allyHome = await ctx.position(ally);
      ctx.restore(() => ctx.call("move-token", { tokenId: ally.id, x: allyHome.x, y: allyHome.y, elevation: allyHome.elevation }).catch(() => {}));
      await ctx.call("move-token", { tokenId: ally.id, x: t.x, y: t.y + grid, elevation: 0 });
      // Le lanceur de scénarios coupe la question des zones (`zoneChoice: never`) le temps d'une passe : remise ici.
      const setting = await ctx.engine("setting", { key: "zoneChoice", value: "mixed" });
      ctx.restore(() => ctx.engine("setting", { key: "zoneChoice", value: setting?.before ?? "never" }));
      const fight = await ctx.startCombat([caster, target, ally]);
      await turnTo(ctx, caster);
      const u = await ctx.use({ tokenId: caster.id, identifier: "storm-of-vengeance", activityType: "save", consume: false,
        area: { shape: "circle", x: t.x + grid, y: t.y + grid, radius: 2 * grid } });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const seen = [];
      for ( let round = 0; (round < 3) && !seen.some(d => /choix|choice/i.test(d.title ?? "")); round++ ) {
        for ( let k = 0; k < 3; k++ ) {
          const r = await usingWith(ctx, async () => { await ctx.nextTurn(); await pause(2500); },
            d => (/Storm|Tempête/i.test(d.title ?? "") ? { button: "ok" } : null), { tail: 4 });
          seen.push(...r.seen);
        }
      }
      ctx.expect(seen.some(d => /Storm|Tempête/i.test(d.title ?? "")), `au tour 3, la question des éclairs (${seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
      if ( fight?.id ) await endFight(ctx);
    }

    if ( process.env.TRACE ) {
      const logs = await ctx.call("get-client-errors", { levels: ["log", "warn"], limit: 300 });
      for ( const e of (logs.errors ?? logs.entries ?? []).filter(e => /dnd5e-combat/.test(e.message ?? e.text ?? "")).slice(-45) ) ctx.log((e.message ?? e.text).slice(0, 200));
    }
    await pause(600);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
