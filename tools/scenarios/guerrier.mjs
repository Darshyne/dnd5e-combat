/**
 * Le Guerrier du Manuel des joueurs 2024 (SPEC §21), monde `dnd-6`. Le Guerrier (nain, niveau 1) reçoit, prêtées depuis le
 * compendium du Manuel des joueurs, Fougue, Décalage tactique, Attaques avisées, Héros du champ d'honneur et les styles Armes à
 * deux mains et Armes de jet. Le Bandit reçoit 300 PV. Vérifie :
 *  - Fougue : une action de plus au budget ;
 *  - Décalage tactique : Second souffle (action Bonus) → la moitié de la Vitesse en plus, désengagé ;
 *  - Attaques avisées : après un raté, la prochaine attaque contre le Bandit a l'Avantage ;
 *  - Héros du champ d'honneur : l'Inspiration héroïque au début de son tour ;
 *  - Armes à deux mains : les dés de l'épée à deux mains en « min3 » ;
 *  - Armes de jet : +2 à la javeline lancée.
 * Remet positions, PV, inspiration ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const FEATS = "dnd-players-handbook.feats";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "guerrier — Fougue, Décalage tactique, Attaques avisées, Héros du champ d'honneur, Armes à deux mains, Armes de jet",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [fighter, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(fighter.id).pos;
    const actor0 = await ctx.call("get-actor", { actorId: fighter.actorId });
    const inspiration0 = !!actor0.system?.attributes?.inspiration;
    ctx.restore(() => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.inspiration": inspiration0 } }).catch(() => {}));

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    // `move-token` (déplacement « displace ») : un update de x/y est contraint par les murs de la scène.
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /^(Attaques avisées|Studied Attacks|Sape|Sap|Ouverture|Vex|Ralentissement|Slow) /i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const lend = async (pack, id) => {
      const uuid = `Compendium.${pack}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
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
      await ctx.startCombat([fighter, bandit]);
      const combat = await state();
      for ( const [t, v] of [[fighter, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== fighter.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === fighter.id;
    };
    const budget = () => ctx.engine("budget", { tokenId: fighter.id });
    const attack = async (itemId, target) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: fighter.id, itemId, activityType: "attack", targetTokenIds: [target.id] });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      return { hit: r?.targets?.find(t => t.name === target.name)?.hit ?? null,
        mode: msgs.find(m => m.type === "attack")?.rolls?.[0]?.options?.advantageMode ?? null,
        damage: (msgs.find(m => m.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ") };
    };
    const until = async (want, fn, tries=20) => { for ( let i = 0; i < tries; i++ ) { const a = await fn(); if ( a.hit === want ) return a; } return null; };
    const sword = await ctx.itemId(fighter.id, "greatsword");
    const javelin = await ctx.itemId(fighter.id, "javelin");

    const surge = await lend(CLASSES, "phbftrActionSurg");
    await part("Fougue", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const before = await budget();
      await ctx.use({ tokenId: fighter.id, itemId: surge });
      await pause(2000);
      const after = await budget();
      ctx.expect(after?.action === (before?.action ?? 0) + 1, `action ${before?.action} → ${after?.action}`);
    });

    await lend(CLASSES, "phbftrTacticalSh");
    await part("Décalage tactique", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const before = await budget();
      await ctx.use({ tokenId: fighter.id, identifier: "second-wind" });
      await pause(2500);
      const after = await budget();
      ctx.expect(after?.bonus === 0 && after?.disengaged === true && (after?.bonusMove ?? 0) > 0,
        `Second souffle : action Bonus ${after?.bonus}, désengagé ${after?.disengaged}, +${after?.bonusMove} de déplacement`);
      ctx.expect(after?.cap >= (before?.cap ?? 0) + (after?.bonusMove ?? 0) - 0.01, `plafond ${before?.cap} → ${after?.cap}`);
    });

    await lend(CLASSES, "phbftrStudiedAtt");
    await part("Attaques avisées", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      const miss = await until(false, () => attack(sword, bandit));
      if ( !ctx.expect(!!miss, "épée à deux mains : raté (20 essais au plus)") ) return;
      const marked = (await ctx.effects(fighter)).some(e => e.flags?.[MODULE_ID]?.mastery?.kind === "studied");
      ctx.expect(marked, "le Guerrier porte Attaques avisées contre le Bandit");
      const next = await attack(sword, bandit);
      ctx.expect(next.mode === 1, `l'attaque suivante a l'Avantage (mode ${next.mode})`);
    });

    await lend(CLASSES, "phbftrHeroicWarr");
    await part("Héros du champ d'honneur", async () => {
      await ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.inspiration": false } });
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      await ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.inspiration": false } });
      await ctx.nextTurn(); await pause(1500);
      await ctx.nextTurn(); await pause(2500);   // début du tour suivant du Guerrier
      const a = await ctx.call("get-actor", { actorId: fighter.actorId });
      ctx.expect(a.system?.attributes?.inspiration === true, `Inspiration héroïque au début de son tour (${a.system?.attributes?.inspiration})`);
    });

    await lend(FEATS, "phbfstGreatWeapo");
    await part("Armes à deux mains", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      const a = await until(true, () => attack(sword, bandit));
      if ( !ctx.expect(!!a, "épée à deux mains : touché (20 essais au plus)") ) return;
      ctx.expect(/2d6min3/.test(a.damage.replace(/\s/g, "")), `dés « min3 » : « ${a.damage} »`);
    });

    await lend(FEATS, "phbfstThrownWeap");
    await part("Armes de jet", async () => {
      await tough(); await place(bandit, g.x + 3 * grid, g.y);
      // Un module voisin peut faire quitter la main à l'arme lancée (Darsh Loot : plantée dans la cible ou tombée en tas) : elle
      // est rendue avant chaque essai, sous son identifiant. Le filet de sécurité du lanceur retire le tas et la copie plantée.
      const data = (actor0.items ?? []).find(i => i._id === javelin);
      const rearm = async () => {
        const items = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
        if ( !data || items.some(i => i._id === javelin) ) return;
        const { folder, ownership, _stats, ...itemData } = data;
        await ctx.engine("restoreItem", { actorId: fighter.actorId, itemData });
      };
      const a = await until(true, async () => { await rearm(); return attack(javelin, bandit); });
      if ( !ctx.expect(!!a, "javeline lancée : touché (20 essais au plus)") ) return;
      ctx.expect(/\+ 2( |$)/.test(a.damage) || /\+2$/.test(a.damage.replace(/\s/g, "")), `+2 aux dégâts : « ${a.damage} »`);
    });
  }
};
