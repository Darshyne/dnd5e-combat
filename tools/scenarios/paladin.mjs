/**
 * Le Paladin et les sorts de châtiment (SPEC §25), monde `dnd-6`. Le Paladin (niveau 8, Châtiment divin et Vœu d'inimitié sur sa
 * fiche) reçoit, prêté depuis le compendium du Manuel des joueurs, le Châtiment de tonnerre ; le Bandit reçoit 300 PV. Vérifie :
 *  - Châtiment divin gratuit : la question au coup d'épée longue, +2d8 radiants au jet de dégâts, l'utilisation dépensée, l'action
 *    Bonus dépensée ;
 *  - Châtiment de tonnerre par un emplacement de niveau 2 : +3d6 tonnerre, l'emplacement dépensé, la sauvegarde de Force jouée sur
 *    le Bandit (À terre ⇔ ratée) ;
 *  - « Pas de châtiment » : rien d'ajouté, rien de dépensé ;
 *  - Vœu d'inimitié : l'attaque suivante contre la créature marquée a l'Avantage.
 * Remet positions, PV, emplacements, utilisations, états ; retire l'item prêté.
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
  name: "paladin — Châtiment divin, Châtiment de tonnerre (sauvegarde), refus, Vœu d'inimitié",

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
    await lend("phbsplThunderous");

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

    await part("Châtiment divin gratuit", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      await setSlots({ ...slots0, spell1: 0, spell2: 0 });
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await smiteHit(/divin|Divine/i);
      if ( !ctx.expect(!!res, "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const smite = res.damage?.flags?.[MODULE_ID]?.smite;
      const formulas = (res.damage?.rolls ?? []).map(r => r.formula).join(" + ");
      ctx.expect(smite?.formula === "2d8" && smite?.type === "radiant", `jet de dégâts : ${formulas} ; châtiment ${smite?.formula} ${smite?.type}`);
      ctx.expect((await usesSpent()) === 1, `utilisation gratuite dépensée (${await usesSpent()})`);
      ctx.expect((await budget())?.bonus === 0, `action Bonus dépensée (${(await budget())?.bonus})`);
    });

    await part("Châtiment de tonnerre (niveau 2)", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      await setUses(1);
      await setSlots({ ...slots0, spell1: 0, spell2: 1 });
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await smiteHit(/tonnerre \(niveau 2\)|Thunderous Smite \(level 2\)/i);
      if ( !ctx.expect(!!res, "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const smite = res.damage?.flags?.[MODULE_ID]?.smite;
      ctx.expect(smite?.formula === "3d6" && smite?.type === "thunder" && smite?.level === 2, `châtiment ${smite?.formula} ${smite?.type} au niveau ${smite?.level}`);
      ctx.expect((await slots()).spell2 === 0, `emplacement de niveau 2 dépensé (${(await slots()).spell2})`);
      let save = null;
      for ( const stop = Date.now() + 15000; !save && (Date.now() < stop); await pause(500) ) {
        save = (await ctx.messagesSince(res.a.since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "cunningStrike");
      }
      const r = save ? await ctx.settle(save.id, { timeoutMs: 30000 }).catch(() => null) : null;
      const t = r?.targets?.[0];
      await pause(1500);
      const prone = (await ctx.engine("stats", { tokenId: bandit.id }))?.statuses?.includes("prone");
      ctx.expect(!!t?.save && (prone === !t.save.success), `Force ${t?.save?.total} (${t?.save?.success ? "réussie" : "ratée"}), À terre ${prone}`);
    });

    await part("Pas de châtiment", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      await setSlots({ ...slots0, spell1: 1 });
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const res = await smiteHit(/Pas de châtiment|No smite/i);
      if ( !ctx.expect(!!res, "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      ctx.expect(res.asked.some(d => d.answered), `la question posée (${res.asked.map(d => d.buttons.join(" / ")).join(" ; ")})`);
      ctx.expect(!res.damage?.flags?.[MODULE_ID]?.smite && (await usesSpent()) === 0 && (await slots()).spell1 === 1 && (await budget())?.bonus === 1,
        `rien d'ajouté ni dépensé (utilisation ${await usesSpent()}, niveau 1 : ${(await slots()).spell1}, action Bonus ${(await budget())?.bonus})`);
    });

    await part("Vœu d'inimitié", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      await setUses(1);
      await setSlots({ ...slots0, spell1: 0, spell2: 0 });
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      const attackFormula = async () => {
        const a = await attack(pal, sword, bandit, {});
        await ctx.settle(a.usage, { timeoutMs: 45000 }).catch(() => null);
        return (await ctx.messagesSince(a.since)).find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "";
      };
      const before = await attackFormula();
      ctx.expect(!/adv|kh/.test(before), `avant le vœu : ${before}`);
      await remettre(); await tough(); await place(bandit, g.x + grid, g.y);
      const vow = await ctx.itemId(pal.id, "vow-of-enmity");
      const u = await ctx.use({ tokenId: pal.id, itemId: vow, targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
      await pause(2000);
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
      const marked = (data.delta?.effects ?? []).map(e => e.name).filter(n => /Vow|Vœu|Inimitié|Enmity/i.test(n));
      ctx.expect(marked.length > 0, `le Bandit porte le vœu (${marked.join(", ")})`);
      const after = await attackFormula();
      ctx.expect(/adv|kh/.test(after), `attaque contre le Bandit marqué : ${after}`);
    });
  }
};
