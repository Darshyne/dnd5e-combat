/**
 * Fins de sorts, suite (SPEC §42.2) : ce qui revient à chaque tour, et ce qui suit la fin d'un effet. Sorts prêtés depuis le
 * compendium du Manuel des joueurs ; le Zombi reçoit 300 PV le temps du scénario.
 *  1. Assassin imaginaire : sauvegarde rejouée à la fin du tour de la cible ; ratée, elle subit de nouveau les dégâts ; réussie,
 *     l'effet tombe.
 *  2. Sphère de vitriol : sauvegarde ratée, 5d4 dégâts d'acide de plus à la fin du prochain tour de la cible, puis l'effet tombe.
 *  3. Hâte : quand le sort prend fin, la léthargie est posée ; elle tombe à la fin du prochain tour du porteur.
 *  4. Châtiment de fournaise : le coup pose la brûlure ; au début du tour de la cible, 1d6 dégâts de feu puis la sauvegarde.
 * `PART=Hâte` ne joue que la partie dont le nom le contient. Remet PV, effets, positions, emplacements ; retire les sorts prêtés.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "fins de sorts, suite — Assassin imaginaire, Sphère de vitriol, léthargie de Hâte, Châtiment de fournaise",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Clerc", "Paladin", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.spells") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const mage = await ctx.token("Magicien");
    const clerc = await ctx.token("Clerc");
    const pal = await ctx.token("Paladin");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const only = process.env.PART ?? "";

    // Le Zombi tient les dégâts répétés : 300 PV le temps du scénario.
    const { data: zdata } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const max0 = zdata.delta?.system?.attributes?.hp?.max ?? null;
    const hp0 = await ctx.hp(zombi);
    ctx.restore(async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
        data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {});
      await ctx.setHp(zombi, hp0);
    });
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    const baseline = new Map();
    for ( const t of [mage, clerc, pal, zombi] ) baseline.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const newEffects = async t => (await ctx.effects(t)).filter(e => !baseline.get(t.id).has(e._id ?? e.id));
    const clear = async t => {
      for ( const e of await newEffects(t) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Token", id: t.id, effectId: e._id ?? e.id }).catch(() => ctx.removeEffectsNamed(t, new RegExp(`^${(e.name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)).catch(() => {}));
      }
    };
    const endConcentration = () => ctx.removeStatusEffects(mage, "concentrating");
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await endConcentration();
      await pause(800);
      for ( const t of [zombi, clerc] ) await clear(t);
      for ( const t of [clerc] ) for ( const s of ["incapacitated"] ) await ctx.removeStatusEffects(t, s);
    };
    ctx.restore(reset);

    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    /** Combat entre `first` (qui a la main) et `second`. */
    const fight = async (first, second) => {
      await ctx.startCombat([first, second]);
      const combat = await state();
      for ( const [t, v] of [[first, 20], [second, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== first.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === first.id;
    };
    const part = async (name, fn) => {
      if ( only && !name.toLowerCase().includes(only.toLowerCase()) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** Lance le sort du Magicien sur le Zombi jusqu'à ce qu'il rate sa sauvegarde (20 essais) ; rend la résolution, ou null. */
    const until = async (itemId, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        await endConcentration();
        await clear(zombi);
        await tough();
        await pause(600);
        const used = await ctx.use({ tokenId: mage.id, itemId, activityType: "save", targetTokenIds: [zombi.id], ...extra });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 });
        if ( r.targets.find(t => t.name === "Zombi")?.save?.success === false ) { await pause(1500); return { r, since: used.usageMessageId }; }
      }
      return null;
    };
    /** La dernière sauvegarde rejouée depuis `since`, autre que `last`. */
    const resaveSince = async (since, last) => {
      const m = (await ctx.messagesSince(since)).filter(x => (x.type === "usage") && x.flags?.[MODULE_ID]?.resave).at(-1);
      return (m && (m.id !== last)) ? m : null;
    };

    await part("Assassin imaginaire", async () => {
      const killer = await ctx.ensureItem(mage, `${SPELLS}.phbsplPhantasmal`);
      if ( !ctx.expect(await fight(mage, zombi), "combat : au tour du Magicien") ) return;
      const cast = await until(killer);
      if ( !ctx.expect(!!cast, "le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
      ctx.expect((await newEffects(zombi)).length > 0, `le Zombi porte l'effet (${(await newEffects(zombi)).map(e => e.name).join(", ")})`);
      let last = null;
      let failed = 0;
      let ended = false;
      for ( let turn = 0; (turn < 16) && !ended; turn++ ) {
        const before = await ctx.hp(zombi);
        await ctx.nextTurn();
        await pause(3000);
        const resave = await resaveSince(cast.since, last);
        if ( !resave ) continue;
        last = resave.id;
        const r = await ctx.settle(resave.id, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Zombi");
        if ( !t?.save ) continue;
        await pause(2000);
        const after = await ctx.hp(zombi);
        const still = (await newEffects(zombi)).length > 0;
        if ( t.save.success ) { ended = !still; ctx.expect(!still && (after === before), `fin de tour, sauvegarde réussie (${t.save.total}) : l'effet tombe, pas de dégâts (${before} → ${after} PV)`); }
        else {
          failed++;
          const dealt = (await ctx.messagesSince(resave.id)).some(m => m.flags?.[MODULE_ID]?.bearerDamage?.item === "phantasmal-killer");
          ctx.expect(still && dealt && (after < before), `fin de tour, sauvegarde ratée (${t.save.total}) : les dégâts de nouveau (${before} → ${after} PV), l'effet reste`);
        }
      }
      ctx.expect(failed + (ended ? 1 : 0) > 0, `au moins une sauvegarde rejouée (${failed} ratée(s)${ended ? ", puis réussie" : ""})`);
    });

    await part("Sphère de vitriol", async () => {
      const sphere = await ctx.ensureItem(mage, `${SPELLS}.phbsplVitriolicS`);
      if ( !ctx.expect(await fight(mage, zombi), "combat : au tour du Magicien") ) return;
      const cast = await until(sphere, { area: { shape: "rectangle", ...(await ctx.box(zombi)) } });
      if ( !ctx.expect(!!cast, "le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
      ctx.expect((await newEffects(zombi)).length > 0, `le Zombi porte l'acide persistant (${(await newEffects(zombi)).map(e => e.name).join(", ")})`);
      const before = await ctx.hp(zombi);
      await ctx.nextTurn();   // fin du tour du Magicien : rien
      await pause(2500);
      ctx.expect(((await ctx.hp(zombi)) === before) && ((await newEffects(zombi)).length > 0), "fin du tour du Magicien : ni dégâts ni fin de l'effet");
      await ctx.nextTurn();   // fin du tour du Zombi : 5d4 d'acide, l'effet tombe
      await pause(4000);
      const after = await ctx.hp(zombi);
      const dealt = (await ctx.messagesSince(cast.since)).some(m => m.flags?.[MODULE_ID]?.bearerDamage?.item === "vitriolic-sphere");
      ctx.expect(dealt && (after < before) && ((before - after) <= 20), `fin du tour du Zombi : 5d4 dégâts d'acide (${before} → ${after} PV)`);
      ctx.expect((await newEffects(zombi)).length === 0, "l'acide persistant est retiré");
    });

    await part("Hâte", async () => {
      const haste = await ctx.ensureItem(mage, `${SPELLS}.phbsplHaste00000`);
      if ( !ctx.expect(await fight(mage, clerc), "combat : au tour du Magicien") ) return;
      const used = await ctx.use({ tokenId: mage.id, itemId: haste, activityId: "dnd5eactivity000", targetTokenIds: [clerc.id] });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(1500);
      const hasted = await newEffects(clerc);
      if ( !ctx.expect(hasted.length === 1, `le Clerc porte la Hâte (${hasted.map(e => e.name).join(", ")})`) ) return;
      await endConcentration();
      await pause(2500);
      const lethargy = async () => (await newEffects(clerc)).filter(e => (e._id ?? e.id) !== (hasted[0]._id ?? hasted[0].id));
      const after = await newEffects(clerc);
      ctx.expect(!after.some(e => (e._id ?? e.id) === (hasted[0]._id ?? hasted[0].id)), "la concentration rompue, la Hâte cesse");
      ctx.expect((await lethargy()).length === 1, `la léthargie est posée (${(await lethargy()).map(e => e.name).join(", ")})`);
      const stats = await ctx.engine("stats", { tokenId: clerc.id });
      ctx.expect(stats?.statuses?.includes("incapacitated"), `le Clerc est Neutralisé (${(stats?.statuses ?? []).join(", ")})`);
      await ctx.nextTurn();   // fin du tour du Magicien, début de celui du Clerc
      await pause(2500);
      ctx.expect((await lethargy()).length === 1, "au début du tour du Clerc, la léthargie tient");
      await ctx.nextTurn();   // fin du tour du Clerc
      await pause(2500);
      ctx.expect((await lethargy()).length === 0, "à la fin du tour du Clerc, la léthargie tombe");
    });

    await part("Châtiment de fournaise", async () => {
      const actor0 = await ctx.call("get-actor", { actorId: pal.actorId });
      const slots0 = Object.fromEntries(Object.entries(actor0.system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
      const setSlots = slots => ctx.call("update-actor", { actorId: pal.actorId, actorData: Object.fromEntries(Object.entries(slots).map(([k, v]) => [`system.spells.${k}.value`, v])) });
      ctx.restore(() => setSlots(slots0).catch(() => {}));
      const divine = await ctx.itemId(pal.id, "divine-smite").catch(() => null);
      const spent0 = divine ? ((actor0.items ?? []).find(i => i._id === divine)?.system?.uses?.spent ?? 0) : 0;
      const setUses = spent => divine ? ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.uses.spent": spent }, match: { path: "_id", value: divine } }) : null;
      ctx.restore(() => setUses(spent0)?.catch?.(() => {}));
      // La fiche du Paladin de dnd-6 porte une copie plus ancienne du sort, sans son activité de dégâts (non proposée par le
      // moteur) : la version du compendium est prêtée à côté, par sa source.
      {
        const uuid = `${SPELLS}.phbsplSearingSmi`;
        const { data } = await ctx.call("get-compendium-entry", { uuid });
        const { _id, folder, ownership, _stats, ...itemData } = data;
        itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
        const r = await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
        if ( r.action === "created" ) ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: pal.actorId, itemId: r.id }).catch(() => {}));
      }
      const home = await ctx.position(zombi);
      const p = await ctx.position(pal);
      ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation ?? 0 }).catch(() => {}));
      await tough();
      await ctx.call("move-token", { tokenId: zombi.id, x: p.x + grid, y: p.y, elevation: 0 });
      await pause(800);
      await setUses(1);                                   // pas de Châtiment divin gratuit : une seule réponse possible
      await setSlots({ ...slots0, spell1: 1, spell2: 0, spell3: 0, spell4: 0, spell5: 0 });
      if ( !ctx.expect(await fight(pal, zombi), "combat : au tour du Paladin") ) return;
      const sword = await ctx.itemId(pal.id, "longsword");
      const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const seenDialogs = [];
      const answer = async (ids, ms=9000) => {
        for ( const stop = Date.now() + ms; Date.now() < stop; ) {
          const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
          for ( const d of r?.windows ?? [] ) {
            const b = (d.buttons ?? []).find(x => /fournaise|Searing/i.test(x.label ?? ""));
            if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {}); return true; }
            ids.push(d.id);
            seenDialogs.push(`${d.title ?? ""} [${(d.buttons ?? []).map(x => x.label).join(" / ")}]`);
          }
        }
        return false;
      };
      let hit = null;
      for ( let n = 0; (n < 10) && !hit; n++ ) {
        await setSlots({ ...slots0, spell1: 1, spell2: 0, spell3: 0, spell4: 0, spell5: 0 });
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: pal.id, itemId: sword, activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { [MODULE_ID]: {} } });
        const asked = await answer(ids);
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Zombi")?.hit === true ) hit = { since, asked };
      }
      if ( !ctx.expect(!!hit && hit.asked, `l'épée longue touche le Zombi, le Châtiment de fournaise choisi (10 essais au plus)${hit?.asked ? "" : ` — touché : ${!!hit} ; fenêtres vues : ${seenDialogs.join(" ; ") || "aucune"}`}`) ) { ctx.log((await ctx.engineLog()).slice(-14).join(" ¦ ").slice(0, 1800)); return; }
      await pause(2500);
      // La brûlure seule : l'épée longue pose aussi sa marque de botte (Sape).
      const burn = async () => (await newEffects(zombi)).filter(e => String(e._stats?.duplicateSource ?? "").endsWith(".ActiveEffect.A0tTvLeRetrC708K"));
      const seared = await burn();
      if ( !ctx.expect(seared.length === 1, `le Zombi porte la brûlure (${seared.map(e => e.name).join(", ")})`) ) return;
      let last = null;
      let ended = false;
      let burns = 0;
      for ( let turn = 0; (turn < 16) && !ended; turn++ ) {
        const before = await ctx.hp(zombi);
        const mark = await ctx.lastMessageId();
        await ctx.nextTurn();
        await pause(3500);
        const resave = await resaveSince(hit.since, last);
        if ( !resave ) continue;
        last = resave.id;
        const burned = (await ctx.messagesSince(mark)).some(m => m.flags?.[MODULE_ID]?.bearerDamage?.item === "searing-smite");
        const r = await ctx.settle(resave.id, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Zombi");
        if ( !t?.save ) continue;
        await pause(1500);
        const after = await ctx.hp(zombi);
        const still = (await burn()).length > 0;
        burns++;
        ctx.expect(burned && (after < before) && ((before - after) <= 6), `début du tour du Zombi : 1d6 dégâts de feu (${before} → ${after} PV)`);
        if ( t.save.success ) { ended = !still; ctx.expect(!still, `sauvegarde réussie (${t.save.total}) : la brûlure cesse`); }
        else ctx.expect(still, `sauvegarde ratée (${t.save.total}) : la brûlure continue`);
      }
      ctx.expect(burns > 0, `au moins un début de tour brûlant (${burns})`);
    });
  }
};
