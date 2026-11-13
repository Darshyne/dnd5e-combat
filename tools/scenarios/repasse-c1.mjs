/**
 * §295, lot C1 de la repasse terme par terme : corrections déclaratives, jouées dans l'Arène des sorts (Lanceur, Allié, Cible, Héros).
 * Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source, comme un item tiré du compendium) et remet tout.
 *  - Moquerie cruelle : la marque tombe à la fin du prochain tour de la CIBLE, pas à celle du lanceur ;
 *  - Bouclier lancé au tour d'un ennemi : l'effet tombe au début du tour du lanceur ;
 *  - Agrandissement/rapetissement sur l'Allié : il consent, rate d'office, un seul des deux effets ;
 *  - Perturbations synaptiques : la Cible qui a raté rejoue sa sauvegarde à la fin de son tour ;
 *  - Présence intimidante : Effrayé pour une minute (la donnée : un round) ;
 *  - Maléfice du protecteur Grand Ancien : reconnu comme Maléfice — un seul effet au choix, 1d6 nécrotique au coup ;
 *  - Forme gazeuse : Vitesse au sol nulle, vol de 3 m ;
 *  - Quête ratée : aucun dégât au lancement ; Contact avec les plans réussi : aucun dégât ;
 *  - Protégé de dame Nature : immunité à Empoisonné ;
 *  - Credo accru : le Déluge de coups ouvre trois frappes.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c1 — corrections déclaratives de la repasse (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Cible", "Héros"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, target, hero] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, target, hero];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));

    const lent = [];
    /** Un item du Manuel prêté avec sa source (`flags.dnd5e.sourceId`) : reconnu comme l'item tiré du compendium. */
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    const unlend = async () => { for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {}); };
    const clearEffects = async () => {
      for ( const t of all ) for ( const e of (await ctx.call("get-actor", { actorId: t.actorId })).effects ?? [] ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await unlend();
      await clearEffects();
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const settled = async used => (used?.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 40000 }).catch(() => null) : null);
    const failed = r => r?.targets?.[0]?.save?.success === false;
    const succeeded = r => r?.targets?.[0]?.save?.success === true;
    /** Pendant `action`, répond aux fenêtres du MJ : le premier bouton de la règle qui correspond, sinon le premier bouton. */
    const answering = async (rules, action) => {
      const known = new Set(((await ctx.call("list-dialogs", {}).catch(() => null))?.windows ?? []).map(w => w.id));
      const seen = [];
      let done = false;
      const result = action().finally(() => { done = true; });
      for ( let after = 0; after < 5; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1200, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          known.add(d.id);
          const text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
          const rule = rules.find(([re]) => re.test(text));
          const b = rule ? ((d.buttons ?? []).find(x => rule[1].test(`${x.action ?? ""} ${x.label ?? ""}`)) ?? (d.buttons ?? [])[0]) : (d.buttons ?? [])[0];
          if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
          seen.push({ text: text.slice(0, 80), answered: b?.label ?? b?.action ?? null });
        }
        if ( done ) after++;
      }
      return { result: await result, seen };
    };
    const combatOf = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    /** Combat dans cet ordre d'initiative, le premier à jouer. */
    const startFight = async order => {
      await ctx.startCombat(order);
      const c = await combatOf();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; i < 6; i++ ) {
        const now = await combatOf();
        if ( now.combatants?.find(x => x.id === now.currentCombatantId)?.tokenId === order[0].id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200);
      }
    };
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3500); };
    const has = async (t, id) => (await ctx.effectsFrom(t, id)).length > 0;
    /** Utilise jusqu'à obtenir la sauvegarde voulue (les jets sont aléatoires). */
    const until = async (want, params, tries=15) => {
      for ( let n = 1; n <= tries; n++ ) {
        const used = await ctx.use(params);
        const r = await settled(used);
        if ( want(r) ) return { used, r };
        await clearEffects(); await pause(500);
      }
      return null;
    };

    await part("Moquerie cruelle", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplViciousMoc`, { "system.method": "atwill" });
      await startFight([caster, target, ally]);
      const got = await until(failed, { tokenId: caster.id, itemId: spell, activityType: "save", targetTokenIds: [target.id] });
      ctx.expect(!!got && await has(target, "vicious-mockery"), "Moquerie : la Cible rate et porte la marque");
      await next();   // tour de la Cible
      ctx.expect(await has(target, "vicious-mockery"), "Moquerie : la marque tient pendant le tour de la Cible");
      await next();   // fin du tour de la Cible
      ctx.expect(!await has(target, "vicious-mockery"), "Moquerie : la marque tombe à la fin du prochain tour de la Cible");
    });

    await part("Bouclier", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplShield0000`, { "system.method": "atwill" });
      await startFight([target, caster, ally]);
      await settled(await ctx.use({ tokenId: caster.id, itemId: spell, targetTokenIds: [caster.id] }));
      await pause(800);
      ctx.expect(await has(caster, "shield"), "Bouclier : effet posé au tour de la Cible");
      await next();   // début du tour du Lanceur
      ctx.expect(!await has(caster, "shield"), "Bouclier : l'effet tombe au début du tour du Lanceur");
    });

    await part("Agrandissement sur un allié consentant", async () => {
      // §435 : les boutons du moteur sont « unwilling » puis « willing » (runtime/engine.mjs, question « consentant ? ») ; l'ancien motif
      // (« oui / yes / fail… ») n'en reconnaissait aucun : le premier, « pas consentant », était cliqué, et un Allié qui réussissait sa
      // sauvegarde ne portait rien (une passe sur deux). Le bouton est choisi par son id : `^willing`.
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplEnlargeRed`, { "system.method": "atwill" });
      const { seen } = await answering([[/consent|willing/i, /^willing\b/i]],
        async () => settled(await ctx.use({ tokenId: caster.id, itemId: spell, activityType: "save", targetTokenIds: [ally.id] })));
      const effects = await ctx.effectsFrom(ally, "enlarge-reduce");
      ctx.expect(effects.length === 1, `Agrandissement : l'Allié porte un seul effet (${effects.map(e => e.effect).join(", ")} ; fenêtres : ${seen.map(s => s.text).join(" | ")})`);
    });

    await part("Perturbations synaptiques", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplSynapticSt`, { "system.method": "atwill" });
      const c = await ctx.position(target);
      // §435 : la zone prend aussi le Lanceur (et la Cible voisine) — la sauvegarde lue est celle de la Cible, pas celle du premier de la
      // liste (le Lanceur, qui réussit souvent : quinze lancers sans « raté » lu).
      const cibleFailed = r => r?.targets?.find(t => t.name === "Cible")?.save?.success === false;
      const got = await until(cibleFailed, { tokenId: caster.id, itemId: spell, activityType: "save", targetTokenIds: [target.id],
        area: { shape: "circle", x: c.x + ARENE_SORTS.grid / 2, y: c.y + ARENE_SORTS.grid / 2, radius: ARENE_SORTS.grid * 4 } });
      ctx.expect(!!got && await has(target, "synaptic-static"), "Perturbations : la Cible rate et porte l'effet");
      await startFight([target, caster]);
      const since = await ctx.lastMessageId();
      await next();   // fin du tour de la Cible
      await pause(3000);
      const resave = (await ctx.messagesSince(since)).some(m => m.flags?.["dnd5e-combat"]?.resave);
      ctx.expect(resave, "Perturbations : sauvegarde rejouée à la fin du tour de la Cible");
    });

    await part("Présence intimidante", async () => {
      const item = await lend(hero, `${PHB}.classes.Item.phbbrbIntimidati`, { "system.uses.spent": 0 });
      const h = await ctx.position(hero);
      await ctx.call("move-token", { tokenId: target.id, x: h.x + ARENE_SORTS.grid, y: h.y, elevation: 0 });
      await pause(800);
      const got = await until(failed, { tokenId: hero.id, itemId: item, activityType: "save", targetTokenIds: [target.id],
        area: { shape: "circle", x: h.x + ARENE_SORTS.grid / 2, y: h.y + ARENE_SORTS.grid / 2, radius: ARENE_SORTS.grid * 6 } });
      const fx = got ? (await ctx.call("get-actor", { actorId: target.actorId })).effects?.find(e => (e.statuses ?? []).includes("frightened")) : null;
      ctx.expect(!!fx && (fx.duration?.seconds === 60 || fx.duration?.value === 60), `Présence intimidante : Effrayé pour une minute (${JSON.stringify(fx?.duration ?? null)})`);
    });

    await part("Maléfice du Grand Ancien", async () => {
      const hex = await lend(caster, `${PHB}.classes.Item.n2qsI3p9HBVQIjeK`, { "system.method": "atwill" });
      const ident = await ctx.engine("identify", { tokenId: caster.id });
      const row = (ident?.items ?? ident ?? []).find?.(i => i.id === hex || i.itemId === hex);
      ctx.expect(!row || row.identifier === "hex" || row.id === "hex", `Maléfice (Grand Ancien) reconnu comme « hex » (${JSON.stringify(row ?? null).slice(0, 160)})`);
      const { seen } = await answering([[/./, /./]], async () =>
        settled(await ctx.use({ tokenId: caster.id, itemId: hex, activityId: "Btl8HmGdooXEh2gP", targetTokenIds: [target.id] })));
      await pause(1000);
      const effects = await ctx.effectsFrom(target, "hex");
      ctx.expect(effects.length === 1, `Maléfice (Grand Ancien) : un seul effet posé (${effects.map(e => e.effect).join(", ")} ; fenêtres : ${seen.length})`);
    });

    await part("Forme gazeuse", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplGaseousFor`, { "system.method": "atwill" });
      await settled(await ctx.use({ tokenId: caster.id, itemId: spell, targetTokenIds: [caster.id] }));
      await pause(1000);
      // Valeurs préparées (effets compris), lues dans le client du MJ.
      const stats = await ctx.engine("stats", { tokenId: caster.id }).catch(() => null);
      const walk = stats?.speeds?.walk ?? stats?.speed?.walk;
      const fly = stats?.speeds?.fly ?? stats?.speed?.fly;
      ctx.expect(await has(caster, "gaseous-form"), "Forme gazeuse posée");
      ctx.expect(Number(walk) === 0 && Number(fly) === 10, `Forme gazeuse : au sol 0, vol 10 (lu : ${walk} / ${fly})`);
    });

    await part("Quête et Contact avec les plans", async () => {
      const geas = await lend(caster, `${PHB}.spells.Item.phbsplGeas000000`, { "system.method": "atwill" });
      const got = await until(failed, { tokenId: caster.id, itemId: geas, activityType: "save", targetTokenIds: [target.id] });
      await pause(1500);
      ctx.expect(!!got && (await ctx.hp(target)) === 999, `Quête ratée : aucun dégât au lancement (PV ${await ctx.hp(target)})`);
      const contact = await lend(caster, `${PHB}.spells.Item.phbsplContactOth`, { "system.method": "atwill" });
      const ok = await until(succeeded, { tokenId: caster.id, itemId: contact, activityType: "save", targetTokenIds: [caster.id] });
      await pause(1500);
      ctx.expect(!!ok && (await ctx.hp(caster)) === 999, `Contact avec les plans réussi : aucun dégât (PV ${await ctx.hp(caster)})`);
    });

    await part("Protégé de dame Nature", async () => {
      await lend(caster, `${PHB}.classes.Item.phbdrdNaturesWar`);
      let ci = [];
      for ( let n = 0; (n < 10) && !ci.includes("poisoned"); n++ ) {
        await pause(800);
        const a = await ctx.call("get-actor", { actorId: caster.actorId });
        ci = (a.effects ?? []).flatMap(e => (e.changes ?? e.system?.changes ?? []).filter(c => c.key === "system.traits.ci.value").map(c => c.value));
      }
      ctx.expect(ci.includes("poisoned"), `Protégé de dame Nature : immunité à Empoisonné (${ci.join(", ")})`);
    });

    await part("Credo accru", async () => {
      const focus = await lend(hero, `${PHB}.classes.Item.phbmnkMonksFocus`, { "system.uses.max": "9", "system.uses.spent": 0 });
      await lend(hero, `${PHB}.classes.Item.phbmnkHeightened`);
      await startFight([hero, target]);
      await settled(await ctx.use({ tokenId: hero.id, itemId: focus, activityId: "2ghJTBhilLrFn9xT", consume: true }));
      await pause(2000);
      const b = await ctx.engine("budget", { tokenId: hero.id });
      ctx.expect(b?.flurry === 3, `Credo accru : trois frappes ouvertes au Déluge de coups (budget : ${b?.flurry})`);
    });
  }
};
