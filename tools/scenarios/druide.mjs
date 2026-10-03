/**
 * Le Druide du Manuel des joueurs 2024 (SPEC §30), monde `dnd-6`. Le Guerrier reçoit, prêtés depuis le compendium du Manuel des
 * joueurs, Fureur élémentaire (et sa version améliorée), Foulée sélène et Courroux des mers ; le Bandit reçoit 300 PV. Vérifie :
 *  - Attaques primitives : +1d8 de feu au premier coup d'arme du tour, pas au second ; 2d8 avec Fureur élémentaire améliorée ;
 *  - Foulée sélène : l'attaque suivante a l'Avantage, la marque consommée (l'attaque d'après, non) ;
 *  - Courroux des mers : une sauvegarde de Constitution ratée repousse le Bandit de 15 ft (trois cases).
 * Remet positions, PV, états ; retire les items prêtés.
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
  name: "druide — Attaques primitives, Foulée sélène, Courroux des mers",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
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
    const lend = async id => {
      const uuid = `Compendium.${CLASSES}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: id }).catch(() => {});

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Foulée sélène|Moonlight|Sape|Sap\b|Embruns/i);
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
      await ctx.startCombat([hero, bandit]);
      const combat = await state();
      for ( const [t, v] of [[hero, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== hero.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === hero.id;
    };
    const sword = await ctx.itemId(hero.id, "greatsword");
    /** Une attaque à l'épée à deux mains : sa formule d'attaque, touché ou non, et les dégâts bonus du jet. */
    const swing = async () => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: hero.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1000);
      const msgs = await ctx.messagesSince(since);
      return { formula: msgs.find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "", hit: r?.targets?.find(t => t.name === "Bandit")?.hit === true,
        bonuses: (msgs.find(m => m.type === "damage")?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`) };
    };
    const hit = async () => { for ( let n = 0; n < 10; n++ ) { const s = await swing(); if ( s.hit ) return s.bonuses; } return null; };

    await part("Attaques primitives", async () => {
      const fury = await lend("phbdrdElementalF");
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const first = await hit();
      ctx.expect(!!first && first.includes("1d8 fire"), `premier coup : ${first?.join(", ")}`);
      const second = await hit();
      ctx.expect(!!second && !second.includes("1d8 fire"), `second coup du tour : ${second?.join(", ") || "rien"}`);
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null;
      const improved = await lend("phbdrdImprovedEl");
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const third = await hit();
      ctx.expect(!!third && third.includes("2d8 fire") && !third.includes("1d8 fire"), `Fureur élémentaire améliorée : ${third?.join(", ")}`);
      await unlend(improved); await unlend(fury);
    });

    await part("Foulée sélène", async () => {
      const step = await lend("phbdrdMoonlightS");
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const before = await swing();
      ctx.expect(!/adv|kh/.test(before.formula), `avant : ${before.formula}`);
      const u = await ctx.use({ tokenId: hero.id, itemId: step, activityId: "dnd5eactivity000", usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 15000 }).catch(() => null);
      await pause(2000);
      // La destination de la téléportation attend un clic chez l'auteur : on la laisse (Échap), l'Avantage est ce qu'on vérifie.
      await ctx.call("list-dialogs", {}).catch(() => null);
      const marked = (await ctx.call("get-actor", { actorId: hero.actorId })).effects?.some(e => /Foulée sélène|Moonlight/i.test(e.name));
      ctx.expect(!!marked, "le Guerrier porte l'effet de la Foulée sélène");
      const after = await swing();
      ctx.expect(/adv|kh/.test(after.formula), `attaque suivante : ${after.formula}`);
      const again = await swing();
      ctx.expect(!/adv|kh/.test(again.formula), `celle d'après (marque consommée) : ${again.formula}`);
      await unlend(step);
    });

    await part("Courroux des mers", async () => {
      const wrath = await lend("phbdrdWrathOfThe");
      await tough();
      // Restored Keep, colonne x = 3080 : de y = 5040 à 5460, quatre cases libres de murs (relevé du scénario `poussee`, sous la
      // case d'origine du Magicien, 3080 × 4760). Le druide en 4900, le Bandit en 5040, repoussé jusqu'en 5460.
      await place(hero, 3080, 4900);
      const pos0 = { x: 3080, y: 5040 };
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        await place(bandit, pos0.x, pos0.y);
        // L'activité pose une émanation (gabarit) : la zone est donnée, sur la case du Bandit.
        const box = await ctx.box(bandit);
        const u = await ctx.use({ tokenId: hero.id, itemId: wrath, activityId: "9U9AoJYvcrCQtIMm", area: { shape: "rectangle", ...box }, usageConfig: { [MODULE_ID]: { confirmed: true } } });
        if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Bandit");
        if ( !r ) { ctx.expect(false, "résolution non tranchée (20 s)"); break; }
        if ( !t?.save || t.save.success ) continue;
        await pause(2000);
        const pos = await ctx.position(bandit);
        const moved = Math.round(Math.hypot(pos.x - pos0.x, pos.y - pos0.y) / grid);
        if ( process.env.DEBUG ) ctx.log(`plan : ${JSON.stringify(r.plan.steps)} ; cible ${JSON.stringify(t).slice(0, 300)}`);
        ctx.expect(moved === 3, `sauvegarde ratée (${t.save.total}) : le Bandit recule de ${moved} case(s) (attendu 3 = 15 ft)`);
        checked = true;
      }
      ctx.expect(checked, "une sauvegarde ratée (20 essais au plus)");
      await unlend(wrath);
    });
  }
};
