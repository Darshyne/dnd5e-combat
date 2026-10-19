/**
 * §207 : les options de coup critique (issue GitHub #5), désactivées par défaut — Paladin de `dnd-6` contre le Bandit (300 PV, CA 5 le
 * temps du test). Vérifie : avec un écart de 10, un coup qui dépasse la CA de 10 sans 20 naturel est critique (« dépasse la CA ») et ses
 * dégâts sont doublés ; en mode « table », la table est tirée dans le chat et les dégâts sont ceux d'un coup normal, le coup restant noté
 * critique ; en mode « au choix », la question est posée, « Standard » double les dés, « Table » tire la table.
 * Remet réglages, CA, PV, positions ; met à la corbeille la table de test.
 */
const MODULE_ID = "dnd5e-combat";
const SPELLS = "dnd-players-handbook.spells";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "critiques — écart à la CA, table de critiques, choix de l'attaquant",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Paladin", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(SPELLS) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const pal = await ctx.token("Paladin");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [pal, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(pal.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const ac0 = bdata.delta?.system?.attributes?.ac ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: ac0 === null ? { "delta.system.attributes.-=ac": null } : { "delta.system.attributes.ac": ac0 } }).catch(() => {}));
    // CA 5 : un coup de l'épée longue (+6) atteint souvent CA + 10.
    const softAc = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.ac": { calc: "flat", flat: 5 } } });
    const setting = async (key, value) => { const r = await ctx.engine("setting", { key, value }); ctx.restore(() => ctx.engine("setting", { key, value: r.before })); return r; };
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };

    const actor0 = await ctx.call("get-actor", { actorId: pal.actorId });
    const slots0 = Object.fromEntries(Object.entries(actor0.system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
    const setSlots = slots => ctx.call("update-actor", { actorId: pal.actorId, actorData: Object.fromEntries(Object.entries(slots).map(([k, v]) => [`system.spells.${k}.value`, v])) });
    const slots = async () => Object.fromEntries(Object.entries((await ctx.call("get-actor", { actorId: pal.actorId })).system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
    ctx.restore(() => setSlots(slots0).catch(() => {}));

    const divine = await ctx.itemId(pal.id, "divine-smite");
    const setUses = spent => ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.uses.spent": spent }, match: { path: "_id", value: divine } });
    const usesSpent = async () => ((await ctx.call("get-actor", { actorId: pal.actorId })).items ?? []).find(i => i._id === divine)?.system?.uses?.spent ?? null;
    const lend = async id => {
      const uuid = `Compendium.${SPELLS}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: pal.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeStatusEffects(t, "prone"); await ctx.call("set-status", { tokenId: id, statusId: "prone", active: false }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Vow|Vœu|Voeu|Inimitié|Enmity/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
      await setUses(0);
      await setSlots(slots0);
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async () => {
      await ctx.startCombat([pal, bandit]);
      const combat = await state();
      for ( const [t, v] of [[pal, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== pal.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === pal.id;
    };
    const budget = () => ctx.engine("budget", { tokenId: pal.id });
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
          seen.push({ id: d.id, text, answered: b?.label ?? null, buttons: (d.buttons ?? []).map(x => x.label) });
        }
        if ( seen.some(d => d.answered) ) break;
      }
      return seen;
    };
    const sword = await ctx.itemId(pal.id, "longsword");
    const attack = async (attacker, itemId, target, usage={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: usage } });
      return { since, usage: u.usageMessageId };
    };
    /** Frappe jusqu'à toucher (10 essais) en répondant `button` à la question du châtiment ; rend le jet de dégâts et ce qui a été vu. */
    const smiteHit = async button => {
      for ( let n = 0; n < 10; n++ ) {
        const ids = await known();
        const a = await attack(pal, sword, bandit, {});
        const asked = await answerAll(ids, [[/Châtiment|Smite/i, button]], 8000);
        const r = await ctx.settle(a.usage, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === bandit.name)?.hit !== true ) continue;
        await pause(1500);
        const damage = (await ctx.messagesSince(a.since)).find(m => m.type === "damage");
        return { a, asked, damage };
      }
      return null;
    };


    // Un coup qui dépasse la CA de 10 sans 20 naturel : 15 essais au plus, en répondant `button` si la question du critique vient.
    const marginHit = async button => {
      for ( let n = 0; n < 15; n++ ) {
        const ids = await known();
        const a = await attack(pal, sword, bandit, {});
        const asked = button ? await answerAll(ids, [[/critique|Critical/i, button]], 8000) : [];
        const r = await ctx.settle(a.usage, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === bandit.name);
        if ( !t?.critical || (t.reason !== "beatsAc") ) { await pause(800); continue; }
        await pause(2000);
        const since = await ctx.messagesSince(a.since);
        return { t, asked, damage: since.find(m => m.type === "damage"), table: since.find(m => m.flags?.[MODULE_ID]?.criticalTable === true) };
      }
      return null;
    };
    const doubled = damage => (damage?.rolls ?? []).some(r => r.options?.isCritical === true || r.isCritical === true);

    // Table de test, d'un seul résultat.
    const table = await ctx.call("create-table", { tableData: { name: "DAS test critiques", formula: "1d1", replacement: true,
      results: [{ type: "text", range: [1, 1], name: "Coup sanglant (test)", description: "Coup sanglant (test)" }] } });
    const tableId = table?.id ?? table?.tableId ?? table?.table?._id;
    ctx.restore(async () => { if ( tableId ) await ctx.call("trash-document", { documentType: "RollTable", documentId: tableId }).catch(() => {}); });

    await part("Écart à la CA", async () => {
      await setting("critMargin", 10); await setting("criticalMode", "standard");
      await tough(); await softAc(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await marginHit(null);
      if ( !ctx.expect(!!res, "un coup dépasse la CA de 10 sans 20 naturel (15 essais au plus)") ) return;
      ctx.expect(res.t.critical && res.t.reason === "beatsAc", `verdict : critique, « dépasse la CA » (${res.t.reason})`);
      ctx.expect(doubled(res.damage), `dégâts de critique (${(res.damage?.rolls ?? []).map(r => r.formula).join(" + ")})`);
    });

    await part("Table de critiques", async () => {
      await setting("critMargin", 10); await setting("criticalMode", "table"); await setting("criticalTable", "DAS test critiques");
      await tough(); await softAc(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await marginHit(null);
      if ( !ctx.expect(!!res, "un coup critique (15 essais au plus)") ) return;
      ctx.expect(!!res.table, "la table de critiques est tirée dans le chat");
      ctx.expect(!!res.damage && !doubled(res.damage), `dégâts d'un coup normal (${(res.damage?.rolls ?? []).map(r => r.formula).join(" + ")})`);
      ctx.expect(res.damage?.flags?.[MODULE_ID]?.criticalHit === "table", "le coup reste noté critique (jets de mort)");
    });

    await part("Au choix : standard", async () => {
      await setting("critMargin", 10); await setting("criticalMode", "choice"); await setting("criticalTable", "DAS test critiques");
      await tough(); await softAc(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await marginHit(/Standard/i);
      if ( !ctx.expect(!!res, "un coup critique (15 essais au plus)") ) return;
      const buttons = res.asked.flatMap(d => d.buttons ?? []);
      ctx.expect(buttons.some(b => /Table/i.test(b)) && buttons.some(b => /Standard/i.test(b)), `la question est posée (${buttons.join(" / ")})`);
      ctx.expect(doubled(res.damage) && !res.table, "standard : dés doublés, pas de table");
    });

    await part("Au choix : table", async () => {
      await setting("critMargin", 10); await setting("criticalMode", "choice"); await setting("criticalTable", "DAS test critiques");
      await tough(); await softAc(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await marginHit(/Table/i);
      if ( !ctx.expect(!!res, "un coup critique (15 essais au plus)") ) return;
      ctx.expect(!!res.table && !doubled(res.damage), "table : tirée, dégâts normaux");
    });
  }
};
