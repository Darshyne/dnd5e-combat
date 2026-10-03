/**
 * Le Barbare du Manuel des joueurs 2024 (SPEC §22), monde `dnd-6`. Le Guerrier reçoit, prêtées depuis le compendium du Manuel des
 * joueurs, la classe de Barbare au niveau 11 (bonus de Rage +3) et Rage, Témérité, Bond instinctif, Rage implacable, Frénésie et
 * Fureur divine. Le Bandit reçoit 300 PV. Vérifie :
 *  - Rage : l'effet de l'item s'active ; action Bonus dépensée ; Bond instinctif : la moitié de la Vitesse en plus, pas désengagé ;
 *  - entretien : une Rage entretenue par une attaque tient à la fin du tour ; sans rien, elle prend fin ;
 *  - Neutralisé (Étourdi) : la Rage prend fin ;
 *  - Témérité : la question s'ouvre à la première attaque de Force du tour ; « Témérité » : Avantage à ses attaques, Avantage contre
 *    lui ; pas de seconde question dans le tour ;
 *  - Frénésie (en Rage, téméraire) : le premier coup du tour porte 3d6 de plus, pas le second ; Fureur divine : 1d6 + 5 radiants ;
 *  - Rage implacable : à 0 PV en Rage, la sauvegarde de Constitution ; réussie ⇔ 22 PV.
 * Remet positions, PV, niveau ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "barbare — Rage (entretien, fin), Bond instinctif, Témérité, Frénésie, Fureur divine, Rage implacable",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(PHB) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
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
    const lent = [];
    const lend = async id => {
      const uuid = `Compendium.${PHB}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const cls = await lend("phbbrbBarbarian0");
    await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.levels": 11 }, match: { path: "_id", value: cls } });
    const rage = await lend("phbbrbRage000000");
    await lend("phbbrbRecklessAt");
    await lend("phbbrbInstinctiv");
    const relentless = await lend("phbbrbRelentless");

    const itemOf = async id => ((await ctx.call("get-actor", { actorId: hero.actorId })).items ?? []).find(i => i._id === id);
    // En Rage : l'effet de l'item activé, ou sa copie posée sur l'acteur par le moteur (origine : l'item).
    const raging = async () => ((await itemOf(rage))?.effects?.some(e => !e.disabled) === true)
      || (await ctx.effects(hero)).some(e => !e.disabled && String(e._stats?.duplicateSource ?? "").includes(`Item.${rage}.`));
    const endRageNow = async () => {
      for ( const e of await ctx.effects(hero) ) {
        if ( String(e._stats?.duplicateSource ?? "").includes(`Item.${rage}.`) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: hero.actorId, effectId: e._id }).catch(() => {});
      }
      const item = await itemOf(rage);
      for ( const e of item?.effects ?? [] ) {
        if ( !e.disabled ) await ctx.call("upsert-embedded-effect", { uuid: `Actor.${hero.actorId}.Item.${rage}`, effectData: { disabled: true }, match: { path: "_id", value: e._id } }).catch(() => {});
      }
      await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: rage } });
    };
    const remettre = async () => {
      await endRageNow();
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of ["stunned", "unconscious", "prone", "dead"] ) {
          await ctx.removeStatusEffects(t, s);
          await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {});
        }
        await ctx.removeEffectsNamed(t, /^(Témérité|Reckless|Sape|Sap|Ouverture|Vex|Ralentissement|Slow|Attaques avisées)/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
      await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "flags.dnd5e-combat.recklessTurn": null, "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } }).catch(() => {});
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
    /** Jusqu'au tour suivant du héros (le tour du Bandit passe). */
    const nextHeroTurn = async () => { await ctx.nextTurn(); await pause(2000); await ctx.nextTurn(); await pause(2500); };
    const budget = () => ctx.engine("budget", { tokenId: hero.id });
    const enrage = async () => { await ctx.use({ tokenId: hero.id, itemId: rage }); await pause(2500); };
    const sword = await ctx.itemId(hero.id, "greatsword");
    const attack = async (attacker, itemId, target, usage={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: usage } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      return { hit: r?.targets?.find(t => t.name === target.name)?.hit ?? null,
        mode: msgs.find(m => m.type === "attack")?.rolls?.[0]?.options?.advantageMode ?? null,
        damage: (msgs.find(m => m.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ") };
    };
    const until = async (fn, tries=20) => { for ( let i = 0; i < tries; i++ ) { const a = await fn(); if ( a.hit ) return a; } return null; };

    await part("Rage et Bond instinctif", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du héros") ) return;
      const before = await budget();
      await enrage();
      ctx.expect(await raging(), "l'effet de Rage est actif");
      const b = await budget();
      ctx.expect(b?.bonus === 0 && (b?.bonusMove ?? 0) > 0 && b?.disengaged !== true,
        `action Bonus ${b?.bonus}, +${b?.bonusMove} de déplacement, désengagé ${b?.disengaged} (plafond ${before?.cap} → ${b?.cap})`);
    });

    await part("Rage entretenue ou non", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du héros") ) return;
      await enrage();
      await nextHeroTurn();
      await attack(hero, sword, bandit, { reckless: false });
      await nextHeroTurn();
      ctx.expect(await raging(), "entretenue par une attaque : toujours en Rage à son tour suivant");
      await nextHeroTurn();   // ce tour-ci, rien : elle tombe à la fin du précédent
      ctx.expect(!(await raging()), "un tour sans rien : la Rage a pris fin");
    });

    await part("Neutralisé", async () => {
      if ( !ctx.expect(await fight(), "combat : au tour du héros") ) return;
      await enrage();
      await ctx.call("set-status", { tokenId: hero.id, statusId: "stunned", active: true });
      await pause(2500);
      ctx.expect(!(await raging()), "Étourdi : la Rage prend fin");
    });

    await part("Témérité", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du héros") ) return;
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: hero.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
      const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 6000 }).catch(() => null))?.windows?.find(w => /Témérité|Reckless/i.test(w.title ?? ""));
      if ( !ctx.expect(!!d, "première attaque de Force : la question de Témérité s'ouvre") ) return;
      await ctx.call("answer-dialog", { id: d.id, button: "yes" });
      // L'utilisation suspendue est relancée avec la réponse (le jet d'attaque, lui, est enchaîné par dnd5e en jeu ; le connecteur
      // coupe cet enchaînement).
      let relaunched = null;
      for ( const stop = Date.now() + 15000; !relaunched && (Date.now() < stop); await pause(500) ) relaunched = (await ctx.messagesSince(since)).find(m => m.type === "usage");
      ctx.expect(!!relaunched && (relaunched.targets ?? []).some(t => t.name === "Bandit"), "l'utilisation est relancée, le Bandit toujours visé");
      await pause(3000);
      const marked = (await ctx.effects(hero)).some(e => e.flags?.[MODULE_ID]?.mastery?.kind === "reckless");
      ctx.expect(marked, "le héros porte la Témérité");
      const known2 = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const second = await attack(hero, sword, bandit);
      const again = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known2, waitMs: 1500 }).catch(() => null))?.windows?.length ?? 0;
      ctx.expect(!again && (second.mode === 1), `seconde attaque : pas de question, Avantage (mode ${second.mode})`);
      const back = await attack(bandit, await ctx.itemId(bandit.id, "scimitar"), hero);
      ctx.expect(back.mode === 1, `le Bandit attaque le héros avec l'Avantage (mode ${back.mode})`);
    });

    await lend("phbbrbFrenzy0000");
    await part("Frénésie", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du héros") ) return;
      await enrage();
      const first = await until(() => attack(hero, sword, bandit, { reckless: true }));
      if ( !ctx.expect(!!first, "premier coup (20 essais au plus)") ) return;
      // 3d6 de plus, doublés sur un coup critique.
      ctx.expect(/\|(3|6)d6$/.test(first.damage.replace(/[()\s]/g, "")), `Frénésie : 3d6 de plus « ${first.damage} »`);
      const second = await until(() => attack(hero, sword, bandit));
      ctx.expect(!!second && !second.damage.includes("|"), `second coup du tour : rien de plus « ${second?.damage} »`);
    });

    await lend("phbbrbDivineFury");
    await part("Fureur divine", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du héros") ) return;
      await enrage();
      const hit = await until(() => attack(hero, sword, bandit, { reckless: false }));
      if ( !ctx.expect(!!hit, "coup (20 essais au plus)") ) return;
      ctx.expect(/1d6\+5|1d6\+floor/.test(hit.damage.replace(/\s/g, "")) || /1d6 \+ 5/.test(hit.damage), `Fureur divine : 1d6 + 5 « ${hit.damage} »`);
    });

    await part("Rage implacable", async () => {
      let seen = false;
      for ( let n = 0; (n < 6) && !seen; n++ ) {
        await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: relentless } });
        await ctx.setHp(hero, 10);
        await enrage();
        const since = await ctx.lastMessageId();
        await ctx.setHp(hero, 0);
        let save = null;
        for ( const stop = Date.now() + 15000; !save && (Date.now() < stop); await pause(500) ) {
          save = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.relentless);
        }
        if ( !ctx.expect(!!save, "à 0 PV en Rage : la sauvegarde de Constitution est lancée") ) return;
        await pause(2500);
        const dc = save.flags[MODULE_ID].relentless.dc;
        const total = save.rolls?.[0]?.total;
        const hp = await ctx.hp(hero);
        ctx.expect((total >= dc) === (hp === 22), `sauvegarde ${total} contre DD ${dc} : ${hp} PV`);
        seen = total >= dc;
        await remettre();
      }
      ctx.expect(seen, "une réussite vue : le héros reste debout");
    });
  }
};
