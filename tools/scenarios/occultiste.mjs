/**
 * L'Occultiste du Manuel des joueurs 2024 (SPEC §29), monde `dnd-6`. L'Occultiste (niveau 1) reçoit, prêtés depuis le compendium du
 * Manuel des joueurs, Décharge répulsive, Pacte de la lame, Buveuse de vie, Âme radieuse et Défenses envoûtantes ; les
 * enchantements (Décharge répulsive sur la Décharge occulte, arme de pacte sur la dague) sont posés par `api.mcp.enchant`. Le
 * Bandit reçoit 300 PV. Vérifie :
 *  - Décharge répulsive : un rayon qui touche repousse le Bandit de 10 ft (deux cases) ;
 *  - Buveuse de vie : +1d6 nécrotiques au premier coup de l'arme de pacte du tour, pas au second ;
 *  - Âme radieuse : Flamme sacrée + le modificateur de Charisme ;
 *  - Défenses envoûtantes : le Bandit touche l'Occultiste → la réaction divise les dégâts et le Bandit fait sa sauvegarde.
 * Remet positions, PV, états ; retire les items prêtés et les enchantements.
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
  name: "occultiste — Décharge répulsive, Buveuse de vie, Âme radieuse, Défenses envoûtantes",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Occultiste", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const warlock = await ctx.token("Occultiste");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [warlock, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(warlock.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const lend = async id => {
      const uuid = `Compendium.${CLASSES}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: warlock.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: warlock.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const enchant = async (itemId, activityId, targetItemId) => {
      const { effectId } = await ctx.engine("enchant", { tokenId: warlock.id, itemId, activityId, targetItemId });
      if ( effectId ) ctx.restore(() => ctx.call("remove-embedded-effect", { uuid: `Actor.${warlock.actorId}.Item.${targetItemId}`, effectId }).catch(() => {}));
      return effectId;
    };

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Charm|Envoût/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
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
      await ctx.startCombat([warlock, bandit]);
      const combat = await state();
      for ( const [t, v] of [[warlock, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== warlock.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === warlock.id;
    };
    const blast = await ctx.itemId(warlock.id, "eldritch-blast");
    const dagger = await ctx.itemId(warlock.id, "dagger");

    await part("Décharge répulsive", async () => {
      const repel = await lend("phbinvRepellingB");
      if ( !ctx.expect(!!(await enchant(repel, "OXhI1TDQxORrGAgc", blast)), "la Décharge occulte porte l'enchantement « Répulsive »") ) return;
      await tough();
      // Restored Keep, colonne x = 3080 : de y = 5040 à 5460, quatre cases libres de murs (relevé du scénario `poussee`, sous la
      // case d'origine du Magicien, 3080 × 4760). L'Occultiste en 4900, le Bandit en 5040, repoussé jusqu'en 5320.
      await place(warlock, 3080, 4900);
      const pos0 = { x: 3080, y: 5040 };
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        await place(bandit, pos0.x, pos0.y);
        const u = await ctx.use({ tokenId: warlock.id, itemId: blast, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) continue;
        await pause(2000);
        const pos = await ctx.position(bandit);
        const moved = Math.round(Math.hypot(pos.x - pos0.x, pos.y - pos0.y) / grid);
        ctx.expect(moved === 2, `touché : le Bandit recule de ${moved} case(s) (attendu 2 = 10 ft)`);
        checked = true;
      }
      ctx.expect(checked, "un rayon touche le Bandit (20 essais au plus)");
    });

    await part("Buveuse de vie", async () => {
      const pact = await lend("phbinvPactBlade0");
      await lend("phbinvLifedrinke");
      if ( !ctx.expect(!!(await enchant(pact, "8MSXmrGSgc6xHotB", dagger)), "la dague est l'arme de pacte") ) return;
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour de l'Occultiste") ) return;
      const hit = async () => {
        for ( let n = 0; n < 10; n++ ) {
          const since = await ctx.lastMessageId();
          const u = await ctx.use({ tokenId: warlock.id, itemId: dagger, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
          const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
          if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) continue;
          await pause(1000);
          const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
          return (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
        }
        return null;
      };
      const first = await hit();
      ctx.expect(!!first && first.includes("1d6 necrotic"), `premier coup de l'arme de pacte : ${first?.join(", ")}`);
      const second = await hit();
      ctx.expect(!!second && !second.includes("1d6 necrotic"), `second coup du tour : ${second?.join(", ") || "rien"}`);
    });

    await part("Âme radieuse", async () => {
      await lend("phbwlkRadiantSou");
      await tough(); await place(bandit, g.x + 2 * grid, g.y);
      const flame = await ctx.itemId(warlock.id, "sacred-flame");
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: warlock.id, itemId: flame, targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      const bonuses = (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
      ctx.expect(bonuses.includes("@abilities.cha.mod radiant"), `Flamme sacrée : ${bonuses.join(", ")} ; jets ${(damage?.rolls ?? []).map(x => x.formula).join(" + ")}`);
    });

    await part("Défenses envoûtantes", async () => {
      await lend("phbwlkBeguilingD");
      await tough(); await place(bandit, g.x + grid, g.y);
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        await ctx.setHp(warlock, homes.get(warlock.id).hp);
        const hp0 = await ctx.hp(warlock);
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [warlock.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Occultiste");
        if ( !t?.reaction ) continue;
        await pause(2500);
        const msgs = await ctx.messagesSince(since);
        const dealt = (msgs.find(m => (m.type === "damage") && (m.alias === "Bandit"))?.rolls ?? []).reduce((s, x) => s + (x.total ?? 0), 0);
        const lost = hp0 - (await ctx.hp(warlock));
        ctx.expect(t.halved === true && lost === Math.min(hp0, Math.floor(dealt / 2)), `réaction « ${t.reaction} » : ${dealt} dégâts → ${lost} PV perdus`);
        if ( process.env.DEBUG ) ctx.log(`messages : ${msgs.map(m => `${m.type}/${m.alias}/${m.flavor ?? ""}/${(m.targets ?? []).map(x => x.name).join(",")}`).join(" | ")}`);
        const save = msgs.find(m => (m.type === "usage") && (m.alias !== "Bandit") && m !== msgs[0] && (m.targets ?? []).some(x => x.name === "Bandit"));
        ctx.expect(!!save, `le Bandit fait sa sauvegarde de Sagesse (${save?.flavor ?? save?.id ?? "aucune carte"})`);
        checked = true;
      }
      ctx.expect(checked, "le Bandit a touché l'Occultiste et la réaction a joué (20 essais au plus)");
    });
  }
};
