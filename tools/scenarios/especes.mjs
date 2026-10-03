/**
 * Les espèces du Manuel des joueurs 2024 (SPEC §31), monde `dnd-6`. Le Guerrier reçoit, prêtés depuis le compendium du Manuel des
 * joueurs (pack `origins`), des traits d'espèce ; le Bandit reçoit 300 PV. Vérifie :
 *  - Acharnement (Orc) : tombé à 0 PV, le Guerrier reste à 1 PV, l'utilisation dépensée ; la fois suivante, il tombe ;
 *  - Brûlure ignée (Goliath) : la question au coup, « Brûlure ignée » → +1d10 feu, une utilisation dépensée ;
 *    Renversement des coteaux → le Bandit À terre ;
 *  - Endurance de la pierre (Goliath) : le Bandit touche → réaction, dégâts réduits du jet + Constitution ;
 *  - Tonnerre des cieux (Goliath) : le Bandit blesse le Guerrier → réaction, le Bandit subit des dégâts de tonnerre ;
 *  - Révélation céleste (Aasimar) : transformé, + bonus de maîtrise radiants au premier coup du tour ;
 *  - Poussée d'adrénaline (Orc) : Foncer par une action Bonus ;
 *  - Forme de géant (Goliath) : le token passe à la taille G (2 × 2 cases).
 * Remet positions, PV, états ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const ORIGINS = "dnd-players-handbook.origins";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "espèces — Acharnement, Ascendance gigante, Révélation céleste, Poussée d'adrénaline, Forme de géant",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(ORIGINS) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const hero = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [hero, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(hero.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const { data: hdata } = await ctx.call("get-scene-object", { type: "Token", objectId: hero.id });
    const size0 = { width: hdata.width ?? 1, height: hdata.height ?? 1 };
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: size0 }).catch(() => {}));
    const lend = async id => {
      const uuid = `Compendium.${ORIGINS}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: id }).catch(() => {});
    const spentOf = async id => ((await ctx.call("get-actor", { actorId: hero.actorId })).items ?? []).find(i => i._id === id)?.system?.uses?.spent ?? null;

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of ["prone", "unconscious", "dead"] ) { await ctx.removeStatusEffects(t, s); await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {}); }
        await ctx.removeEffectsNamed(t, /Ailes célestes|Radiance ardente|Linceul|Forme de géant|Gelé|Sape|Sap\b|Pointe|Dash/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: size0 }).catch(() => {});
      await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.death.failure": 0, "system.attributes.death.success": 0 } }).catch(() => {});
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
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
      await ctx.startCombat([hero, bandit]);
      const combat = await state();
      for ( const [t, v] of [[hero, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== hero.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === hero.id;
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
          seen.push({ id: d.id, text, answered: b?.label ?? null, buttons: (d.buttons ?? []).map(x => x.label) });
        }
        if ( seen.some(d => d.answered) ) break;
      }
      return seen;
    };
    const sword = await ctx.itemId(hero.id, "greatsword");
    /** Le Guerrier frappe jusqu'à toucher (10 essais), en répondant `button` à la question des faveurs ; rend le jet de dégâts. */
    const heroHits = async (button=null) => {
      for ( let n = 0; n < 10; n++ ) {
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: hero.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const asked = button ? await answerAll(ids, [[/toucher|On hit|gigante|Giant|Châtiment|Smite/i, button]], 7000) : [];
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) continue;
        await pause(1500);
        return { asked, damage: (await ctx.messagesSince(since)).find(m => m.type === "damage") };
      }
      return null;
    };
    /** Le Bandit frappe le Guerrier jusqu'à toucher (20 essais) ; rend la résolution et les messages. */
    const banditHits = async (usage={}) => {
      for ( let n = 0; n < 20; n++ ) {
        await ctx.setHp(hero, homes.get(hero.id).hp);
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [hero.id], usageConfig: { [MODULE_ID]: usage } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Guerrier");
        if ( t?.hit !== true ) continue;
        await pause(2500);
        return { r, t, msgs: await ctx.messagesSince(since) };
      }
      return null;
    };

    await part("Acharnement", async () => {
      const item = await lend("phbsptRelentless");
      await tough(); await place(bandit, g.x + grid, g.y);
      let first = null;
      for ( let n = 0; (n < 20) && !first; n++ ) {
        await ctx.setHp(hero, 1);
        const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [hero.id], usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Guerrier")?.hit !== true ) continue;
        await pause(2000);
        first = true;
        const hp = await ctx.hp(hero);
        const statuses = (await ctx.engine("stats", { tokenId: hero.id }))?.statuses ?? [];
        ctx.expect(hp === 1 && !statuses.includes("unconscious") && (await spentOf(item)) === 1, `à 1 PV, touché : ${hp} PV, états ${statuses.join(", ") || "aucun"}, utilisation ${await spentOf(item)}`);
      }
      if ( !ctx.expect(!!first, "le Bandit touche le Guerrier (20 essais au plus)") ) return;
      let second = null;
      for ( let n = 0; (n < 20) && !second; n++ ) {
        await ctx.setHp(hero, 1);
        const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [hero.id], usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Guerrier")?.hit !== true ) continue;
        await pause(2000);
        second = true;
        ctx.expect((await ctx.hp(hero)) === 0, `plus d'utilisation : le Guerrier tombe (${await ctx.hp(hero)} PV)`);
      }
      await unlend(item);
    });

    await part("Ascendance gigante", async () => {
      const burn = await lend("phbsptFiresBurn0");
      await tough(); await place(bandit, g.x + grid, g.y);
      const res = await heroHits(/Brûlure|Fire's Burn/i);
      if ( !ctx.expect(!!res, "l'épée touche le Bandit (10 essais au plus)") ) return;
      ctx.expect(res.asked.some(d => d.answered), `la question des faveurs (${res.asked.map(d => d.buttons.join(" / ")).join(" ; ")})`);
      const smite = res.damage?.flags?.[MODULE_ID]?.smite;
      ctx.expect(smite?.kind === "rider" && smite?.formula === "1d10" && smite?.type === "fire", `Brûlure ignée : ${JSON.stringify(smite)}`);
      ctx.expect((await spentOf(burn)) === 1, `une utilisation dépensée (${await spentOf(burn)})`);
      await unlend(burn);
      const tumble = await lend("phbsptHillsTumbl");
      const res2 = await heroHits(/Renversement|Hill's Tumble/i);
      if ( !ctx.expect(!!res2, "l'épée touche le Bandit (10 essais au plus)") ) return;
      await pause(1500);
      const prone = (await ctx.engine("stats", { tokenId: bandit.id }))?.statuses?.includes("prone");
      ctx.expect(prone === true, `Renversement des coteaux : le Bandit À terre (${prone})`);
      await unlend(tumble);
    });

    await part("Endurance de la pierre", async () => {
      const item = await lend("phbsptStonesEndu");
      await tough(); await place(bandit, g.x + grid, g.y);
      const con = (await ctx.engine("stats", { tokenId: hero.id }))?.mods?.con ?? 0;
      const res = await banditHits({ autoReact: "first" });
      if ( !ctx.expect(!!res, "le Bandit touche le Guerrier (20 essais au plus)") ) return;
      const dealt = (res.msgs.find(m => (m.type === "damage") && (m.alias === "Bandit"))?.rolls ?? []).reduce((s, x) => s + (x.total ?? 0), 0);
      const rolled = (res.msgs.find(m => (m.type === "healing") || ((m.type === "damage") && (m.alias !== "Bandit")))?.rolls ?? []).reduce((s, x) => s + (x.total ?? 0), 0);
      const lost = homes.get(hero.id).hp - (await ctx.hp(hero));
      ctx.expect(!!res.t.reaction && (lost === Math.max(0, dealt - (rolled + con))), `« ${res.t.reaction} » : ${dealt} dégâts, réduits de ${rolled} + ${con} → ${lost} PV perdus`);
      await unlend(item);
    });

    await part("Tonnerre des cieux", async () => {
      const item = await lend("phbsptStormsThun");
      await tough(); await place(bandit, g.x + grid, g.y);
      const b0 = await ctx.hp(bandit);
      const res = await banditHits({ autoReact: "first" });
      if ( !ctx.expect(!!res, "le Bandit touche le Guerrier (20 essais au plus)") ) return;
      await pause(2500);
      const msgs = await ctx.messagesSince(res.msgs[0]?.id ?? null).catch(() => res.msgs);
      const thunder = [...res.msgs, ...(msgs ?? [])].find(m => (m.type === "damage") && (m.alias !== "Bandit") && (m.rolls ?? []).some(x => x.options?.type === "thunder"));
      const lost = b0 - (await ctx.hp(bandit));
      ctx.expect(!!thunder && (lost > 0), `le Bandit subit le tonnerre : ${lost} PV (${(thunder?.rolls ?? []).map(x => `${x.formula} = ${x.total}`).join(", ")})`);
      await unlend(item);
    });

    await part("Révélation céleste", async () => {
      const item = await lend("phbsptCelestialR");
      await tough(); await place(bandit, g.x + grid, g.y);
      await ctx.use({ tokenId: hero.id, itemId: item, activityId: "LP871kJdn8h4YNYZ", usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await pause(2500);
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const res = await heroHits();
      const bonuses = (res?.damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
      ctx.expect(bonuses.includes("@prof radiant"), `transformé : ${bonuses.join(", ")} ; jets ${(res?.damage?.rolls ?? []).map(x => x.formula).join(" + ")}`);
      await unlend(item);
    });

    await part("Poussée d'adrénaline", async () => {
      const item = await lend("phbsptAdrenaline");
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      await ctx.use({ tokenId: hero.id, itemId: item, activityId: "jN5Zo6mDXll3c4Cz", consume: true, usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await pause(2500);
      const b = await ctx.engine("budget", { tokenId: hero.id });
      ctx.expect(b?.dashed === true && b?.bonus === 0 && b?.action === 1, `Foncer ${b?.dashed}, action Bonus ${b?.bonus}, action ${b?.action}`);
      await unlend(item);
    });

    await part("Forme de géant", async () => {
      const item = await lend("phbsptLargeForm0");
      await ctx.use({ tokenId: hero.id, itemId: item, activityId: "5jJ0wfYo2b4k26Em", usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await pause(3000);
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: hero.id });
      ctx.expect((data.width === 2) && (data.height === 2), `token du Guerrier : ${data.width} × ${data.height}`);
      await unlend(item);
    });
  }
};
