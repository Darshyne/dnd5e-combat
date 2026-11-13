/**
 * §434 : le Coup brutal du SRD de dnd5e 6.1 joué en jeu (§433, points 4 et 5). Arène des sorts (Lanceur, Cible, Héros). Le Héros (Barbare
 * pré-tiré) reçoit, prêtés depuis le compendium `dnd5e.classes24` (SRD 6.1, pas le Manuel), Témérité, Coup brutal — l'item unique qui porte
 * les quatre coups et leurs effets — et, au niveau 13, Coup brutal amélioré (vide dans cette donnée). Le Lanceur reçoit un gourdin et
 * Flamme sacrée du SRD 6.1. Vérifie :
 *  - niveau 9, Coup handicapant : la Cible porte « Hamstrung » une seule fois, sa Vitesse au sol baisse de 15 ft exactement (l'effet
 *    retire déjà 15 ft par `movement.bonus` ; le moteur n'ajoute pas son −15) ;
 *  - niveau 9, Coup chancelant demandé sans Coup brutal amélioré : rien n'est posé (l'option n'existe pas encore) ;
 *  - Coup puissant : la Cible est poussée de 15 ft (3 cases) ;
 *  - niveau 13, Coup chancelant : la Cible porte « Staggered » ; elle ne menace plus le Héros qui s'éloigne (pas d'attaque d'opportunité,
 *    témoin avant le coup) ; sa sauvegarde contre la Flamme sacrée du Lanceur a le Désavantage ;
 *  - niveau 13, Coup fendant : la Cible porte « Sundered » ; une seconde attaque du Héros n'a pas le +5 ; l'attaque du Lanceur l'a, et
 *    l'effet est consommé ;
 *  - niveau 17 (Coup brutal amélioré (2)) : deux effets à la fois, Staggered et Sundered.
 * Remet niveaux, positions, PV, effets ; retire les items prêtés.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e";
const EFFECTS = { hamstrung: "bg9jWpPRIJ0Q2vPY", staggered: "uacly0JAXLVwAS6y", sundered: "Q0ou16II1WEcCdyW" };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "srd61-barbare — Coup brutal du SRD 6.1 : handicapant, puissant, chancelant, fendant, deux effets",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Héros"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
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
    ctx.restore(() => setLevel(levels0).catch(() => {}));

    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const t of [caster, target, hero] ) {
        for ( const e of await ctx.effects(t) ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
        }
        for ( const s of ["stunned", "prone"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        await ctx.setHp(t, 999).catch(() => {});
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
      }
      await setLevel(levels0).catch(() => {});
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
    /** Combat : le Héros (20), le Lanceur (15), la Cible (10) ; au tour du Héros. */
    const fight = async () => {
      const order = [[hero, 20], [caster, 15], [target, 10]];
      await ctx.startCombat(order.map(([t]) => t));
      const c = await state();
      for ( const [t, v] of order ) await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 4) && ((await current()) !== hero.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === hero.id;
    };
    /** Les termes d'une formule d'attaque que la seconde a en plus de la première (« +5 »…), dés mis à part. */
    const terms = f => f.replace(/\s/g, "").split(/(?=[+-])/).filter(t => t && !/d20/.test(t));
    const extraTerms = (base, other) => {
      const left = terms(base);
      return terms(other).filter(t => { const i = left.indexOf(t); if ( i < 0 ) return true; left.splice(i, 1); return false; });
    };
    const attack = async (attacker, itemId, victim, usage={}) => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [victim.id], usageConfig: { [MODULE_ID]: usage } });
      const r = u?.usageMessageId ? await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const roll = msgs.find(m => m.type === "attack")?.rolls?.[0] ?? null;
      return { hit: r?.targets?.find(t => t.name === victim.name)?.hit ?? null, mode: roll?.options?.advantageMode ?? null,
        formula: roll?.formula ?? "", total: roll?.total ?? null };
    };
    /** Le Coup brutal du Héros (téméraire), jusqu'à toucher (12 essais). */
    const brutal = async (axe, options) => {
      let a = null;
      for ( let i = 0; i < 12; i++ ) {
        await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "flags.dnd5e-combat.brutalTurn": null } });
        a = await attack(hero, axe, target, { reckless: true, brutal: options });
        if ( a.hit ) break;
      }
      await pause(1500);
      return a?.hit ? a : null;
    };
    /** Les effets de la Cible copiés d'un effet de Coup brutal : la copie garde son effet source (`_stats.duplicateSource`) ou son nom. */
    const NAMES = { [EFFECTS.hamstrung]: /Hamstrung/i, [EFFECTS.staggered]: /Staggered/i, [EFFECTS.sundered]: /Sundered/i };
    const effectsOf = async id => (await ctx.effects(target)).filter(e => !e.disabled
      && (String(e._stats?.duplicateSource ?? "").endsWith(`.ActiveEffect.${id}`) || NAMES[id].test(e.name ?? "")));
    const walk = async t => (await ctx.engine("stats", { tokenId: t.id }))?.speed?.walk ?? null;
    /** Le Héros prêt : niveau, Témérité et Coup brutal du SRD 6.1, la grande hache. */
    const ready = async level => {
      await setLevel(level);
      await lend(hero, `${SRD}.classes24.Item.phbbrbRecklessAt`);
      await lend(hero, `${SRD}.classes24.Item.phbbrbBrutalStri`);
      if ( level >= 13 ) await lend(hero, `${SRD}.classes24.Item.phbbrbImpBrutalS`);
      if ( level >= 17 ) await lend(hero, `${SRD}.classes24.Item.phbbrbImp2Brutal`);
      await pause(500);
      return ctx.itemId(hero.id, "greataxe");
    };
    const placeHero = async (dx, dy) => { await ctx.call("move-token", { tokenId: hero.id, x: tc.x + dx * grid, y: tc.y + dy * grid, elevation: 0 }); await pause(800); };

    await part("Coup handicapant (niveau 9)", async () => {
      const axe = await ready(9);
      await placeHero(-1, 0);
      const speed0 = await walk(target);
      if ( !ctx.expect(await fight(), "combat : au tour du Héros") ) return;
      const a = await brutal(axe, ["hamstring"]);
      if ( !ctx.expect(!!a, "le Coup brutal touche (12 essais)") ) return;
      ctx.expect(a.mode !== 1, `le jet n'a pas l'Avantage de la Témérité (mode ${a.mode})`);
      const placed = await effectsOf(EFFECTS.hamstrung);
      ctx.expect(placed.length === 1, `la Cible porte « Hamstrung » une seule fois (${(await ctx.effects(target)).map(e => e.name).join(", ") || "aucun effet"})`);
      const speed = await walk(target);
      ctx.expect((speed0 !== null) && (speed === speed0 - 15), `Vitesse au sol de la Cible ${speed0} → ${speed} ft (−15 exactement, pas −30)`);
      const changes = (placed[0]?.system?.changes ?? placed[0]?.changes ?? []).map(c => `${c.key} ${c.type ?? c.mode} ${c.value}`);
      ctx.log(`changements de l'effet posé : ${changes.join(" ; ") || "aucun"}`);
    });

    await part("Coup chancelant sans Coup brutal amélioré (niveau 9)", async () => {
      const axe = await ready(9);
      await placeHero(-1, 0);
      if ( !ctx.expect(await fight(), "combat : au tour du Héros") ) return;
      const a = await brutal(axe, ["staggering"]);
      if ( !ctx.expect(!!a, "le Coup brutal touche (12 essais)") ) return;
      ctx.expect(!(await effectsOf(EFFECTS.staggered)).length, "niveau 9 : l'option n'existe pas, la Cible ne porte pas « Staggered »");
    });

    await part("Coup puissant", async () => {
      const axe = await ready(9);
      await placeHero(0, 1);   // sous la Cible : la poussée l'envoie vers le haut, cases libres
      if ( !ctx.expect(await fight(), "combat : au tour du Héros") ) return;
      const a = await brutal(axe, ["forceful"]);
      if ( !ctx.expect(!!a, "le Coup brutal touche (12 essais)") ) return;
      let at = await ctx.position(target);
      for ( let n = 0; (n < 10) && (at.y === tc.y); n++ ) { await pause(500); at = await ctx.position(target); }
      const cells = Math.round((tc.y - at.y) / grid);
      ctx.expect((cells === 3) && (at.x === tc.x), `la Cible est poussée de 3 cases (15 ft) loin du Héros (${cells} case(s), x ${tc.x} → ${at.x})`);
    });

    await part("Coup chancelant (niveau 13)", async () => {
      const axe = await ready(13);
      const flame = await lend(caster, `${SRD}.spells24.Item.phbsplSacredFlam`, { "system.method": "atwill" });
      // La Cible armée d'un gourdin : elle menace qui quitte son allonge (témoin avant le coup).
      await lend(target, `${SRD}.equipment24.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      await placeHero(-1, 0);
      if ( !ctx.expect(await fight(), "combat : au tour du Héros") ) return;
      const away = { x: tc.x - 4 * grid + grid / 2, y: tc.y + grid / 2 };
      const before = await ctx.engine("threats", { tokenId: hero.id, point: away });
      ctx.log(`témoin : s'éloigner de la Cible est menacé par ${before.join(", ") || "personne"}`);
      const a = await brutal(axe, ["staggering"]);
      if ( !ctx.expect(!!a, "le Coup brutal touche (12 essais)") ) return;
      ctx.expect((await effectsOf(EFFECTS.staggered)).length === 1, `la Cible porte « Staggered » (${(await ctx.effects(target)).map(e => e.name).join(", ")})`);
      const after = await ctx.engine("threats", { tokenId: hero.id, point: away });
      ctx.expect(before.includes("Cible") && !after.includes("Cible"), `chancelante, la Cible ne menace plus le Héros qui s'éloigne (avant : ${before.join(", ") || "personne"} ; après : ${after.join(", ") || "personne"})`);
      await ctx.nextTurn(); await pause(2500);   // tour du Lanceur : l'effet tient jusqu'au début du tour du Héros
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: caster.id, itemId: flame, activityType: "save", targetTokenIds: [target.id], consume: false });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(2000);
      const save = (await ctx.messagesSince(since)).find(m => (m.flags?.dnd5e?.roll?.type === "save") || (m.type === "save"));
      const mode = save?.rolls?.[0]?.options?.advantageMode ?? null;
      ctx.expect(mode === -1, `la sauvegarde de la Cible contre la Flamme sacrée a le Désavantage (mode ${mode})`);
    });

    await part("Coup fendant (niveau 13)", async () => {
      const axe = await ready(13);
      const club = await lend(caster, `${SRD}.equipment24.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      await placeHero(-1, 0);
      await ctx.call("move-token", { tokenId: caster.id, x: tc.x, y: tc.y - grid, elevation: 0 });
      await pause(800);
      // Témoin : le bonus d'attaque du Lanceur au gourdin, sans « Sundered ».
      const plain = await attack(caster, club, target, { confirmed: true });
      if ( !ctx.expect(await fight(), "combat : au tour du Héros") ) return;
      const a = await brutal(axe, ["sundering"]);
      if ( !ctx.expect(!!a, "le Coup brutal touche (12 essais)") ) return;
      ctx.expect((await effectsOf(EFFECTS.sundered)).length === 1, `la Cible porte « Sundered » (${(await ctx.effects(target)).map(e => e.name).join(", ")})`);
      const own = await attack(hero, axe, target, { reckless: true, brutal: false });
      ctx.expect(!extraTerms(a.formula, own.formula).length && (await effectsOf(EFFECTS.sundered)).length === 1,
        `attaque suivante du Héros : rien de plus que son Coup brutal (« ${a.formula} » → « ${own.formula} »), l'effet reste`);
      await ctx.nextTurn(); await pause(2500);   // tour du Lanceur
      const other = await attack(caster, club, target, { confirmed: true });
      const extra = extraTerms(plain.formula, other.formula);
      ctx.expect((extra.length === 1) && (extra[0] === "+5"), `attaque du Lanceur : +5 de Sundered (« ${plain.formula} » → « ${other.formula} »)`);
      let gone = false;
      for ( let n = 0; (n < 12) && !gone; n++ ) { gone = !(await effectsOf(EFFECTS.sundered)).length; if ( !gone ) await pause(500); }
      ctx.expect(gone, "« Sundered » est consommé par cette attaque");
    });

    await part("Deux effets (niveau 17)", async () => {
      const axe = await ready(17);
      await placeHero(-1, 0);
      if ( !ctx.expect(await fight(), "combat : au tour du Héros") ) return;
      const a = await brutal(axe, ["staggering", "sundering"]);
      if ( !ctx.expect(!!a, "le Coup brutal touche (12 essais)") ) return;
      const st = (await effectsOf(EFFECTS.staggered)).length;
      const su = (await effectsOf(EFFECTS.sundered)).length;
      ctx.expect((st === 1) && (su === 1), `la Cible porte « Staggered » et « Sundered » (${st}, ${su})`);
    });
  }
};
