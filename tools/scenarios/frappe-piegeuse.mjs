/**
 * §206 : la Frappe piégeuse (Ensnaring Strike, PHB 2024) se propose comme un châtiment, après un coup d'arme au corps à corps comme à
 * distance (issue GitHub #10). Le Paladin de `dnd-6` reçoit le sort, prêté depuis le compendium du Manuel des joueurs ; le Bandit
 * reçoit 300 PV. Vérifie : la question après le coup d'épée, l'emplacement dépensé, le jet de Force (Entravé ⇔ raté) sans Avantage pour
 * une créature Moyenne ; avec l'Avantage quand le Bandit est Grand ; la proposition après un coup de javeline lancée.
 * Remet positions, PV, taille, emplacements, quantité de javelines, états ; retire l'item prêté.
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
  name: "frappe piégeuse — proposée après un coup d'arme, jet de Force, Avantage des créatures Grandes",

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
    const size0 = bdata.delta?.system?.traits?.size ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: size0 === null ? { "delta.system.traits.-=size": null } : { "delta.system.traits.size": size0 } }).catch(() => {}));
    const setSize = size => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.traits.size": size } });
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
    await lend("phbsplEnsnaringS");
    const javelin = await ctx.itemId(pal.id, "javelin");
    const jav0 = ((await ctx.call("get-actor", { actorId: pal.actorId })).items ?? []).find(i => i._id === javelin)?.system?.quantity ?? 0;
    if ( javelin ) ctx.restore(() => ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.quantity": jav0 }, match: { path: "_id", value: javelin } }).catch(() => {}));

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        // Entravé d'abord : une créature entravée ne se replace pas.
        await ctx.removeStatusEffects(t, "prone"); await ctx.call("set-status", { tokenId: id, statusId: "prone", active: false }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Vow|Vœu|Voeu|Inimitié|Enmity|Ensnar|Entrav|piég|Sap|Slow|Sape|Ralenti/i);
        await ctx.call("set-status", { tokenId: id, statusId: "restrained", active: false }).catch(() => {});
        // L'effet de la Frappe piégeuse peut survivre un instant (il part avec la concentration) : on réessaie jusqu'au retour.
        for ( let k = 0; k < 4; k++ ) {
          const r = await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => null);
          if ( (r?.after?.x === h.pos.x) && (r?.after?.y === h.pos.y) ) break;
          await ctx.removeEffectsNamed(t, /Ensnar|Entrav|piég/i);
          await ctx.call("set-status", { tokenId: id, statusId: "restrained", active: false }).catch(() => {});
          await pause(800);
        }
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
    const smiteHit = async (button, { item=sword, usage={} }={}) => {
      for ( let n = 0; n < 10; n++ ) {
        const ids = await known();
        const a = await attack(pal, item, bandit, usage);
        const asked = await answerAll(ids, [[/Châtiment|Smite/i, button]], 8000);
        const r = await ctx.settle(a.usage, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === bandit.name)?.hit !== true ) continue;
        await pause(1500);
        const damage = (await ctx.messagesSince(a.since)).find(m => m.type === "damage");
        return { a, asked, damage };
      }
      return null;
    };


    /** Le jet de Force de la Frappe piégeuse : la carte de sauvegarde du moteur, sa résolution, l'état Entravé. */
    const saveOf = async res => {
      let save = null;
      for ( const stop = Date.now() + 15000; !save && (Date.now() < stop); await pause(500) ) {
        save = (await ctx.messagesSince(res.a.since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "cunningStrike");
      }
      const r = save ? await ctx.settle(save.id, { timeoutMs: 30000 }).catch(() => null) : null;
      await pause(1500);
      const t = r?.targets?.[0];
      const rolled = t?.save?.messageId ? (await ctx.messagesSince(res.a.since)).find(m => m.id === t.save.messageId) : null;
      const restrained = (await ctx.engine("stats", { tokenId: bandit.id }))?.statuses?.includes("restrained");
      return { t: r?.targets?.[0], restrained, formula: rolled?.rolls?.[0]?.formula ?? null };
    };

    await part("Frappe piégeuse au corps à corps", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      await setSlots({ ...slots0, spell1: 1 });
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await smiteHit(/piégeuse|Ensnaring/i);
      if ( !ctx.expect(!!res, "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const asked = res.asked.flatMap(d => d.buttons ?? []);
      ctx.expect(asked.some(b => /piégeuse|Ensnaring/i.test(b)), `la Frappe piégeuse est proposée après le coup (${asked.join(" / ")})`);
      ctx.expect((await slots()).spell1 === 0, `emplacement de niveau 1 dépensé (${(await slots()).spell1})`);
      const { t, restrained, formula } = await saveOf(res);
      ctx.expect(!!t?.save && (restrained === !t.save.success), `Force ${t?.save?.total} (${t?.save?.success ? "réussie" : "ratée"}), Entravé ${restrained}`);
      ctx.expect(!/adv|kh/.test(formula ?? ""), `Bandit de taille Moyenne : pas d'Avantage (${formula})`);
    });

    await part("Frappe piégeuse contre une créature Grande", async () => {
      await tough(); await setSize("lg"); await place(bandit, g.x + grid, g.y);
      await setSlots({ ...slots0, spell1: 1 });
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await smiteHit(/piégeuse|Ensnaring/i);
      if ( !ctx.expect(!!res, "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const { t, formula } = await saveOf(res);
      ctx.expect(!!t?.save && /adv|kh/.test(formula ?? ""), `Bandit Grand : jet de Force avec l'Avantage (${formula})`);
    });

    await part("Frappe piégeuse à distance", async () => {
      if ( !javelin ) { ctx.log("pas de javeline : partie sautée"); return; }
      await tough(); await place(bandit, g.x + 4 * grid, g.y);
      await setSlots({ ...slots0, spell1: 1 });
      await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.quantity": 3 }, match: { path: "_id", value: javelin } });
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await smiteHit(/piégeuse|Ensnaring/i, { item: javelin, usage: { attackMode: "thrown" } });
      if ( !ctx.expect(!!res, "la javeline touche le Bandit (10 essais au plus)") ) return;
      const asked = res.asked.flatMap(d => d.buttons ?? []);
      ctx.expect(asked.some(b => /piégeuse|Ensnaring/i.test(b)), `proposée après un coup à distance (${asked.join(" / ")})`);
    });
  }
};
