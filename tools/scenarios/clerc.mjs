/**
 * Le Clerc du Manuel des joueurs 2024 (SPEC §27), monde `dnd-6`. Le Clerc (niveau 1) reçoit, prêtés depuis le compendium du Manuel
 * des joueurs, Impacts bénis (et leur version améliorée), Prêtre de guerre, Disciple de la Vie, Guérisseur béni, Guérison suprême et
 * Soins ; le Bandit reçoit 300 PV. Vérifie :
 *  - Impact divin : +1d8 radiants au premier coup d'arme du tour, pas au second ; 2d8 avec Impacts bénis améliorés ;
 *  - Incantation puissante (déclarations de l'item remplacées par son flag) : Flamme sacrée + le modificateur de Sagesse ;
 *  - Prêtre de guerre : l'activité (action Bonus) ouvre une attaque d'arme gratuite, l'action reste ;
 *  - Soins (niveau 1) sur le Guerrier : maximum des dés (Guérison suprême) + 3 (Disciple de la Vie) ; le Clerc regagne 3 PV
 *    (Guérisseur béni).
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
  name: "clerc — Impact divin, Incantation puissante, Prêtre de guerre, Disciple de la Vie, Guérisseur béni, Guérison suprême",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Clerc", "Bandit", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const bandit = await ctx.token("Bandit");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [cleric, bandit, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(cleric.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const lend = async (pack, id, extra=null) => {
      const uuid = `Compendium.${pack}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      if ( extra ) for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: id }).catch(() => {});

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
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
      await ctx.startCombat([cleric, bandit]);
      const combat = await state();
      for ( const [t, v] of [[cleric, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== cleric.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === cleric.id;
    };
    const budget = () => ctx.engine("budget", { tokenId: cleric.id });
    const mace = await ctx.itemId(cleric.id, "mace");
    /** Attaque à la masse jusqu'à toucher (10 essais) ; rend les dégâts bonus du jet. */
    const hit = async () => {
      for ( let n = 0; n < 10; n++ ) {
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: cleric.id, itemId: mace, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === bandit.name)?.hit !== true ) continue;
        await pause(1000);
        const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
        return (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
      }
      return null;
    };

    await part("Impact divin", async () => {
      const strikes = await lend(CLASSES, "phbclcBlessedStr");
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Clerc") ) return;
      const first = await hit();
      ctx.expect(!!first && first.includes("1d8 radiant"), `premier coup : ${first?.join(", ")}`);
      const second = await hit();
      ctx.expect(!!second && !second.includes("1d8 radiant"), `second coup du tour : ${second?.join(", ") || "rien"}`);
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null;
      const improved = await lend(CLASSES, "phbclcImprovedBl");
      if ( !ctx.expect(await fight(), "combat : au tour du Clerc") ) return;
      const third = await hit();
      ctx.expect(!!third && third.includes("2d8 radiant") && !third.includes("1d8 radiant"), `Impacts bénis améliorés : ${third?.join(", ")}`);
      await unlend(improved); await unlend(strikes);
    });

    await part("Incantation puissante", async () => {
      const potent = [{ on: "preDamageRoll", if: { "activity.cantripOf": "cleric" }, do: [{ type: "damage", formula: "@abilities.wis.mod", damageType: "weapon" }] }];
      const strikes = await lend(CLASSES, "phbclcBlessedStr");
      const { before } = await ctx.engine("overrideContent", { identifier: "blessed-strikes", entry: { triggers: potent } });
      ctx.restore(() => ctx.engine("overrideContent", { identifier: "blessed-strikes", entry: before }).catch(() => {}));
      await tough(); await place(bandit, g.x + 2 * grid, g.y);
      const flame = await ctx.itemId(cleric.id, "sacred-flame");
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: cleric.id, itemId: flame, targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      const bonuses = (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
      const rolls = (damage?.rolls ?? []).map(r => r.formula);
      ctx.expect(bonuses.includes("@abilities.wis.mod radiant") && rolls.includes("3"), `Flamme sacrée : ${bonuses.join(", ")} ; jets ${rolls.join(" + ")}`);
      await unlend(strikes);
    });

    await part("Prêtre de guerre", async () => {
      const priest = await lend(CLASSES, "phbclcWarPriest0");
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Clerc") ) return;
      await ctx.use({ tokenId: cleric.id, itemId: priest, activityId: "dnd5eactivity000", consume: true });
      await pause(2500);
      const b = await budget();
      ctx.expect(b?.flurry === 1 && b?.flurryAny === true && b?.bonus === 0, `activité : ${b?.flurry} attaque ouverte (arme : ${b?.flurryAny}), action Bonus ${b?.bonus}`);
      const u = await ctx.use({ tokenId: cleric.id, itemId: mace, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: {} } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const c = await budget();
      ctx.expect(c?.flurry === 0 && c?.action === 1, `après l'attaque à la masse : ${c?.flurry} restante, l'action intacte (${c?.action})`);
      await unlend(priest);
    });

    await part("Soins : Guérison suprême, Disciple de la Vie, Guérisseur béni", async () => {
      await lend(CLASSES, "phbclcDiscipleOf");
      await lend(CLASSES, "phbclcBlessedHea");
      await lend(CLASSES, "phbclcSupremeHea");
      const cure = await lend(SPELLS, "phbsplCureWounds");
      await place(fighter, g.x + grid, g.y);
      // Assez de PV max pour voir le montant entier (le Guerrier n'en a que 13).
      await ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.hp.bonuses.overall": "30" } });
      ctx.restore(() => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.hp.bonuses.overall": "" } }).catch(() => {}));
      await pause(500);
      await ctx.setHp(fighter, 1);
      await ctx.setHp(cleric, 1);
      const fmax = (await ctx.engine("stats", { tokenId: fighter.id }))?.hp?.max;
      const cmax = (await ctx.engine("stats", { tokenId: cleric.id }))?.hp?.max;
      const wis = (await ctx.engine("stats", { tokenId: cleric.id }))?.mods?.wis ?? 0;
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: cleric.id, itemId: cure, activityType: "heal", targetTokenIds: [fighter.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      // Le soin attend le clic « Soins » de la carte (api.mcp.rollCard), comme au scénario ravenloft-options.
      await pause(1500);
      await ctx.engine("rollCard", { messageId: u.usageMessageId });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const heal = (await ctx.messagesSince(since)).find(m => m.rolls?.length && (m.type !== "usage"));
      ctx.log(`jet de soin : ${(heal?.rolls ?? []).map(x => `${x.formula} = ${x.total}`).join(" + ")}`);
      await pause(2000);
      const fhp = await ctx.hp(fighter);
      const chp = await ctx.hp(cleric);
      const expected = Math.min(fmax, 1 + 16 + wis + 3);   // 2d8 au maximum (16) + Sagesse, + 2 + niveau 1
      ctx.expect(fhp === expected, `Guerrier : 1 → ${fhp} PV (attendu ${expected} = 1 + 16 + ${wis} + 3, maximum ${fmax})`);
      ctx.expect(chp === Math.min(cmax, 1 + 3), `Clerc : 1 → ${chp} PV (Guérisseur béni : +3)`);
    });
  }
};
