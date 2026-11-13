/**
 * §438 : deux règles du Core avec les items du Manuel des joueurs 3.0.0 (prêtés depuis `dnd-players-handbook`). Arène des sorts (Lanceur,
 * Cible, Héros). Vérifie :
 *  - Coup brutal : l'échelle `@scale.barbarian.brutal-strike` n'existe plus (elle est sur l'aptitude, `@scale.brutal-strike.damage`) ;
 *    les dégâts du moteur restent 1d10 au niveau 9 et 2d10 au niveau 17, lus sur le niveau de Barbare ;
 *  - Affinité élémentaire : avec l'aptitude seule (forme 2.2.0, sans effet), le moteur ajoute le Charisme aux dégâts de feu d'un sort ;
 *    avec l'aptitude 3.0.0 du type (`elemental-affinity-fire`, dont l'effet ajoute déjà le Charisme), il ne l'ajoute plus.
 * Ne joue rien sans le Manuel 3.0.0 (l'aptitude `phbscrElemAffFir` n'existe pas avant). Remet niveaux, positions, PV, résistances,
 * effets ; retire les items prêtés.
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
  name: "phb3 — Manuel des joueurs 3.0.0 : dés du Coup brutal, Affinité élémentaire comptée une fois",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Héros"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const probe = await ctx.call("get-compendium-entry", { uuid: `${PHB}.classes.Item.phbscrElemAffFir` }).catch(() => null);
    if ( !probe?.data ) { ctx.log("Manuel des joueurs 3.0.0 absent (pas d'aptitude « Elemental Affinity: Fire ») : non applicable"); return; }
    const [caster, target, hero] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, target, hero] ) homes.set(t.id, await ctx.position(t));
    const tc = homes.get(target.id);

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
    const cls = await ctx.itemId(hero.id, "barbarian");
    const levels0 = ((await ctx.call("get-actor", { actorId: hero.actorId })).items ?? []).find(i => i._id === cls)?.system?.levels ?? 1;
    const setLevel = n => ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.levels": n }, match: { path: "_id", value: cls } });
    const dr0 = (await ctx.call("get-actor", { actorId: caster.actorId }))?.system?.traits?.dr?.value ?? [];
    const setDr = value => ctx.call("update-actor", { actorId: caster.actorId, actorData: { "system.traits.dr.value": value } });
    ctx.restore(() => setLevel(levels0).catch(() => {}));
    ctx.restore(() => setDr(dr0).catch(() => {}));

    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const t of [caster, target, hero] ) {
        for ( const e of await ctx.effects(t) ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
        }
        await ctx.call("set-status", { tokenId: t.id, statusId: "prone", active: false }).catch(() => {});
        await ctx.setHp(t, 999).catch(() => {});
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
      }
      await setLevel(levels0).catch(() => {});
      await setDr(dr0).catch(() => {});
      await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "flags.dnd5e-combat.recklessTurn": null, "flags.dnd5e-combat.brutalTurn": null } }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    /** Combat, au tour de `first` (20), puis les deux autres. */
    const fight = async first => {
      const order = [[first, 20], ...[hero, caster, target].filter(t => t !== first).map((t, i) => [t, 15 - 5 * i])];
      await ctx.startCombat(order.map(([t]) => t));
      const c = await state();
      for ( const [t, v] of order ) await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 4) && ((await current()) !== first.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === first.id;
    };
    const attack = async (attacker, itemId, victim, usage={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [victim.id], usageConfig: { [MODULE_ID]: usage } });
      const r = u?.usageMessageId ? await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(2000);
      const msgs = await ctx.messagesSince(since);
      const damage = msgs.find(m => m.type === "damage");
      return { hit: r?.targets?.find(t => t.name === victim.name)?.hit ?? null,
        damage: (damage?.rolls ?? []).map(x => x.formula).join(" | "),
        bonuses: (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => b.name ?? b.key ?? "") };
    };
    const untilHit = async (fn, tries=12) => { let a = null; for ( let i = 0; i < tries; i++ ) { a = await fn(); if ( a.hit ) return a; } return null; };

    await part("Coup brutal du Manuel 3.0.0 : 1d10 au niveau 9, 2d10 au niveau 17", async () => {
      for ( const [level, dice] of [[9, "1d10"], [17, "2d10"]] ) {
        await setLevel(level);
        await lend(hero, `${PHB}.classes.Item.phbbrbRecklessAt`);
        await lend(hero, `${PHB}.classes.Item.phbbrbBrutalStri`);
        await pause(500);
        const axe = await ctx.itemId(hero.id, "greataxe");
        await ctx.call("move-token", { tokenId: hero.id, x: tc.x - grid, y: tc.y, elevation: 0 });
        await pause(800);
        if ( !ctx.expect(await fight(hero), `niveau ${level} : combat au tour du Héros`) ) return;
        const a = await untilHit(async () => {
          await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "flags.dnd5e-combat.brutalTurn": null } });
          return attack(hero, axe, target, { reckless: true, brutal: ["hamstring"] });
        });
        if ( !ctx.expect(!!a, `niveau ${level} : le Coup brutal touche (12 essais)`) ) return;
        ctx.log(`niveau ${level} : dégâts « ${a.damage} »`);
        ctx.expect(a.damage.split(" | ").some(f => f.replace(/\s/g, "").includes(dice)) && !/@scale/.test(a.damage),
          `niveau ${level} : les dégâts portent ${dice} du Coup brutal (« ${a.damage} »)`);
        await reset();
      }
    });

    await part("Affinité élémentaire : le Charisme une seule fois avec l'aptitude 3.0.0", async () => {
      await setDr([...new Set([...dr0, "fire"])]);
      const bolt = await lend(caster, `${PHB}.spells.Item.phbsplFireBolt00`, { "system.method": "atwill" });
      await lend(caster, `${PHB}.classes.Item.phbscrElementalA`);
      await ctx.call("move-token", { tokenId: caster.id, x: tc.x - 3 * grid, y: tc.y, elevation: 0 });
      await pause(800);
      if ( !ctx.expect(await fight(caster), "combat : au tour du Lanceur") ) return;
      const named = list => list.some(n => /Elemental Affinity|Affinité/i.test(n));
      const plain = await untilHit(() => attack(caster, bolt, target));
      if ( !ctx.expect(!!plain, "témoin : le Trait de feu touche (12 essais)") ) return;
      ctx.log(`témoin : « ${plain.damage} », parts du moteur : ${plain.bonuses.join(", ") || "aucune"}`);
      ctx.expect(named(plain.bonuses), `aptitude seule (forme 2.2.0) : le moteur ajoute le Charisme (${plain.bonuses.join(", ") || "aucune part"})`);
      await lend(caster, `${PHB}.classes.Item.phbscrElemAffFir`);
      await pause(800);
      const both = await untilHit(() => attack(caster, bolt, target));
      if ( !ctx.expect(!!both, "le Trait de feu touche (12 essais)") ) return;
      ctx.log(`avec l'aptitude 3.0.0 : « ${both.damage} », parts du moteur : ${both.bonuses.join(", ") || "aucune"}`);
      ctx.expect(!named(both.bonuses), `avec « Elemental Affinity: Fire » : le moteur n'ajoute plus rien (${both.bonuses.join(", ") || "aucune part"})`);
    });
  }
};
