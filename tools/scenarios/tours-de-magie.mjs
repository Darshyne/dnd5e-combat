/**
 * Tours de magie (SPEC §23), monde `dnd-6`. Le Magicien reçoit, prêtés depuis le compendium du Manuel des joueurs, Contact
 * glacial, Éclat mental, Poigne électrique, Glas, Amitié et Frappe assurée (il a Rayon de givre). Le Bandit reçoit 300 PV.
 * Vérifie :
 *  - Rayon de givre : la Vitesse du Bandit baisse de 10 ft, et revient au début du tour suivant du Magicien (pas avant) ;
 *  - Contact glacial : un soin ne rend rien au Bandit ; à la fin du tour suivant du Magicien, l'effet tombe et le soin agit ;
 *  - Éclat mental : sauvegarde d'Intelligence ratée → la sauvegarde suivante du Bandit porte « -1d4 », puis l'effet tombe ;
 *  - Poigne électrique : touché, le Bandit ne menace plus d'attaque d'opportunité le Magicien qui s'éloigne ;
 *  - Glas : contre le Bandit blessé, d12 même avec l'activité « Healthy Target » ; contre le Bandit indemne, d8 même avec « Damaged » ;
 *  - Amitié : le Zombi (mort-vivant) n'est pas affecté ; le Bandit charmé, puis blessé → l'effet tombe ;
 *  - Frappe assurée : la dague enchantée ; son attaque ; l'enchantement tombe après elle.
 * Pose la distribution de référence de Restored Keep (tools/lib/stages.mjs) : le Bandit se place par rapport au Magicien.
 * Remet positions, PV, effets ; retire les sorts prêtés.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const SPELLS = "dnd-players-handbook.spells";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "tours de magie — Rayon de givre, Contact glacial, Éclat mental, Poigne électrique, Glas, Amitié, Frappe assurée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(SPELLS) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    // Les cibles sont placées par rapport au Magicien : on pose la distribution de référence
    // (les autres tokens compris : un voisin sur une case d'arrivée ou sur la ligne de vue fausse tout), remise à la fin.
    await ctx.stage(RESTORED_KEEP);
    const mage = await ctx.token("Magicien");
    const bandit = await ctx.token("Bandit");
    const zombi = tokens.find(t => (t.name === "Zombi") && (t.level === mage.level) && !t.hidden) ?? null;
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [mage, bandit, zombi].filter(Boolean) ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const m = homes.get(mage.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = (value=300) => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": value } });

    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const near = () => place(bandit, m.x + grid, m.y);
    const far = () => place(bandit, m.x, m.y - 3 * grid);
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeStatusEffects(t, "charmed");
        await ctx.removeEffectsNamed(t, /Reduced Movement|Mouvement réduit|Blocked Healing|Soins bloqués|Slivered|Shocked|Charmed|Charmé|Éclat|Poigne|Contact/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const spell = id => ctx.ensureItem(mage, `Compendium.${SPELLS}.Item.${id}`);
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
      await ctx.startCombat([mage, bandit]);
      const combat = await state();
      for ( const [t, v] of [[mage, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== mage.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === mage.id;
    };
    const next = async () => { await ctx.nextTurn(); await pause(2500); };
    const use = async (itemId, target, extra={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: mage.id, itemId, targetTokenIds: target ? [target.id] : [], ...extra });
      const r = u.usageMessageId ? await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const t = r?.targets?.find(x => x.name === target?.name);
      return { r, t, hit: t?.hit ?? null, failed: t?.save ? !t.save.success : null,
        damage: (msgs.find(x => x.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ") };
    };
    const until = async (fn, ok, tries=20) => { for ( let i = 0; i < tries; i++ ) { const a = await fn(); if ( ok(a) ) return a; } return null; };
    const stats = t => ctx.engine("stats", { tokenId: t.id });
    const hasEffect = async (t, re) => (await ctx.effects(t)).some(e => re.test(e.name ?? ""));
    /** Un effet posé depuis cet effet d'item (copie du plateau : `_stats.duplicateSource`). */
    const fromEffect = async (t, id) => (await ctx.effects(t)).some(e => String(e._stats?.duplicateSource ?? e._stats?.compendiumSource ?? "").endsWith(`.ActiveEffect.${id}`));

    const frost = await ctx.itemId(mage.id, "ray-of-frost");
    await part("Rayon de givre", async () => {
      await tough(); await far();
      if ( !ctx.expect(await fight(), "combat : au tour du Magicien") ) return;
      const speed0 = (await stats(bandit))?.speed?.walk;
      const a = await until(() => use(frost, bandit, { activityType: "attack" }), x => x.hit);
      if ( !ctx.expect(!!a, "Rayon de givre : touché (20 essais au plus)") ) return;
      ctx.expect((await stats(bandit))?.speed?.walk === speed0 - 10, `Vitesse ${speed0} → ${(await stats(bandit))?.speed?.walk}`);
      await next();   // tour du Bandit
      ctx.expect((await stats(bandit))?.speed?.walk === speed0 - 10, "tour du Bandit : toujours ralenti");
      await next();   // début du tour suivant du Magicien
      ctx.expect((await stats(bandit))?.speed?.walk === speed0, `début du tour suivant du Magicien : Vitesse ${(await stats(bandit))?.speed?.walk}`);
    });

    const chill = await spell("phbsplChillTouch");
    await part("Contact glacial", async () => {
      await tough(200); await near();
      if ( !ctx.expect(await fight(), "combat : au tour du Magicien") ) return;
      const a = await until(() => use(chill, bandit, { activityType: "attack" }), x => x.hit);
      if ( !ctx.expect(!!a, "Contact glacial : touché (20 essais au plus)") ) return;
      const h1 = await ctx.engine("heal", { tokenId: bandit.id, amount: 5 });
      ctx.expect(h1.after === h1.before, `soin bloqué (${h1.before} → ${h1.after})`);
      await next(); await next();   // tour du Bandit, puis tour suivant du Magicien
      ctx.expect(await fromEffect(bandit, "zwks0mAqBHGZC1Pk"), "au début du tour suivant du Magicien : toujours bloqué");
      await next();   // fin du tour suivant du Magicien
      ctx.expect(!(await fromEffect(bandit, "zwks0mAqBHGZC1Pk")), "à la fin de son tour suivant : l'effet tombe");
      const h2 = await ctx.engine("heal", { tokenId: bandit.id, amount: 5 });
      ctx.expect(h2.after === h2.before + 5, `le soin agit de nouveau (${h2.before} → ${h2.after})`);
    });

    const sliver = await spell("phbsplMindSliver");
    await part("Éclat mental", async () => {
      // En combat : hors combat, V14 expire l'effet d'« 1 round » dès que l'heure du monde bouge (SPEC §23).
      await tough(); await far();
      if ( !ctx.expect(await fight(), "combat : au tour du Magicien") ) return;
      const a = await until(() => use(sliver, bandit, { activityType: "save" }), x => x.failed === true);
      if ( !ctx.expect(!!a, "Éclat mental : sauvegarde ratée (20 essais au plus)") ) return;
      let slivered = false;
      for ( const stop = Date.now() + 5000; !slivered && (Date.now() < stop); await pause(500) ) slivered = await fromEffect(bandit, "DMjD7IpAZuoVPCXY");
      if ( !ctx.expect(slivered, "le Bandit porte l'Éclat mental") ) { for ( const l of (await ctx.engineLog()).slice(-12) ) ctx.log(l.slice(0, 200)); }
      const s = await ctx.engine("rollSave", { tokenId: bandit.id, ability: "dex" });
      ctx.expect(/1d4/.test(s.formula ?? ""), `sa sauvegarde suivante : « ${s.formula} »`);
      await pause(1500);
      ctx.expect(!(await fromEffect(bandit, "DMjD7IpAZuoVPCXY")), "l'effet tombe à cette sauvegarde");
    });

    const grasp = await spell("phbsplShockingGr");
    await part("Poigne électrique", async () => {
      await tough(); await near();
      if ( !ctx.expect(await fight(), "combat : au tour du Magicien") ) return;
      const away = { x: m.x - 2 * grid + grid / 2, y: m.y + grid / 2 };
      const before = await ctx.engine("threats", { tokenId: mage.id, point: away });
      ctx.expect(before.includes("Bandit"), `avant : le Bandit menace le Magicien qui s'éloigne (${before.join(", ") || "personne"})`);
      const a = await until(() => use(grasp, bandit, { activityType: "attack" }), x => x.hit);
      if ( !ctx.expect(!!a, "Poigne électrique : touché (20 essais au plus)") ) return;
      const after = await ctx.engine("threats", { tokenId: mage.id, point: away });
      ctx.expect(!after.includes("Bandit"), `après : plus de menace du Bandit (${after.join(", ") || "personne"})`);
    });

    const toll = await spell("phbsplTolltheDea");
    await part("Glas", async () => {
      await far();
      await tough(250);
      const hurt = await until(() => use(toll, bandit, { activityType: "save", activityId: "LFXYm5sLg6D3ZilN" }), x => x.failed === true);
      ctx.expect(!!hurt && /d12/.test(hurt.damage), `blessé, activité « Healthy Target » : « ${hurt?.damage} »`);
      const fresh = await until(async () => { await tough(300); return use(toll, bandit, { activityType: "save", activityId: "w9KUTNVoj3K8XSlv" }); }, x => x.failed === true);
      ctx.expect(!!fresh && /d8/.test(fresh.damage) && !/d12/.test(fresh.damage), `indemne, activité « Damaged Target » : « ${fresh?.damage} »`);
    });

    const friends = await spell("phbsplFriends000");
    await part("Amitié", async () => {
      await tough(); await place(bandit, m.x + grid, m.y);
      if ( zombi ) {
        const z = await use(friends, zombi, { activityType: "save" });
        ctx.expect(!!z.t?.unaffected, `le Zombi (mort-vivant) n'est pas affecté (${JSON.stringify(z.t?.unaffected ?? null)})`);
      }
      const a = await until(() => use(friends, bandit, { activityType: "save" }), x => x.failed === true);
      if ( !ctx.expect(!!a, "Amitié : sauvegarde ratée (20 essais au plus)") ) return;
      let charmed = false;
      for ( const stop = Date.now() + 5000; !charmed && (Date.now() < stop); await pause(500) ) charmed = (await stats(bandit))?.statuses?.includes("charmed");
      ctx.expect(charmed, "le Bandit est Charmé");
      await ctx.engine("hurt", { tokenId: bandit.id, amount: 5 });
      await pause(2500);
      ctx.expect(!(await stats(bandit))?.statuses?.includes("charmed"), "blessé : le charme tombe");
    });

    const trueStrike = await spell("phbsplTrueStrike");
    const dagger = await ctx.itemId(mage.id, "dagger");
    await part("Frappe assurée", async () => {
      await tough(); await near();
      const daggerUuid = `Actor.${mage.actorId}.Item.${dagger}`;
      await use(trueStrike, null, { usageConfig: { [MODULE_ID]: { enchantItem: daggerUuid } } });
      await pause(2000);
      const enchanted = async () => ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === dagger)?.effects?.length ?? 0;
      let on = 0;
      for ( const stop = Date.now() + 20000; !on && (Date.now() < stop); await pause(500) ) on = await enchanted();
      if ( !ctx.expect(on > 0, "la dague est enchantée") ) {
        return;
      }
      const a = await use(dagger, bandit, { activityType: "attack", usageConfig: { [MODULE_ID]: { cost: "free" } } });
      ctx.expect(a.hit !== null, `attaque de la dague : ${a.hit ? `touché « ${a.damage} »` : "raté"}`);
      await pause(1500);
      ctx.expect((await enchanted()) === 0, "l'enchantement tombe après l'attaque");
    });
  }
};
