/**
 * Aptitudes passives du relevé des trous, niveaux 9 à 20 (SPEC §236), dans l'Arène des sorts : le Lanceur (PNJ), le Héros (Barbare
 * pré-tiré : classe, armes, budget de PJ), les Cibles. Chaque partie prête ses items et remet tout.
 *  - Auto-restauration : Charmé et Empoisonné, fin du tour du Héros → un seul des deux retiré (Charmé, le premier de la règle) ;
 *  - Inspiration supérieure : le Lanceur barde sans inspiration, jet d'initiative → deux utilisations ;
 *  - Avatar de la bataille : 20 dégâts tranchants → 10 PV perdus ; 20 de feu → 20 ;
 *  - Puissance indomptable : six sauvegardes de Force du Héros → jamais sous sa valeur de Force ;
 *  - Fureur élémentaire améliorée : Flammes (18 m) d'un druide à Incantation puissante → 108 m ; sans l'option → 18 m ;
 *  - Pas véloce : à son tour, la Rage (action Bonus) puis Pas du vent → gratuit, l'action Bonus reste dépensée une fois ;
 *  - Faufilement suprême : le Héros roublard 9 caché, Attaque sournoise + Attaque furtive → reste caché ; fin du tour à découvert → plus caché ;
 *  - Réflexes du voleur : initiative 20 → un second combattant à 10, retiré au round 2 ;
 *  - Âme de la vengeance : la Cible sous le Vœu d'inimitié du Héros attaque le Lanceur → le Héros riposte (Réaction, `autoReact: "first"`).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const CLASSES = "Compendium.dnd-players-handbook.classes.Item.";
const DAGGER = "Compendium.dnd-players-handbook.equipment.Item.phbwepDagger0000";
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "aptitudes passives du relevé des trous, niveaux 9 à 20 (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Héros", "Cible", "Cible voisine"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, hero, target, other] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, hero, target, other];
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));
    const lent = [];
    const lend = async (t, uuid, system={}) => { const id = await ctx.ensureItem(t, uuid, { system }); lent.push([t, id]); return id; };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const t of all ) {
        for ( const e of (await ctx.call("get-actor", { actorId: t.actorId })).effects ?? [] ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
        }
        for ( const flag of ["hiddenBeforeAttack"] ) await ctx.call("update-actor", { actorId: t.actorId, actorData: { [`flags.${MODULE_ID}.-=${flag}`]: null } }).catch(() => {});
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
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId; };
    const fight = async order => {
      await ctx.startCombat(order);
      const c = await state();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
        await pause(600);
      }
      for ( let i = 0; (i < 6) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1000); }
      return (await current()) === order[0].id;
    };
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(2500); };
    const statuses = async t => (await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const adjacent = async (t, to) => { const p = await ctx.position(to); await ctx.call("move-token", { tokenId: t.id, x: p.x + grid, y: p.y, elevation: 0 }); await pause(800); };
    const heroActor = () => ctx.call("get-actor", { actorId: hero.actorId });

    await part("Auto-restauration", async () => {
      await lend(hero, `${CLASSES}phbmnkSelfrestor`);
      await ctx.call("set-status", { tokenId: hero.id, statusId: "charmed", active: true });
      await ctx.call("set-status", { tokenId: hero.id, statusId: "poisoned", active: true });
      if ( !ctx.expect(await fight([hero, target]), "Auto-restauration : tour du Héros") ) return;
      await next();
      const left = await statuses(hero);
      ctx.expect(!left.includes("charmed") && left.includes("poisoned"), `Auto-restauration : fin de tour → Charmé retiré, Empoisonné gardé (${left.join(", ")})`);
    });

    await part("Inspiration supérieure", async () => {
      // Toutes les inspirations dépensées dès le prêt (Charisme 20 : 5 utilisations).
      const { data } = await ctx.call("get-compendium-entry", { uuid: `${CLASSES}phbbrdBardicInsp` });
      const bi = await lend(caster, `${CLASSES}phbbrdBardicInsp`, { uses: { ...(data.system?.uses ?? {}), spent: 5 } });
      await lend(caster, `${CLASSES}phbbrdSuperiorIn`);
      const item = async () => (await ctx.call("get-actor", { actorId: caster.actorId })).items.find(i => i._id === bi);
      const max = Number((await item()).system?.uses?.max) || 5;
      await fight([caster, target]);
      await pause(1500);
      const left = max - (Number((await item()).system?.uses?.spent) || 0);
      ctx.expect(left === Math.min(2, max), `Inspiration supérieure : à l'initiative, ${left} utilisation(s) (2 attendues)`);
    });

    await part("Avatar de la bataille", async () => {
      await lend(caster, `${CLASSES}phbclcAvatarOfBa`);
      await pause(1500);
      await ctx.engine("hurt", { tokenId: caster.id, amount: 20, type: "slashing" });
      const slashed = 999 - await ctx.hp(caster);
      await ctx.setHp(caster, 999);
      await ctx.engine("hurt", { tokenId: caster.id, amount: 20, type: "fire" });
      const burned = 999 - await ctx.hp(caster);
      ctx.expect((slashed === 10) && (burned === 20), `Avatar de la bataille : 20 tranchants → ${slashed} PV, 20 de feu → ${burned} PV`);
    });

    await part("Puissance indomptable", async () => {
      await lend(hero, `${CLASSES}phbbrbIndomitabl`);
      const score = Number((await heroActor()).system?.abilities?.str?.value);
      const totals = [];
      for ( let n = 0; n < 6; n++ ) totals.push((await ctx.engine("rollSave", { tokenId: hero.id, ability: "str" }))?.total);
      ctx.expect(totals.every(t => t >= score), `Puissance indomptable : Force ${score}, sauvegardes ${totals.join(", ")}`);
    });

    await part("Fureur élémentaire améliorée", async () => {
      const flame = await lend(caster, `${SPELLS}phbsplProduceFla`, { method: "atwill", sourceItem: "class:druid" });
      await lend(caster, `${CLASSES}phbdrdImprovedEl`);
      const plain = await ctx.engine("range", { tokenId: caster.id, itemId: flame, activityType: "attack" });
      await lend(caster, `${CLASSES}phbFuryPotentSpe`);
      await pause(500);
      const far = await ctx.engine("range", { tokenId: caster.id, itemId: flame, activityType: "attack" });
      ctx.expect((far?.value === (plain?.value ?? 0) + 300) && (plain?.value === 60),
        `Fureur élémentaire améliorée : Flammes ${plain?.value} ft sans l'option, ${far?.value} ft avec Incantation puissante`);
    });

    await part("Pas véloce", async () => {
      await lend(hero, `${CLASSES}phbmnkMonksFocus`);
      await lend(hero, `${CLASSES}phbmnkFleetStep0`);
      if ( !ctx.expect(await fight([hero, target]), "Pas véloce : tour du Héros") ) return;
      const rage = await ctx.itemId(hero.id, "rage");
      await settled(await ctx.use({ tokenId: hero.id, itemId: rage, targetTokenIds: [hero.id], consume: false }));
      await pause(1000);
      const after = await ctx.engine("budget", { tokenId: hero.id });
      ctx.expect((after?.bonus === 0) && (after?.fleetStep === true), `Pas véloce : la Rage (action Bonus) ouvre Pas du vent (bonus ${after?.bonus}, offert ${after?.fleetStep})`);
      const focus = await ctx.itemId(hero.id, "monks-focus");
      await settled(await ctx.use({ tokenId: hero.id, itemId: focus, activityId: "0MuRZ0Ur95xQTKFq", targetTokenIds: [hero.id], consume: false }));
      await pause(1000);
      const step = await ctx.engine("budget", { tokenId: hero.id });
      ctx.expect((step?.fleetStep === false) && (step?.dashed === true), `Pas véloce : Pas du vent gratuit, pris (Foncer : ${step?.dashed}, offert ${step?.fleetStep})`);
    });

    await part("Faufilement suprême", async () => {
      await lend(hero, `${CLASSES}phbrgeRogue00000`, { levels: 9 });
      await lend(hero, `${CLASSES}phbrgeSneakAttac`);
      await lend(hero, `${CLASSES}phbrgeCunningStr`);
      await lend(hero, `${CLASSES}phbrgeSupremeSne`);
      const dagger = await ctx.itemId(hero.id, "dagger");
      await adjacent(other, hero);
      await ctx.call("set-status", { tokenId: other.id, statusId: "paralyzed", active: true });
      if ( !ctx.expect(await fight([hero, other]), "Faufilement suprême : tour du Héros") ) return;
      const hidden = async () => (await ctx.engine("stealth", { tokenId: hero.id }))?.hidden === true;
      const hide = () => ctx.call("upsert-embedded-effect", { documentType: "Actor", id: hero.actorId,
        effectData: { name: "Caché (scénario)", img: "icons/svg/cowled.svg", flags: { [MODULE_ID]: { hidden: { dc: 15 } } } } });
      let kept = null;
      for ( let n = 1; (n <= 6) && (kept === null); n++ ) {
        await hide();
        await pause(800);
        const known = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
        const used = await ctx.use({ tokenId: hero.id, itemId: dagger, activityType: "attack", targetTokenIds: [other.id] });
        let answered = false;
        for ( let i = 0; (i < 8) && !answered; i++ ) {
          const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1500 }).catch(() => null);
          const d = (r?.windows ?? []).find(w => /Frappe malicieuse|Frappe rusée|Cunning Strike/i.test(w.title ?? ""));
          if ( d ) { await ctx.call("answer-dialog", { id: d.id, fields: { stealthAttack: true }, button: "strike" }); answered = true; }
        }
        const r = await settled(used);
        await pause(1500);
        if ( answered && r?.targets?.[0]?.hit ) kept = await hidden();
      }
      ctx.expect(kept === true, `Faufilement suprême : Attaque furtive → toujours caché après l'attaque (${kept})`);
      await next();
      ctx.expect(!(await hidden()), "Faufilement suprême : fin du tour à découvert → plus caché");
    });

    await part("Réflexes du voleur", async () => {
      await lend(hero, `${CLASSES}phbrgeThiefsRefl`);
      await fight([hero, target]);
      await pause(1500);
      const twice = async () => (await state()).combatants?.filter(c => c.tokenId === hero.id) ?? [];
      const turns = await twice();
      ctx.expect((turns.length === 2) && turns.some(c => c.initiative === 10), `Réflexes du voleur : deux tours au round 1 (initiatives ${turns.map(c => c.initiative).join(", ")})`);
      for ( let i = 0; (i < 6) && (((await state()).round ?? 1) < 2); i++ ) await next();
      ctx.expect((await twice()).length === 1, `Réflexes du voleur : au round 2, un seul tour (${(await twice()).length})`);
    });

    await part("Âme de la vengeance", async () => {
      const vow = await lend(hero, `${CLASSES}phbpdnVowOfEnmit`);
      await lend(hero, `${CLASSES}phbpdnSoulOfVeng`);
      await adjacent(target, hero);
      await settled(await ctx.use({ tokenId: hero.id, itemId: vow, targetTokenIds: [target.id], consume: false }));
      await pause(1000);
      ctx.expect((await ctx.effectsFrom(target, "vow-of-enmity")).length > 0, "Âme de la vengeance : la Cible porte le Vœu d'inimitié");
      const dagger = await lend(target, DAGGER, { equipped: true });
      await ctx.engineLog();
      await settled(await ctx.use({ tokenId: target.id, itemId: dagger, activityType: "attack", targetTokenIds: [caster.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "first" } } }));
      await pause(6000);
      const log = await ctx.engineLog();
      ctx.expect(log.some(l => /Héros is seeing an enemy attack: reaction window/.test(l)), `Âme de la vengeance : fenêtre de Réaction du Héros (${log.filter(l => /Héros/.test(l)).slice(-2).join(" | ") || "rien"})`);
      ctx.expect(log.some(l => /attack \d+ → Cible/.test(l)), "Âme de la vengeance : le Héros attaque la Cible");
    });
  }
};
