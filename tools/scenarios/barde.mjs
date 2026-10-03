/**
 * Le Barde du Manuel des joueurs 2024 (SPEC §33), monde `dnd-6`. Le Barde inspire le Guerrier ; il reçoit, prêté depuis le
 * compendium du Manuel des joueurs, Mots cinglants. Le Bandit reçoit 300 PV. Vérifie :
 *  - Inspiration bardique, attaque : un coup raté du Guerrier → la question, le dé ajouté au total, le verdict rejugé (touché ⇔
 *    total ≥ CA), l'inspiration retirée ;
 *  - Inspiration bardique, sauvegarde : Murmures dissonants du Barde sur le Guerrier inspiré — sauvegarde ratée → la question, le dé
 *    ajouté (réussite ⇔ total ≥ DD) ;
 *  - Mots cinglants : le Bandit touche le Guerrier → le Barde réagit, son dé vaut autant de CA, le coup est rejugé.
 * Remet positions, PV, utilisations, états ; retire l'item prêté.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "barde — Inspiration bardique (attaque, sauvegarde), Mots cinglants",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Barde", "Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const bard = await ctx.token("Barde");
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [bard, fighter, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    // Restored Keep, colonne x = 3080, loin de tout hostile : le Barde en 4900, le Guerrier en 5040, le Bandit en 5180.
    const spot = { bard: { x: 3080, y: 4900 }, fighter: { x: 3080, y: 5040 }, bandit: { x: 3080, y: 5180 } };

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, p) => { await ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: 0 }); await pause(700); };
    const lend = async id => {
      const uuid = `Compendium.${CLASSES}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: bard.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: bard.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const inspiration = await ctx.itemId(bard.id, "bardic-inspiration");
    const refill = () => ctx.call("upsert-actor-item", { actorId: bard.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: inspiration } });
    const inspired = async () => {
      const actor = await ctx.call("get-actor", { actorId: fighter.actorId });
      return (actor.effects ?? []).some(e => /Inspiré|Inspired/i.test(e.name));
    };

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Inspiré|Inspired|Sape|Sap\b|Écorch/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
      await refill();
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const answerAll = async (ids, answers, ms=9000) => {
      const seen = [];
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...ids, ...seen.map(d => d.id)], waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
          const rule = answers.find(([re]) => re.test(text));
          const b = rule ? (d.buttons ?? []).find(x => rule[1].test(x.label ?? "")) : null;
          if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
          seen.push({ id: d.id, text, answered: b?.label ?? null });
        }
        if ( seen.some(d => d.answered) ) break;
      }
      return seen;
    };
    const inspire = async () => {
      const u = await ctx.use({ tokenId: bard.id, itemId: inspiration, activityId: "dnd5eactivity000", targetTokenIds: [fighter.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
      await pause(2000);
      return inspired();
    };

    await part("Inspiration, attaque", async () => {
      await tough();
      await place(bard, spot.bard); await place(fighter, spot.fighter); await place(bandit, spot.bandit);
      if ( !ctx.expect(await inspire(), "le Guerrier porte l'inspiration") ) return;
      const sword = await ctx.itemId(fighter.id, "greatsword");
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const asked = await answerAll(ids, [[/Inspiration/i, /Lancer|Roll/i]], 6000);
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !asked.some(d => d.answered) ) continue;   // touché d'emblée : pas de question
        await pause(1500);
        const raw = (await ctx.messagesSince(since)).find(m => m.type === "attack")?.rolls?.[0]?.total;
        const t = r?.targets?.find(x => x.name === "Bandit");
        const total = r?.attack?.roll?.total;
        ctx.expect(Number.isFinite(raw) && (total > raw) && (t?.hit === (total >= t?.ac)), `raté à ${raw} : + dé → ${total} contre CA ${t?.ac}, ${t?.hit ? "touché" : "raté"}`);
        ctx.expect(!(await inspired()), "l'inspiration est retirée");
        checked = true;
      }
      ctx.expect(checked, "un coup raté du Guerrier (20 essais au plus)");
    });

    // Sans réponse (le joueur absent) : la question se ferme au bout du délai sur sa première option, « La garder » — l'inspiration
    // reste, le jet ne bouge pas (choix de l'utilisateur, 2026-09-29).
    await part("Inspiration, sans réponse", async () => {
      await tough();
      await place(bard, spot.bard); await place(fighter, spot.fighter); await place(bandit, spot.bandit);
      if ( !(await inspired()) && !ctx.expect(await inspire(), "le Guerrier porte l'inspiration") ) return;
      const sword = await ctx.itemId(fighter.id, "greatsword");
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const asked = await answerAll(ids, [], 6000);   // on la voit, on ne répond pas
        const question = asked.find(d => /Inspiration/i.test(d.text));
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 60000 }).catch(() => null);
        if ( !question ) continue;   // touché d'emblée : pas de question
        await pause(1500);
        const raw = (await ctx.messagesSince(since)).find(m => m.type === "attack")?.rolls?.[0]?.total;
        ctx.expect(r?.attack?.roll?.total === raw, `sans réponse : le jet reste ${r?.attack?.roll?.total} (jet ${raw})`);
        ctx.expect(await inspired(), "l'inspiration est gardée");
        checked = true;
      }
      ctx.expect(checked, "une question d'Inspiration laissée sans réponse (20 essais au plus)");
    });

    await part("Inspiration, sauvegarde", async () => {
      await place(bard, spot.bard); await place(fighter, spot.fighter);
      const whispers = await ctx.itemId(bard.id, "dissonant-whispers");
      let checked = false;
      for ( let n = 0; (n < 15) && !checked; n++ ) {
        if ( !(await inspired()) ) await inspire();
        await refill();
        await ctx.setHp(fighter, homes.get(fighter.id).hp);
        const ids = await known();
        const u = await ctx.use({ tokenId: bard.id, itemId: whispers, activityType: "save", targetTokenIds: [fighter.id], usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const asked = await answerAll(ids, [[/Inspiration/i, /Lancer|Roll/i]], 8000);
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !asked.some(d => d.answered) ) continue;   // réussie d'emblée
        const t = r?.targets?.find(x => x.name === "Guerrier");
        const dc = r?.plan?.save?.dc;
        ctx.expect(!!t?.save && (t.save.success === (t.save.total >= dc)), `sauvegarde ratée, + dé → ${t?.save?.total} contre DD ${dc} : ${t?.save?.success ? "réussie" : "ratée"}`);
        checked = true;
      }
      ctx.expect(checked, "une sauvegarde ratée du Guerrier inspiré (15 essais au plus)");
    });

    await part("Mots cinglants", async () => {
      await lend("phbbrdCuttingWor");
      await tough();
      await place(bard, spot.bard); await place(fighter, spot.fighter); await place(bandit, spot.bandit);
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        await refill();
        await ctx.setHp(fighter, homes.get(fighter.id).hp);
        const ac0 = (await ctx.engine("stats", { tokenId: fighter.id }))?.ac;
        const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [fighter.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Guerrier");
        if ( !t?.reaction ) continue;
        const total = r?.attack?.roll?.total;
        ctx.expect((t.ac > ac0) && (t.hit === (total >= t.ac)), `« ${t.reaction} » : CA ${ac0} → ${t.ac}, jet ${total} → ${t.hit ? "touché" : "raté"}`);
        checked = true;
      }
      ctx.expect(checked, "le Bandit touche le Guerrier et le Barde réagit (20 essais au plus)");
    });
  }
};
