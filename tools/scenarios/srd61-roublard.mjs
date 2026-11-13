/**
 * §434 : Frappe rusée (Poison) et Frappes sournoises (Assommer) du SRD de dnd5e 6.1 jouées en jeu (§433, point 3). Leurs activités ne
 * posent plus un effet de l'item mais l'effet commun du compendium `dnd5e.effects` (Empoisonné `wAnw5y4atBxNJHUP`, Inconscient
 * `HjLkxDzLNBogspf9`). Arène de test : le Roublard passe niveau 5, puis 14, et reçoit, prêtés depuis `dnd5e.classes24` et
 * `dnd5e.equipment24` (SRD 6.1, pas le Manuel), Frappe rusée, Frappes sournoises et une trousse d'empoisonneur. Le Guerrier se tient
 * à côté du Bandit (Attaque sournoise), le Bandit reçoit 300 PV ; son bonus de sauvegarde de Constitution est réglé pour décider de
 * chaque jet (−30 : raté ; +30 : réussi). En combat (Roublard, Bandit, Guerrier) :
 *  - Poison : le Bandit est Empoisonné ; à la fin de son tour, la sauvegarde est rejouée (message `resave`) — ratée, il le reste ;
 *    réussie au tour suivant, l'effet tombe ;
 *  - Assommer : le Bandit est Inconscient ; à la fin de son tour, la sauvegarde est rejouée — ratée, il le reste ; des dégâts, et
 *    l'effet tombe ; un second Assommer, la sauvegarde de fin de tour réussie : l'effet tombe.
 * Remet positions, PV, états, niveau, bonus ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e";
const STRIKE_TITLE = /Frappe malicieuse|Cunning Strike/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "srd61-roublard — Frappe rusée (Poison) et Frappes sournoises (Assommer) du SRD 6.1 : effet commun, sauvegarde rejouée, fin sur dégâts",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Roublard", "Bandit", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const rogue = await ctx.token("Roublard");
    const bandit = await ctx.token("Bandit");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [rogue, bandit, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const r0 = homes.get(rogue.id).pos;

    // Les alliés rangés sous le Roublard (voir `roublard`) écartés le temps du scénario.
    for ( const name of ["Moine", "Druide", "Rôdeur", "Barde"] ) {
      const t = (await ctx.scene()).tokens.find(x => x.name === name);
      if ( !t ) continue;
      const pos = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y, elevation: pos.elevation ?? 0 }).catch(() => {}));
      await ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y + 2 * grid, elevation: pos.elevation ?? 0 });
    }

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    const conSave0 = bdata.delta?.system?.abilities?.con?.save?.roll?.bonus ?? "";
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: { ...(max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 }),
        "delta.system.abilities.con.save.roll.bonus": conSave0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    /** Le bonus de sauvegarde de Constitution du Bandit : « -30 » le fait rater, « 30 » réussir. */
    const conSave = async bonus => { await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.abilities.con.save.roll.bonus": bonus } }); await pause(500); };
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(600); };

    const statuses = ["prone", "poisoned", "unconscious", "dead", "blinded"];
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of statuses ) {
          await ctx.removeStatusEffects(t, s);
          await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {});
        }
        await ctx.removeEffectsNamed(t, /Poisoned|Empoisonn|Unconscious|Inconscient|Frappe malicieuse|Cunning Strike|Ouverture|Vex/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);

    const actor = await ctx.call("get-actor", { actorId: rogue.actorId });
    const cls = (actor.items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "rogue"));
    if ( !ctx.expect(!!cls, "le Roublard a sa classe de roublard") ) return;
    const setLevel = n => ctx.call("upsert-actor-item", { actorId: rogue.actorId, itemData: { "system.levels": n }, match: { path: "_id", value: cls._id } });
    ctx.restore(() => setLevel(cls.system.levels).catch(() => {}));
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: rogue.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: rogue.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    await lend(`${SRD}.classes24.Item.phbrgeCunningStr`);
    await lend(`${SRD}.equipment24.Item.phbtulPoisonersK`);
    const sword = await ctx.itemId(rogue.id, "shortsword");

    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const strikeDialog = async (ids, waitMs=8000) => {
      for ( const until = Date.now() + waitMs; Date.now() < until; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 2000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => STRIKE_TITLE.test(w.title ?? ""));
        if ( d ) return d;
      }
      return null;
    };
    /** Une attaque du Roublard, la frappe choisie dans la question ; rend si elle touche, la question et le message d'avant. */
    const attack = async strikes => {
      const since = await ctx.lastMessageId();
      const ids = await known();
      const u = await ctx.use({ tokenId: rogue.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
      let res = null;
      for ( const until = Date.now() + 20000; Date.now() < until; ) {
        res = await ctx.resolution(u.usageMessageId);
        const t = res?.targets?.find(x => x.name === bandit.name);
        if ( (t && (t.hit !== null) && (t.hit !== undefined)) || ["done", "missed", "undone"].includes(res?.step) ) break;
        await pause(400);
      }
      const hit = res?.targets?.find(x => x.name === bandit.name)?.hit === true;
      let dialog = null;
      if ( hit ) {
        dialog = await strikeDialog(ids);
        if ( dialog ) await ctx.call("answer-dialog", { id: dialog.id, fields: Object.fromEntries(strikes.map(k => [k, true])), button: "strike" });
      }
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      return { hit, dialog, since };
    };
    const hitUntil = async strikes => {
      for ( let n = 0; n < 20; n++ ) { const a = await attack(strikes); if ( a.hit ) return a; }
      return null;
    };
    /** La sauvegarde de la frappe, jouée par le moteur après les dégâts : sa carte et son résultat. */
    const strikeSave = async since => {
      let card = null;
      for ( const until = Date.now() + 15000; !card && (Date.now() < until); await pause(500) ) {
        card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "cunningStrike");
      }
      if ( !card ) return null;
      const r = await ctx.settle(card.id, { timeoutMs: 30000 });
      await pause(1500);
      return r;
    };
    const has = async status => ((await ctx.engine("stats", { tokenId: bandit.id }).catch(() => null))?.statuses ?? []).includes(status);
    /** L'effet du Bandit qui porte cet état : son origine et son effet source, pour le journal. */
    const describe = async status => {
      const e = (await ctx.effects(bandit)).find(x => (x.statuses ?? []).includes(status));
      return e ? `« ${e.name} » (origine ${e.origin ?? e.system?.origin?.item ?? "?"}, source ${e._stats?.compendiumSource ?? e._stats?.duplicateSource ?? "?"})` : "aucun effet";
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async () => {
      const order = [[rogue, 20], [bandit, 10], [fighter, 5]];
      await ctx.startCombat(order.map(([t]) => t));
      const c = await state();
      for ( const [t, v] of order ) await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 4) && ((await current()) !== rogue.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }).catch(() => ctx.nextTurn()); await pause(1500); }
      return (await current()) === rogue.id;
    };
    /** Avance jusqu'à la fin du prochain tour du Bandit ; rend la carte `resave` qui a suivi et son résultat. */
    const endOfBanditTurn = async () => {
      for ( let i = 0; (i < 4) && ((await current()) !== bandit.id); i++ ) { await ctx.nextTurn(); await pause(1500); }
      const since = await ctx.lastMessageId();
      await ctx.nextTurn();
      let card = null;
      for ( const until = Date.now() + 15000; !card && (Date.now() < until); await pause(500) ) {
        card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.resave);
      }
      const r = card ? await ctx.settle(card.id, { timeoutMs: 30000 }).catch(() => null) : null;
      await pause(2000);
      return { card, success: r?.targets?.find(t => t.name === bandit.name)?.save?.success ?? null };
    };
    const setup = async level => {
      await setLevel(level);
      await tough();
      await place(bandit, r0.x - grid, r0.y);
      await place(fighter, r0.x - 2 * grid, r0.y);
      await conSave("-30");
    };

    await part("Frappe rusée : Poison", async () => {
      await setup(5);
      if ( !ctx.expect(await fight(), "combat : au tour du Roublard") ) return;
      const a = await hitUntil(["poison"]);
      if ( !ctx.expect(!!a?.dialog, `l'épée courte touche et la question de Frappe rusée s'ouvre (${a?.dialog?.title ?? "aucune"})`) ) return;
      const save = await strikeSave(a.since);
      if ( !ctx.expect(!!save, "Poison : la sauvegarde de Constitution du Bandit est jouée") ) return;
      ctx.expect(save.plan?.save?.ability === "con", `sauvegarde de Constitution DD ${save.plan?.save?.dc} (${save.targets?.[0]?.save?.total}, ratée attendue)`);
      if ( !ctx.expect(await has("poisoned"), `le Bandit est Empoisonné : ${await describe("poisoned")}`) ) return;
      const first = await endOfBanditTurn();
      ctx.expect(!!first.card, "fin du tour du Bandit : la sauvegarde est rejouée (message « resave »)");
      ctx.expect((first.success === false) && (await has("poisoned")), `ratée (${first.success}) : toujours Empoisonné (${await has("poisoned")})`);
      await conSave("30");
      const second = await endOfBanditTurn();
      ctx.expect(!!second.card, "fin du tour suivant du Bandit : la sauvegarde est rejouée");
      ctx.expect((second.success === true) && !(await has("poisoned")), `réussie (${second.success}) : l'Empoisonnement tombe (${await has("poisoned") ? "toujours là" : "tombé"})`);
    });

    await lend(`${SRD}.classes24.Item.phbrgeDeviousStr`);
    await part("Frappes sournoises : Assommer, fin sur dégâts", async () => {
      await setup(14);
      if ( !ctx.expect(await fight(), "combat : au tour du Roublard") ) return;
      const a = await hitUntil(["knockOut"]);
      if ( !ctx.expect(!!a?.dialog, `l'épée courte touche et la question s'ouvre (${a?.dialog?.title ?? "aucune"})`) ) return;
      const save = await strikeSave(a.since);
      if ( !ctx.expect(!!save, "Assommer : la sauvegarde de Constitution du Bandit est jouée") ) return;
      if ( !ctx.expect(await has("unconscious"), `le Bandit est Inconscient : ${await describe("unconscious")}`) ) return;
      const first = await endOfBanditTurn();
      ctx.expect(!!first.card, "fin du tour du Bandit : la sauvegarde est rejouée (message « resave »)");
      ctx.expect((first.success === false) && (await has("unconscious")), `ratée (${first.success}) : toujours Inconscient`);
      await ctx.engine("hurt", { tokenId: bandit.id, amount: 3 });
      let awake = false;
      for ( let n = 0; (n < 16) && !awake; n++ ) { awake = !(await has("unconscious")); if ( !awake ) await pause(500); }
      ctx.expect(awake, "3 dégâts subis : l'état Inconscient tombe aussitôt");
    });

    await part("Frappes sournoises : Assommer, sauvegarde réussie", async () => {
      await setup(14);
      if ( !ctx.expect(await fight(), "combat : au tour du Roublard") ) return;
      const a = await hitUntil(["knockOut"]);
      if ( !ctx.expect(!!a?.dialog, "l'épée courte touche et la question s'ouvre") ) return;
      await strikeSave(a.since);
      if ( !ctx.expect(await has("unconscious"), "le Bandit est Inconscient") ) return;
      await conSave("30");
      const r = await endOfBanditTurn();
      ctx.expect(!!r.card && (r.success === true) && !(await has("unconscious")), `fin du tour du Bandit : sauvegarde réussie (${r.success}), l'état Inconscient tombe (${await has("unconscious") ? "toujours là" : "tombé"})`);
    });
  }
};
