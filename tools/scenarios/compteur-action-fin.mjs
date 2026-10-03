/**
 * Compteur de sauvegardes et action de fin (SPEC §43). Sorts prêtés depuis le compendium du Manuel des joueurs.
 *  1. Pétrification (compteur) : une sauvegarde réussie au lancement ne pose que « Vitesse 0 » ; ratée, l'Entravé — puis, à
 *     chaque fin de tour, une sauvegarde comptée : trois réussites, l'effet tombe ; trois échecs, Pétrifié et plus de sauvegarde.
 *  2. Danse irrésistible d'Otto (action du porteur) : le Zombi prend son action pour rejouer la sauvegarde ; réussie, la danse cesse.
 *  3. Sommeil (action d'un autre) : le Clerc vient au contact du Bandit endormi et le réveille.
 * `PART=Otto` ne joue que la partie dont le nom le contient ; `PLAYER=1` laisse le réveil à un joueur connecté (trois minutes). Remet PV, effets, positions ; retire les sorts prêtés.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "compteur et action de fin — Pétrification, Danse irrésistible d'Otto, Sommeil",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Clerc", "Bandit", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.spells") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const mage = await ctx.token("Magicien");
    const clerc = await ctx.token("Clerc");
    const bandit = await ctx.token("Bandit");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const only = process.env.PART ?? "";

    const baseline = new Map();
    for ( const t of [mage, clerc, bandit, zombi] ) baseline.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const newEffects = async t => (await ctx.effects(t)).filter(e => !baseline.get(t.id).has(e._id ?? e.id));
    /** Les effets nouveaux d'un token qui viennent de cet effet d'item. */
    const from = async (t, id) => (await newEffects(t)).filter(e => String(e._stats?.duplicateSource ?? "").endsWith(`.ActiveEffect.${id}`));
    const clear = async t => {
      for ( const e of await newEffects(t) ) await ctx.call("remove-embedded-effect", { documentType: "Token", id: t.id, effectId: e._id ?? e.id }).catch(() => {});
    };
    const endConcentration = () => ctx.removeStatusEffects(mage, "concentrating");
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await endConcentration();
      await pause(800);
      for ( const t of [zombi, bandit] ) await clear(t);
    };
    ctx.restore(reset);

    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async (first, second) => {
      await ctx.startCombat([first, second]);
      const combat = await state();
      for ( const [t, v] of [[first, 20], [second, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== first.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === first.id;
    };
    const part = async (name, fn) => {
      if ( only && !name.toLowerCase().includes(only.toLowerCase()) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /**
     * Lance le sort du Magicien sur `target` jusqu'à une sauvegarde ratée (20 essais) ; `onSuccess` est appelé une fois, à la
     * première sauvegarde réussie, avant le nettoyage. Rend l'id du message d'utilisation, ou null.
     */
    const until = async (itemId, target, { extra={}, onSuccess=null }={}) => {
      let told = false;
      for ( let i = 0; i < 20; i++ ) {
        await endConcentration();
        await clear(target);
        await pause(600);
        const used = await ctx.use({ tokenId: mage.id, itemId, activityType: "save", targetTokenIds: [target.id], ...extra });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 });
        const save = r.targets.find(t => t.name === target.name)?.save;
        await pause(1500);
        if ( save?.success === false ) return used.usageMessageId;
        if ( save?.success && onSuccess && !told ) { told = true; await onSuccess(); }
      }
      return null;
    };
    const resaveSince = async (since, last) => {
      const m = (await ctx.messagesSince(since)).filter(x => (x.type === "usage") && x.flags?.[MODULE_ID]?.resave).at(-1);
      return (m && (m.id !== last)) ? m : null;
    };

    await part("Pétrification", async () => {
      const spell = await ctx.ensureItem(mage, `${SPELLS}.phbsplFleshtoSto`);
      if ( !ctx.expect(await fight(mage, zombi), "combat : au tour du Magicien") ) return;
      const since = await until(spell, zombi, { onSuccess: async () => {
        const still = await from(zombi, "sFyjp6wt9bjyIl9W");
        const stone = await from(zombi, "Xt8AUh0PfYhGYBvY");
        ctx.expect((still.length === 1) && !stone.length, `sauvegarde réussie au lancement : seulement « ${still[0]?.name ?? "?"} » (Vitesse 0), pas l'Entravé`);
      } });
      if ( !ctx.expect(!!since, "le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
      const stone = async () => (await from(zombi, "Xt8AUh0PfYhGYBvY"))[0] ?? null;
      const first = await stone();
      ctx.expect(!!first && !(await from(zombi, "sFyjp6wt9bjyIl9W")).length, `sauvegarde ratée : seulement l'Entravé (« ${first?.name ?? "?"} »)`);
      let last = null;
      let successes = 0;
      let failures = 0;
      let outcome = null;
      for ( let turn = 0; (turn < 16) && !outcome; turn++ ) {
        await ctx.nextTurn();
        await pause(3000);
        const resave = await resaveSince(since, last);
        if ( !resave ) continue;
        last = resave.id;
        const r = await ctx.settle(resave.id, { timeoutMs: 45000 }).catch(() => null);
        const save = r?.targets?.find(x => x.name === "Zombi")?.save;
        if ( !save ) continue;
        await pause(1500);
        if ( save.success ) successes++; else failures++;
        const e = await stone();
        const tally = e?.flags?.[MODULE_ID]?.tally ?? null;
        if ( successes >= 3 ) { outcome = "ended"; ctx.expect(!e, `troisième réussite (${save.total}) : l'effet tombe`); }
        else if ( failures >= 3 ) {
          outcome = "settled";
          ctx.expect(!!e && (tally?.settled === true) && (e.statuses ?? []).includes("petrified"), `troisième échec (${save.total}) : Pétrifié (états : ${(e?.statuses ?? []).join(", ")})`);
        }
        else ctx.expect((tally?.successes === successes) && (tally?.failures === failures), `${save.success ? "réussite" : "échec"} (${save.total}) : compteur ${tally?.successes}/3 réussites, ${tally?.failures}/3 échecs, l'effet reste`);
      }
      ctx.expect(!!outcome, `le compteur se clôt (${successes} réussite(s), ${failures} échec(s))`);
      if ( outcome === "settled" ) {
        await ctx.nextTurn(); await pause(2500);
        await ctx.nextTurn(); await pause(2500);
        ctx.expect(!(await resaveSince(since, last)), "Pétrifié : plus aucune sauvegarde aux tours suivants");
      }
    });

    await part("Danse d'Otto", async () => {
      const spell = await ctx.ensureItem(mage, `${SPELLS}.phbsplOttosIrres`);
      if ( !ctx.expect(await fight(zombi, mage), "combat : au tour du Zombi") ) return;
      const since = await until(spell, zombi, { onSuccess: async () => {
        const short = await from(zombi, "UhFtBDEZEDpVgz9G");
        const dance = await from(zombi, "MpToumiJ2o3S16K7");
        ctx.expect((short.length === 1) && !dance.length, `sauvegarde réussie au lancement : seulement « ${short[0]?.name ?? "?"} »`);
      } });
      if ( !ctx.expect(!!since, "le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
      const dancing = async () => (await from(zombi, "MpToumiJ2o3S16K7")).length > 0;
      ctx.expect(await dancing(), "le Zombi danse");
      const offered = await ctx.engine("endings", { tokenId: zombi.id });
      ctx.expect((offered.own ?? []).some(e => e.roll === "save"), `le menu du Zombi offre d'y mettre fin (${(offered.own ?? []).map(e => `${e.item} : ${e.roll}`).join(", ")})`);
      let last = null;
      let freed = false;
      let tries = 0;
      for ( let n = 0; (n < 20) && !freed; n++ ) {
        if ( n > 0 ) { await ctx.nextTurn(); await pause(2000); await ctx.nextTurn(); await pause(2000); }   // tour suivant du Zombi
        await ctx.engine("actionEnd", { tokenId: zombi.id });
        let resave = null;
        for ( const stop = Date.now() + 10000; !resave && (Date.now() < stop); await pause(500) ) resave = await resaveSince(since, last);
        if ( !ctx.expect(!!resave && (resave.flags?.[MODULE_ID]?.resave?.moment === "action"), "l'action ouvre une sauvegarde rejouée (moment « action »)") ) return;
        last = resave.id;
        if ( n === 0 ) ctx.expect((await ctx.engine("budget", { tokenId: zombi.id }))?.action === 0, "l'action du Zombi est dépensée");
        const r = await ctx.settle(resave.id, { timeoutMs: 45000 }).catch(() => null);
        const save = r?.targets?.find(x => x.name === "Zombi")?.save;
        if ( !save ) continue;
        tries++;
        await pause(1500);
        const still = await dancing();
        if ( save.success ) { freed = !still; ctx.expect(!still, `sauvegarde réussie (${save.total}) : la danse cesse`); }
        else ctx.expect(still, `sauvegarde ratée (${save.total}) : la danse continue`);
      }
      ctx.expect(freed, `le Zombi se ressaisit (${tries} essai(s))`);
    });

    await part("Sommeil", async () => {
      const spell = await ctx.ensureItem(mage, `${SPELLS}.phbsplSleep00000`);
      const since = await until(spell, bandit, { extra: { area: { shape: "rectangle", ...(await ctx.box(bandit)) } } });
      if ( !ctx.expect(!!since, "le Bandit rate sa sauvegarde (20 essais au plus)") ) return;
      const asleep = async () => (await from(bandit, "04Wa4xUzjA31kPno")).length > 0;
      ctx.expect(await asleep(), "le Bandit porte l'effet du Sommeil");
      const offered = await ctx.engine("endings", { tokenId: bandit.id });
      ctx.expect((offered.byOther ?? []).length === 1, `une autre créature peut le réveiller (${(offered.byOther ?? []).map(e => e.item).join(", ")})`);
      // PLAYER=1 : le réveil est laissé à un joueur (navigateur intégré, « claude player », menu du Clerc sur le Bandit) — le
      // Clerc est posé au contact, et l'on attend trois minutes que l'effet tombe par la requête au MJ actif.
      if ( process.env.PLAYER ) {
        const spot = await ctx.position(bandit);
        await ctx.call("move-token", { tokenId: clerc.id, x: spot.x + grid, y: spot.y, elevation: spot.elevation ?? 0 });
        ctx.log("en attente du joueur : « Réveiller Bandit » depuis le Clerc (3 min au plus)");
        let woken = false;
        for ( const stop = Date.now() + 180000; !woken && (Date.now() < stop); await pause(2000) ) woken = !(await asleep());
        ctx.expect(woken, "un joueur réveille le Bandit : l'effet est retiré par le MJ actif");
        return;
      }
      const far = await ctx.position(clerc);
      const b = await ctx.position(bandit);
      ctx.expect(Math.max(Math.abs(far.x - b.x), Math.abs(far.y - b.y)) > grid, "le Clerc n'est pas au contact du Bandit");
      const done = await ctx.engine("actionEnd", { tokenId: clerc.id, targetId: bandit.id }, { timeoutMs: 90000 });
      await pause(2000);
      const near = await ctx.position(clerc);
      ctx.expect(Math.max(Math.abs(near.x - b.x), Math.abs(near.y - b.y)) <= grid, "le Clerc est venu au contact");
      ctx.expect((done?.done === true) && !(await asleep()), "le Bandit est réveillé : l'effet est retiré");
    });
  }
};
