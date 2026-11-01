/**
 * §308, sous-lot C12-e de la repasse terme par terme : sauvegardes, Avantage, dés ajoutés. Arène des sorts (Lanceur, Cible, Héros).
 * Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Coup brutal : le Héros (Barbare passé niveau 9) téméraire choisit Coup handicapant — le jet n'a pas l'Avantage ; sur un coup, la
 *    Cible porte « Hamstrung » et la marque du Coup brutal tombe ;
 *  - Tactiques défensives : touchée par le Lanceur, la Cible lui impose le Désavantage à ses autres attaques contre elle ce tour-ci ;
 *  - Maléfice occulte : l'effet de Maléfice (Sagesse) posé par un lanceur qui a l'aptitude donne le Désavantage aux sauvegardes de
 *    Sagesse ; sans l'aptitude, non ;
 *  - Mot de pouvoir étourdissant : la Cible à 100 PV est Étourdie ; à la fin de son tour, une sauvegarde de Constitution est rejouée ;
 *  - Fragilisation occulte : un coup d'arme du Lanceur marque la Cible ; sa sauvegarde contre la Flamme sacrée du Lanceur a le
 *    Désavantage, et la marque tombe ;
 *  - Vision ombreuse : dans une région d'obscurité, la Cible n'est plus vue par le Lanceur à vision dans le noir.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c12e — Coup brutal, Défense multiattaque, Maléfice occulte, Mot de pouvoir étourdissant, Fragilisation occulte, Vision ombreuse",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Héros"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target, hero] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, target, hero] ) homes.set(t.id, await ctx.position(t));
    const { sceneId } = await ctx.scene();

    const lent = [];
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    const extra = [];
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const fn of extra.splice(0) ) await fn().catch(() => {});
      for ( const t of [caster, target, hero] ) {
        for ( const e of await ctx.effects(t) ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
        }
        for ( const s of ["stunned", "prone", "invisible"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        await ctx.setHp(t, 999).catch(() => {});
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
      }
      await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "flags.dnd5e-combat.recklessTurn": null, "flags.dnd5e-combat.brutalTurn": null } }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async (first, other) => {
      await ctx.startCombat([first, other]);
      const c = await state();
      for ( const [t, v] of [[first, 20], [other, 10]] ) await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== first.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === first.id;
    };
    const attack = async (attacker, itemId, victim, usage={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [victim.id], usageConfig: { [MODULE_ID]: usage } });
      const r = u?.usageMessageId ? await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      return { hit: r?.targets?.find(t => t.name === victim.name)?.hit ?? null,
        mode: msgs.find(m => m.type === "attack")?.rolls?.[0]?.options?.advantageMode ?? null,
        damage: (msgs.find(m => m.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ") };
    };
    const changesOf = e => (e.system?.changes ?? e.changes ?? []).map(c => c.key);

    await part("Coup brutal", async () => {
      await ctx.call("move-token", { tokenId: hero.id, x: homes.get(target.id).x - grid, y: homes.get(target.id).y, elevation: 0 });
      await pause(800);
      const cls = await ctx.itemId(hero.id, "barbarian");
      const levels = ((await ctx.call("get-actor", { actorId: hero.actorId })).items ?? []).find(i => i._id === cls)?.system?.levels ?? 1;
      await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.levels": 9 }, match: { path: "_id", value: cls } });
      extra.push(() => ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.levels": levels }, match: { path: "_id", value: cls } }));
      await lend(hero, `${PHB}.classes.Item.phbbrbRecklessAt`);
      await lend(hero, `${PHB}.classes.Item.phbbrbBrutalStri`);
      const axe = await ctx.itemId(hero.id, "greataxe");
      if ( !ctx.expect(await fight(hero, target), "combat : au tour du Héros") ) return;
      let a = null;
      for ( let i = 0; i < 12; i++ ) {
        await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "flags.dnd5e-combat.brutalTurn": null } });
        a = await attack(hero, axe, target, { reckless: true, brutal: ["hamstring"] });
        ctx.expect(a.mode !== 1, `essai ${i + 1} : le jet n'a pas l'Avantage (mode ${a.mode})`);
        if ( a.hit ) break;
      }
      if ( !ctx.expect(a?.hit === true, "le Coup brutal touche (12 essais)") ) return;
      ctx.log(`dégâts : ${a.damage}`);
      await pause(1500);
      const effects = await ctx.effects(target);
      ctx.expect(effects.some(e => changesOf(e).includes("system.attributes.movement.speed") || /Hamstrung|handicap/i.test(e.name)), `la Cible porte « Hamstrung » (${effects.map(e => e.name).join(", ")})`);
      // La marque tombe à la résolution, sur le MJ actif : attendue (6 s au plus) plutôt qu'une pause fixe.
      let dropped = false;
      for ( let n = 0; (n < 12) && !dropped; n++ ) { dropped = !(await ctx.effects(hero)).some(e => e.flags?.[MODULE_ID]?.brutalStrike); if ( !dropped ) await pause(500); }
      ctx.expect(dropped, "la marque du Coup brutal tombe après l'attaque");
      // Sans Coup brutal, la Témérité donne bien l'Avantage.
      const b = await attack(hero, axe, target, { reckless: true, brutal: false });
      ctx.expect(b.mode === 1, `attaque suivante, sans Coup brutal : Avantage de la Témérité (mode ${b.mode})`);
    });

    await part("Tactiques défensives", async () => {
      await lend(target, `${PHB}.classes.Item.phbrgrDefensiveT`);
      const club = await lend(caster, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      await ctx.call("move-token", { tokenId: caster.id, x: homes.get(target.id).x - grid, y: homes.get(target.id).y, elevation: 0 });
      await pause(800);
      const before = await ctx.engine("attackReasons", { attackerId: caster.id, targetId: target.id, itemId: club });
      let a = null;
      for ( let i = 0; (i < 12) && !a?.hit; i++ ) a = await attack(caster, club, target);
      if ( !ctx.expect(a?.hit === true, "le Lanceur touche la Cible (12 essais)") ) return;
      await pause(1500);
      const after = await ctx.engine("attackReasons", { attackerId: caster.id, targetId: target.id, itemId: club });
      ctx.expect(after.disadvantage.length > before.disadvantage.length, `après le coup : Désavantage contre la Cible (${after.disadvantage.join(", ") || "rien"})`);
      const other = await ctx.engine("attackReasons", { attackerId: hero.id, targetId: target.id, itemId: await ctx.itemId(hero.id, "greataxe") });
      ctx.expect(!other.disadvantage.some(d => after.disadvantage.includes(d) && !before.disadvantage.includes(d)), "un autre attaquant n'a pas ce Désavantage");
    });

    await part("Maléfice occulte", async () => {
      const hex = await lend(caster, `${PHB}.spells.Item.phbsplHex0000000`, { "system.method": "atwill" });
      const wisKey = "system.abilities.wis.save.roll.mode";
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: hex, effectId: "k2569xtIeXKRReLU" });
      await pause(1200);
      const plain = (await ctx.effects(target)).find(e => /Hex|Maléfice/i.test(e.name));
      ctx.expect(!!plain && !changesOf(plain).includes(wisKey), `sans Maléfice occulte : pas de Désavantage de sauvegarde (${plain ? changesOf(plain).join(", ") : "effet absent"})`);
      if ( plain ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: target.actorId, effectId: plain._id }).catch(() => {});
      await lend(caster, `${PHB}.classes.Item.phbwlkEldritchHe`);
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: hex, effectId: "k2569xtIeXKRReLU" });
      await pause(1200);
      const cursed = (await ctx.effects(target)).find(e => /Hex|Maléfice/i.test(e.name));
      ctx.expect(!!cursed && changesOf(cursed).includes(wisKey), `avec Maléfice occulte : Désavantage aux sauvegardes de Sagesse (${cursed ? changesOf(cursed).join(", ") : "effet absent"})`);
    });

    await part("Mot de pouvoir étourdissant", async () => {
      const stun = await lend(caster, `${PHB}.spells.Item.phbsplPowerWordS`, { "system.method": "atwill" });
      await ctx.setHp(target, 100);
      await pause(800);
      if ( !ctx.expect(await fight(caster, target), "combat : au tour du Lanceur") ) return;
      const used = await ctx.use({ tokenId: caster.id, itemId: stun, targetTokenIds: [target.id], consume: false });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(2000);
      const stunned = async () => ((await ctx.engine("stats", { tokenId: target.id }))?.statuses ?? []).includes("stunned");
      if ( !ctx.expect(await stunned(), "la Cible à 100 PV est Étourdie") ) return;
      await ctx.nextTurn(); await pause(2000);   // tour de la Cible
      const since = await ctx.lastMessageId();
      await ctx.nextTurn(); await pause(6000);   // fin de son tour
      const msgs = await ctx.messagesSince(since);
      const card = msgs.find(m => m.flags?.[MODULE_ID]?.resave);
      ctx.expect(!!card, "à la fin de son tour, la sauvegarde est rejouée");
      const save = msgs.find(m => (m.type === "save") || (m.flags?.dnd5e?.roll?.type === "save"));
      const ability = save?.flags?.dnd5e?.roll?.ability ?? save?.rolls?.[0]?.options?.ability ?? null;
      ctx.expect(!save || (ability === "con") || (ability === null), `sauvegarde de Constitution (${ability ?? "caractéristique non lue"})`);
      ctx.log(`après la sauvegarde : ${(await stunned()) ? "toujours Étourdie" : "plus Étourdie"}`);
    });

    await part("Fragilisation occulte", async () => {
      await lend(caster, `${PHB}.classes.Item.phbftrEldritchSt`);
      const club = await lend(caster, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      const flame = await lend(caster, `${PHB}.spells.Item.phbsplSacredFlam`);
      await ctx.call("move-token", { tokenId: caster.id, x: homes.get(target.id).x - grid, y: homes.get(target.id).y, elevation: 0 });
      await pause(800);
      let a = null;
      for ( let i = 0; (i < 12) && !a?.hit; i++ ) a = await attack(caster, club, target);
      if ( !ctx.expect(a?.hit === true, "le Lanceur touche la Cible d'une arme (12 essais)") ) return;
      await pause(1500);
      const marked = async () => (await ctx.effects(target)).some(e => e.flags?.[MODULE_ID]?.eldritchStrike);
      ctx.expect(await marked(), "la Cible porte la marque de Fragilisation occulte");
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: caster.id, itemId: flame, activityType: "save", targetTokenIds: [target.id], consume: false });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(2000);
      const save = (await ctx.messagesSince(since)).find(m => m.flags?.dnd5e?.roll?.type === "save" || m.type === "save");
      const mode = save?.rolls?.[0]?.options?.advantageMode ?? null;
      ctx.expect(mode === -1, `la sauvegarde contre la Flamme sacrée a le Désavantage (mode ${mode})`);
      ctx.expect(!(await marked()), "la marque est consommée");
    });

    await part("Vision ombreuse", async () => {
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.attributes.senses.ranges.darkvision": 120 } });
      extra.push(() => ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.attributes.senses.ranges.darkvision": null } }));
      // Une région d'obscurité ne donne que de la lumière faible sous la lumière globale (crépuscule) : la lumière globale est éteinte
      // le temps de la partie, la scène est dans les ténèbres.
      const env = (await ctx.call("get-scene", { sceneId })).environment ?? {};
      const was = env.globalLight?.enabled ?? true;
      await ctx.call("update-scene", { sceneId, sceneData: { "environment.globalLight.enabled": false } });
      extra.push(() => ctx.call("update-scene", { sceneId, sceneData: { "environment.globalLight.enabled": was } }));
      await pause(2000);
      const before = await ctx.engine("sees", { observerId: caster.id, targetId: target.id });
      await lend(target, `${PHB}.classes.Item.phbrgrUmbralSigh`);
      await pause(1200);
      const after = await ctx.engine("sees", { observerId: caster.id, targetId: target.id });
      ctx.expect(before.sees === true, `sans Vision ombreuse, le Lanceur (vision dans le noir) voit la Cible dans l'obscurité (${before.sees})`);
      ctx.expect(after.sees === false, `avec Vision ombreuse, il ne la voit plus (${after.sees})`);
    });
  }
};
