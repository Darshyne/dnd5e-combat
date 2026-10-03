/**
 * Le Rôdeur du Manuel des joueurs 2024 (SPEC §26), monde `dnd-6`. Le Guerrier reçoit, prêtés depuis le compendium du Manuel des
 * joueurs, la classe de Rôdeur au niveau 5, la sous-classe Traqueur des ténèbres, Embuscade effrayante, Proie du chasseur et la
 * Marque du chasseur ; le Bandit reçoit 300 PV. Vérifie :
 *  - Marque du chasseur posée sur le Bandit : +1d6 force à chaque coup ;
 *  - Frappe effroyable : +2d6 psychiques au premier coup du tour, pas au second ;
 *  - Tueur de colosses : +1d8 une fois par tour, seulement contre une cible blessée (pas au premier coup, le Bandit est indemne) ;
 *  - Tueur implacable (prêté ensuite) : la Marque passe à 1d10, sans le 1d6 ;
 *  - Chasseur précis (prêté ensuite) : l'attaque contre la créature marquée a l'Avantage.
 * Remet positions, PV, états ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const SPELLS = "dnd-players-handbook.spells";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "rodeur — Marque du chasseur, Frappe effroyable, Tueur de colosses, Tueur implacable, Chasseur précis",

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
    const lend = async (pack, id) => {
      const uuid = `Compendium.${pack}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const cls = await lend(CLASSES, "phbrgrRanger0000");
    await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.levels": 5 }, match: { path: "_id", value: cls } });
    await lend(CLASSES, "phbrgrGloomStalk");
    await lend(CLASSES, "phbrgrDreadAmbus");
    await lend(CLASSES, "phbrgrHuntersPre");
    const mark = await lend(SPELLS, "phbsplHuntersMar");

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Marque du chasseur|Hunter's Mark|Sape|Sap|Concentrat/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
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
      await ctx.startCombat([hero, bandit]);
      const combat = await state();
      for ( const [t, v] of [[hero, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== hero.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === hero.id;
    };
    const sword = await ctx.itemId(hero.id, "greatsword");
    const markBandit = async () => {
      const u = await ctx.use({ tokenId: hero.id, itemId: mark, activityId: "vxr2JKuQ3jyMDTwb", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
      await pause(2000);
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
      return (data.delta?.effects ?? []).some(e => /Marque du chasseur|Hunter's Mark/i.test(e.name));
    };
    /** Attaque jusqu'à toucher (10 essais) ; rend le jet d'attaque, le jet de dégâts et ses dégâts bonus. */
    const hit = async ({ fresh=false }={}) => {
      for ( let n = 0; n < 10; n++ ) {
        // Un raté de l'épée à deux mains blesse quand même (botte Écorchure) : le Bandit est remis indemne avant chaque essai.
        if ( fresh ) await tough();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: hero.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const msgs = await ctx.messagesSince(since);
        const attack = msgs.find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "";
        if ( r?.targets?.find(t => t.name === bandit.name)?.hit !== true ) continue;
        await pause(1000);
        const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
        const bonuses = (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
        const rolls = (damage?.rolls ?? []).map(r => r.formula);
        return { attack, bonuses, rolls };
      }
      return null;
    };

    await part("Marque, Frappe effroyable, Tueur de colosses", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      ctx.expect(await markBandit(), "le Bandit porte la Marque du chasseur");
      const first = await hit({ fresh: true });
      if ( !ctx.expect(!!first, "premier coup (10 essais au plus)") ) return;
      ctx.expect(first.bonuses.includes("1d6 force") && first.bonuses.some(b => /dreadful-strike psychic/.test(b)) && first.rolls.includes("2d6") && !first.bonuses.includes("1d8 slashing"),
        `premier coup, Bandit indemne : ${first.bonuses.join(", ")} ; jets ${first.rolls.join(" + ")}`);
      const second = await hit();
      if ( !ctx.expect(!!second, "second coup (10 essais au plus)") ) return;
      ctx.expect(second.bonuses.includes("1d6 force") && !second.bonuses.some(b => /dreadful-strike/.test(b)) && second.bonuses.includes("1d8 slashing"),
        `second coup du tour, Bandit blessé : ${second.bonuses.join(", ")}`);
    });

    await part("Tueur implacable, Chasseur précis", async () => {
      await lend(CLASSES, "phbrgrFoeSlayer0");
      await lend(CLASSES, "phbrgrPreciseHun");
      await tough(); await place(bandit, g.x + grid, g.y);
      ctx.expect(await markBandit(), "le Bandit porte la Marque du chasseur");
      const res = await hit();
      if ( !ctx.expect(!!res, "un coup (10 essais au plus)") ) return;
      ctx.expect(res.bonuses.includes("1d10 force") && !res.bonuses.includes("1d6 force"), `Tueur implacable : ${res.bonuses.join(", ")}`);
      ctx.expect(/adv|kh/.test(res.attack), `Chasseur précis : ${res.attack}`);
    });
  }
};
