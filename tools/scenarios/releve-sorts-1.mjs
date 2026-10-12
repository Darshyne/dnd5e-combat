/**
 * Relevé des sorts, lot 1 (SPEC §157), monde `dnd-6`, arène : les sorts prêtés depuis le Manuel des joueurs (à volonté), chacun
 * joué directement par son activité, et ce que le moteur en fait lu sur la table :
 *  - Flou : l'effet posé sur le Magicien, une raison de Désavantage de plus à l'attaque du Zombi contre lui ;
 *  - Assassin imaginaire, Duel forcé (Zombi raté) : Désavantage aux attaques du Zombi (contre le Guerrier ; pas contre le Paladin
 *    pour le Duel) ;
 *  - État cadavérique : Aveuglé et Neutralisé sur le Guerrier ;
 *  - Châtiment de révélation : l'effet sur le Zombi, Avantage du Guerrier contre lui ;
 *  - Châtiment de tonnerre (sauvegarde ratée) : repoussé de 3 m loin du Paladin ;
 *  - Châtiment de stupeur (sauvegarde ratée, en combat) : Étourdi jusqu'à la fin du prochain tour du Paladin ;
 *  - Repli expéditif (en combat) : Foncer pris.
 * Remet positions, PV, effets, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 1 — Flou, Assassin imaginaire, Duel forcé, État cadavérique, châtiments, Repli expéditif",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Paladin", "Guerrier", "Clerc", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, pal, fighter, cleric, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, pal, fighter, cleric, zombi];
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };
    const reset = async () => {
      await endCombat();
      for ( const t of all ) {
        await clearNew(t);
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };

    const weaponOf = async t => {
      const items = (await ctx.call("get-actor", { actorId: t.actorId })).items ?? [];
      return items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"))?._id ?? null;
    };
    const zWeapon = await weaponOf(zombi);
    const fWeapon = await weaponOf(fighter);
    const reasons = (attacker, target, itemId) => ctx.engine("attackReasons", { attackerId: attacker.id, targetId: target.id, itemId });
    const lend = id => async t => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
    /** Lance l'activité (type) sur la cible jusqu'à une sauvegarde ratée (15 essais) ; rend la résolution, ou null. */
    const untilFailed = async (caster, itemId, target, activityType="save") => {
      for ( let n = 1; n <= 15; n++ ) {
        await clearNew(target);
        await clearNew(caster);
        const used = await ctx.use({ tokenId: caster.id, itemId, activityType, targetTokenIds: [target.id], consume: false });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1200);
        const t = r?.targets?.find(x => x.name === target.name);
        if ( t?.save?.success === false ) return r;
      }
      return null;
    };
    const settled = async used => { await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null); await pause(1000); };
    const fight = async (first, other) => {
      await ctx.startCombat([first, other]);
      const s = await ctx.combat();
      const c = s.combat ?? s.combats?.[0] ?? s;
      for ( const [t, v] of [[first, 20], [other, 10]] ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      }
      const current = async () => { const st = await ctx.combat(); const cc = st.combat ?? st.combats?.[0] ?? st; return cc.combatants?.find(x => x.id === cc.currentCombatantId)?.tokenId; };
      for ( let i = 0; (i < 3) && ((await current()) !== first.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      return (await current()) === first.id;
    };

    await part("Flou", async () => {
      const id = await lend("phbsplBlur000000")(mage);
      const before = (await reasons(zombi, mage, zWeapon)).disadvantage;
      await settled(await ctx.use({ tokenId: mage.id, itemId: id, targetTokenIds: [mage.id], consume: false }));
      // La concentration arrive d'abord ; l'effet du sort, à la fin de l'animation.
      ctx.expect((await ctx.effectsFrom(mage, "blur")).some(e => !/concentr/i.test(e.effect ?? "")), "Flou : l'effet est sur le Magicien");
      const after = (await reasons(zombi, mage, zWeapon)).disadvantage;
      ctx.expect(after.filter(r => r.startsWith("content")).length > before.filter(r => r.startsWith("content")).length,
        `Flou : Désavantage du Zombi contre le Magicien (${before.join(", ") || "aucun"} → ${after.join(", ")})`);
    });

    await part("Assassin imaginaire", async () => {
      const id = await lend("phbsplPhantasmal")(mage);
      const before = (await reasons(zombi, fighter, zWeapon)).disadvantage;
      const r = await untilFailed(mage, id, zombi);
      if ( !ctx.expect(!!r, "Assassin imaginaire : une sauvegarde ratée (15 essais au plus)") ) return;
      const after = (await reasons(zombi, fighter, zWeapon)).disadvantage;
      ctx.expect(after.length > before.length, `Assassin imaginaire : Désavantage du Zombi (${after.join(", ")})`);
    });

    await part("Duel forcé", async () => {
      const id = await lend("phbsplCompelledD")(pal);
      const vsFighter = (await reasons(zombi, fighter, zWeapon)).disadvantage;
      const vsPal = (await reasons(zombi, pal, zWeapon)).disadvantage;
      const r = await untilFailed(pal, id, zombi);
      if ( !ctx.expect(!!r, "Duel forcé : une sauvegarde ratée (15 essais au plus)") ) return;
      const f = (await reasons(zombi, fighter, zWeapon)).disadvantage;
      const p = (await reasons(zombi, pal, zWeapon)).disadvantage;
      ctx.expect(f.length > vsFighter.length, `Duel forcé : Désavantage contre le Guerrier (${f.join(", ")})`);
      ctx.expect(p.length === vsPal.length, `Duel forcé : rien de plus contre le Paladin (${p.join(", ") || "aucun"})`);
    });

    await part("État cadavérique", async () => {
      const id = await lend("phbsplFeignDeath")(cleric);
      await settled(await ctx.use({ tokenId: cleric.id, itemId: id, targetTokenIds: [fighter.id], consume: false }));
      const fx = await ctx.effectsFrom(fighter, "feign-death");
      const statuses = fx.flatMap(e => e.statuses ?? []);
      ctx.expect(statuses.includes("blinded") && statuses.includes("incapacitated"), `État cadavérique : ${statuses.join(", ") || "rien"} sur le Guerrier`);
    });

    await part("Châtiment de révélation", async () => {
      // Le vrai chemin : le Paladin touche le Zombi au corps à corps, la question du châtiment répond « Châtiment de révélation ».
      await ctx.ensureItem(pal, PHB + "phbsplShiningSmi");
      const grid = await ctx.gridSize();
      const p = await ctx.position(pal);
      await ctx.call("move-token", { tokenId: zombi.id, x: p.x - grid, y: p.y, elevation: 0 });
      const slots0 = (await ctx.call("get-actor", { actorId: pal.actorId })).system?.spells?.spell2?.value ?? 0;
      await ctx.call("update-actor", { actorId: pal.actorId, actorData: { "system.spells.spell2.value": 2 } });
      ctx.restore(() => ctx.call("update-actor", { actorId: pal.actorId, actorData: { "system.spells.spell2.value": slots0 } }).catch(() => {}));
      const pWeapon = await weaponOf(pal);
      const before = (await reasons(fighter, zombi, fWeapon)).advantage;
      let smitten = false;
      for ( let n = 1; (n <= 10) && !smitten; n++ ) {
        const ids = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
        const used = await ctx.use({ tokenId: pal.id, itemId: pWeapon, activityType: "attack", targetTokenIds: [zombi.id] });
        for ( const stop = Date.now() + 9000; Date.now() < stop; ) {
          const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null))?.windows?.[0];
          if ( !d ) continue;
          const b = (d.buttons ?? []).find(x => /révélation|Shining/i.test(x.label ?? ""));
          await ctx.call("answer-dialog", { id: d.id, button: b ? (b.action ?? b.label) : (d.buttons?.at(-1)?.action ?? d.buttons?.at(-1)?.label) }).catch(() => {});
          break;
        }
        await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(2500);
        smitten = (await ctx.effectsFrom(zombi, "shining-smite")).length > 0;
        if ( !smitten ) await ctx.setHp(zombi, homes.get(zombi.id).hp);
      }
      ctx.expect((await ctx.effectsFrom(zombi, "shining-smite")).length > 0, "Châtiment de révélation : l'effet est sur le Zombi");
      const after = (await reasons(fighter, zombi, fWeapon)).advantage;
      ctx.expect(after.length > before.length, `Châtiment de révélation : Avantage du Guerrier (${after.join(", ")})`);
    });

    await part("Châtiment de tonnerre", async () => {
      const id = await lend("phbsplThunderous")(pal);
      const grid = await ctx.gridSize();
      const p = await ctx.position(pal);
      let pushed = null;
      for ( let n = 1; (n <= 15) && !pushed; n++ ) {
        await clearNew(zombi);
        await ctx.call("move-token", { tokenId: zombi.id, x: p.x - grid, y: p.y, elevation: 0 });
        await pause(700);
        const used = await ctx.use({ tokenId: pal.id, itemId: id, activityType: "save", targetTokenIds: [zombi.id], consume: false });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        if ( r?.targets?.[0]?.save?.success === false ) pushed = await ctx.position(zombi);
      }
      if ( !ctx.expect(!!pushed, "Châtiment de tonnerre : une sauvegarde ratée (15 essais au plus)") ) return;
      ctx.expect(pushed.x === p.x - 3 * grid, `Châtiment de tonnerre : repoussé de 3 m (${(p.x - grid - pushed.x) / grid} case(s))`);
    });

    await part("Châtiment de stupeur", async () => {
      const id = await lend("phbsplStaggering")(pal);
      if ( !ctx.expect(await fight(pal, zombi), "Châtiment de stupeur : tour du Paladin") ) return;
      const r = await untilFailed(pal, id, zombi);
      if ( !ctx.expect(!!r, "Châtiment de stupeur : une sauvegarde ratée (15 essais au plus)") ) return;
      const stunned = async () => (await ctx.effects(zombi)).some(e => (e.statuses ?? []).includes("stunned"));
      ctx.expect(await stunned(), "Châtiment de stupeur : Étourdi");
      const steps = [["tour du Zombi", true], ["tour suivant du Paladin", true], ["fin du tour suivant du Paladin", false]];
      for ( const [label, want] of steps ) {
        await ctx.call("next-turn", { combatId: ctx.ownCombat });
        await pause(2500);
        ctx.expect((await stunned()) === want, `Châtiment de stupeur : ${label} → ${want ? "toujours Étourdi" : "plus Étourdi"}`);
      }
    });

    await part("Repli expéditif", async () => {
      const id = await lend("phbsplExpeditiou")(mage);
      if ( !ctx.expect(await fight(mage, zombi), "Repli expéditif : tour du Magicien") ) return;
      await ctx.use({ tokenId: mage.id, itemId: id, targetTokenIds: [mage.id], consume: false });
      await pause(1500);
      const b = await ctx.engine("budget", { tokenId: mage.id });
      ctx.expect(b?.dashed === true, `Repli expéditif : Foncer pris (action Bonus ${b?.bonus}, action ${b?.action})`);
    });
  }
};
