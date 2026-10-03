/**
 * Options de joueur de Ravenloft: The Horrors Within (SPEC §19.9), monde `dnd-6`. Les items sont prêtés depuis le compendium du
 * module premium, traduit par Babele (noms français, `system.identifier` vide) : le moteur les reconnaît par leur source.
 *  - Morsure vampirique (Dhampir), prêtée au Guerrier : touché ⇔ la question « Drain / Renforcement » ; Drain : le Guerrier
 *    regagne les PV perdus par le Bandit ; Renforcement : l'effet porte ce montant, et tombe au jet d'attaque suivant ; contre le
 *    Zombi (Mort-vivant), aucune question ;
 *  - Cercle de mortalité, prêté au Clerc : Attraction de la mort (+1d4 nécrotique) contre un Bandit blessé, rien contre un Bandit
 *    indemne, une fois par tour en combat ; Retour à la vie : Mot de guérison sur le Guerrier à 0 PV → le maximum (2d4 + 3 = 11) ;
 *  - Chemin vers la tombe (sans son coût de Conduit divin : le Clerc est niveau 1) : le Bandit maudit attaque avec le
 *    Désavantage ; le Paladin le touche → question au Clerc, « radiant » : la malédiction cesse, 1 dégât radiant (niveau de clerc) ;
 *  - Sentinelle au seuil de la mort : le Bandit touche le Guerrier En sang → le Clerc réagit (fenêtre « un autre est touché »),
 *    dégâts divisés par deux ; le Guerrier indemne → pas de fenêtre.
 * Pose la distribution de référence de Restored Keep (tools/lib/stages.mjs) : le Bandit et le Zombi se placent par rapport
 * au Guerrier, au Clerc et au Paladin.
 * Remet PV, positions, effets ; retire les items prêtés.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const RHW = "dnd-ravenloft-horrors-within.options";
const BITE = "rhwVampiricBitnE";
const CIRCLE = "rhwCSCircleofMOG";
const PATH = "rhwCSPathtotheCb";
const SENTINEL = "rhwCSSentinelaOa";
const HEALING_WORD = "Compendium.dnd-players-handbook.spells.Item.phbsplHealingWor";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** L'effet de Renforcement posé par le moteur porte le montant dans son nom : « … (+6) ». */
const BOOSTED = /\(\+\d+\)/;

/** `a.b.c` = valeur, dans un objet simple. */
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "ravenloft-options — Morsure vampirique, Attraction de la mort, Retour à la vie, Chemin vers la tombe, Sentinelle au seuil de la mort",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Clerc", "Bandit", "Paladin"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(RHW) ) { ctx.log("module Ravenloft absent : non applicable"); return; }
    // Les cibles sont placées par rapport au Guerrier, au Clerc, au Paladin : on pose la distribution de référence
    // (les autres tokens compris : un voisin sur une case d'arrivée ou sur la ligne de vue fausse tout), remise à la fin.
    await ctx.stage(RESTORED_KEEP);

    const guerrier = await ctx.token("Guerrier");
    const clerc = await ctx.token("Clerc");
    const bandit = await ctx.token("Bandit");
    const paladin = await ctx.token("Paladin");
    const zombiDoc = tokens.find(t => (t.name === "Zombi") && (t.level === bandit.level) && !t.hidden);
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [guerrier, clerc, bandit, paladin, zombiDoc].filter(Boolean) ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const place = async (t, x, y) => {
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { x, y } });
      await pause(600);
    };
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("update-scene-object", { type: "Token", objectId: id, data: { x: h.pos.x, y: h.pos.y } }).catch(() => {});
        await ctx.setHp(t, h.hp);
        for ( const s of ["unconscious", "prone", "dead", "cursed"] ) await ctx.removeStatusEffects(t, s);
        await ctx.removeEffectsNamed(t, /Strengthened|Renforc|Cursed|Maudit|Chemin|Path to the Grave/i);
      }
    };
    ctx.restore(remettre);

    /** Prête un item du module Ravenloft (source notée dans `flags.dnd5e.sourceId`, comme dnd5e le fait). */
    const lend = async (t, id, patch={}) => {
      const uuid = `Compendium.${RHW}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [path, value] of Object.entries(patch) ) setPath(itemData, path, value);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const itemOf = async (t, itemId) => ((await ctx.call("get-actor", { actorId: t.actorId })).items ?? []).find(i => i._id === itemId);
    const resetUses = (t, itemId) => ctx.call("upsert-actor-item", { actorId: t.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: itemId } });
    const dialogue = async (known, waitMs=6000) => (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs }).catch(() => null))?.windows?.[0] ?? null;
    const connus = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const answer = async (d, pattern) => {
      const b = (d.buttons ?? []).find(x => pattern.test(x.label ?? ""));
      await ctx.call("answer-dialog", { id: d.id, button: b?.action ?? b?.label });
      return b;
    };
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** Attaque jusqu'à toucher ; `onHit(r, t)` rend vrai pour s'arrêter. */
    const hitUntil = async (attacker, itemId, target, onHit, { tries=20, before=null, usage={} }={}) => {
      for ( let n = 1; n <= tries; n++ ) {
        const state = before ? await before() : null;
        const u = await ctx.use({ tokenId: attacker.id, itemId, activityType: "attack", targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: usage } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === target.name);
        if ( t?.hit && await onHit(r, t, u, state) ) return true;
      }
      return false;
    };

    const g = homes.get(guerrier.id).pos;
    const c = homes.get(clerc.id).pos;
    const p = homes.get(paladin.id).pos;

    /* ---- Dhampir : Morsure vampirique ---------------------------------------------------------------------------- */

    const bite = await lend(guerrier, BITE);
    await part("Morsure vampirique — Drain", async () => {
      await place(bandit, g.x + grid, g.y);
      const done = await hitUntil(guerrier, bite, bandit, async (r, t, u, state) => {
        const d = await dialogue(state.known);
        if ( !ctx.expect(!!d, `touché : la question de la morsure s'ouvre (${(d?.buttons ?? []).map(b => b.label).join(", ")})`) ) return true;
        await answer(d, /Drain/i);
        await pause(2500);
        const dealt = 11 - (await ctx.hp(bandit));
        const healed = (await ctx.hp(guerrier)) - 3;
        ctx.expect((dealt > 0) && (healed === dealt), `Drain : le Bandit perd ${dealt} PV, le Guerrier en regagne ${healed}`);
        const item = await itemOf(guerrier, bite);
        ctx.expect(item?.system?.uses?.spent === 1, `une utilisation dépensée (${item?.system?.uses?.spent})`);
        return true;
      }, { before: async () => { await ctx.setHp(bandit, 11); await ctx.setHp(guerrier, 3); return { known: await connus() }; } });
      ctx.expect(done, "Morsure vampirique : touché (20 essais au plus)");
    });

    await part("Morsure vampirique — Renforcement", async () => {
      await resetUses(guerrier, bite);
      await place(bandit, g.x + grid, g.y);
      let amount = 0;
      const done = await hitUntil(guerrier, bite, bandit, async (r, t, u, state) => {
        const d = await dialogue(state.known);
        if ( !d ) return false;
        await answer(d, /^(Renforcement|Strengthen)/i);
        await pause(2500);
        amount = 11 - (await ctx.hp(bandit));
        const boost = (await ctx.effects(guerrier)).find(e => BOOSTED.test(e.name ?? ""));
        ctx.expect(!!boost && boost.name.includes(`(+${amount})`), `Renforcement : effet « ${boost?.name ?? "aucun"} » (${amount} dégâts perforants)`);
        return true;
      }, { before: async () => { await ctx.setHp(bandit, 11); return { known: await connus() }; } });
      if ( !ctx.expect(done, "Morsure vampirique : touché et question (20 essais au plus)") ) return;
      await ctx.setHp(bandit, 11);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: guerrier.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [bandit.id] });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const attack = (await ctx.messagesSince(since)).find(m => m.type === "attack");
      const formula = attack?.rolls?.[0]?.formula ?? "";
      ctx.expect(new RegExp(`\\+ ${amount}(\\D|$)`).test(formula), `l'attaque suivante porte le bonus (+${amount}) : « ${formula} »`);
      const left = (await ctx.effects(guerrier)).some(e => BOOSTED.test(e.name ?? ""));
      ctx.expect(!left, "le renforcement tombe après ce jet d'attaque");
    });

    if ( zombiDoc ) await part("Morsure vampirique — Mort-vivant", async () => {
      await resetUses(guerrier, bite);
      await place(zombiDoc, g.x + grid, g.y);
      const hp = homes.get(zombiDoc.id).hp;
      const done = await hitUntil(guerrier, bite, zombiDoc, async (r, t, u, state) => {
        ctx.expect(!(await dialogue(state.known, 4000)), "Zombi (Mort-vivant) touché : aucune question");
        return true;
      }, { before: async () => { await ctx.setHp(zombiDoc, hp); return { known: await connus() }; } });
      ctx.expect(done, "morsure sur le Zombi : touché (20 essais au plus)");
    });

    /* ---- Domaine de la Tombe ------------------------------------------------------------------------------------- */

    await lend(clerc, CIRCLE);
    const necroticOf = async since => (await ctx.messagesSince(since)).filter(m => m.type === "damage")
      .flatMap(m => m.rolls ?? []).filter(x => /necrotic/.test(JSON.stringify(x.options ?? {})) || /necrotic/.test(x.formula ?? ""));

    await part("Attraction de la mort", async () => {
      await place(bandit, c.x - grid, c.y);
      let since = null;
      const wounded = await hitUntil(clerc, await ctx.itemId(clerc.id, "mace"), bandit, async () => {
        await pause(1500);
        const extra = await necroticOf(since);
        ctx.expect(extra.length === 1, `Bandit blessé (10/11) : +1d4 nécrotique (${extra.map(x => x.formula).join(", ") || "rien"})`);
        return true;
      }, { before: async () => { await ctx.setHp(bandit, 10); since = await ctx.lastMessageId(); } });
      ctx.expect(wounded, "masse d'armes : touché (20 essais au plus)");
      const full = await hitUntil(clerc, await ctx.itemId(clerc.id, "mace"), bandit, async () => {
        await pause(1500);
        ctx.expect(!(await necroticOf(since)).length, "Bandit indemne : rien d'ajouté");
        return true;
      }, { before: async () => { await ctx.setHp(bandit, 11); since = await ctx.lastMessageId(); } });
      ctx.expect(full, "masse d'armes : touché (20 essais au plus)");
      // Une fois par tour, en combat : deux touches dans le même tour, le second sans le dé.
      await ctx.startCombat([clerc, bandit]);
      let hits = 0;
      const seen = [];
      await hitUntil(clerc, await ctx.itemId(clerc.id, "mace"), bandit, async () => {
        await pause(1500);
        seen.push((await necroticOf(since)).length);
        return ++hits >= 2;
      }, { tries: 30, before: async () => { await ctx.setHp(bandit, 9); since = await ctx.lastMessageId(); } });
      ctx.expect((seen.length === 2) && (seen[0] === 1) && (seen[1] === 0), `en combat, même tour : le dé une seule fois (${seen.join(", ")})`);
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    });

    await part("Retour à la vie", async () => {
      const heal = await ctx.ensureItem(clerc, HEALING_WORD);
      await ctx.setHp(guerrier, 0);
      await pause(1500);
      const u = await ctx.use({ tokenId: clerc.id, itemId: heal, activityType: "heal", consume: false, targetTokenIds: [guerrier.id] });
      // Le soin attend le clic « Soins » de la carte (api.mcp.rollCard), comme au scénario sorts-couverts.
      await pause(1200);
      await ctx.engine("rollCard", { messageId: u.usageMessageId });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      const hp = await ctx.hp(guerrier);
      ctx.expect(hp === Math.min(11, homes.get(guerrier.id).hp), `Mot de guérison sur le Guerrier à 0 PV : ${hp} PV (le maximum, 2d4 + 3 = 11)`);
    });

    const curse = await lend(clerc, PATH, { "system.activities.ZExOfIsAqbDCMYDk.consumption.targets": [] });
    await part("Chemin vers la tombe", async () => {
      await place(bandit, p.x + grid, p.y);
      await ctx.setHp(bandit, 11);
      const u = await ctx.use({ tokenId: clerc.id, itemId: curse, activityType: "utility", targetTokenIds: [bandit.id] });
      await ctx.settle(u.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(1500);
      const cursed = async () => (await ctx.effects(bandit)).some(e => (e.statuses ?? []).includes("cursed"));
      if ( !ctx.expect(await cursed(), "le Bandit est maudit (effet « cursed »)") ) return;
      // Le maudit attaque avec le Désavantage.
      const since = await ctx.lastMessageId();
      const a = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [paladin.id] });
      await ctx.settle(a.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const attack = (await ctx.messagesSince(since)).find(m => m.type === "attack");
      const m = attack?.flags?.[MODULE_ID]?.modifiers ?? attack?.flags?.modifiers ?? { disadvantage: [] };
      ctx.expect((m.disadvantage ?? []).some(r => r.who === "content"),
        `attaque du maudit : Désavantage déclaré (${(m.disadvantage ?? []).map(r => `${r.who}.${r.key}`).join(", ") || "aucun"})`);
      await ctx.setHp(paladin, homes.get(paladin.id).hp);
      // Le Paladin (allié que le Clerc voit) le touche : question au Clerc, « radiant ».
      const done = await hitUntil(paladin, await ctx.itemId(paladin.id, "longsword"), bandit, async (r, t, u2, state) => {
        const d = await dialogue(state.known);
        if ( !ctx.expect(!!d, `touché par le Paladin : la question de la malédiction s'ouvre (${(d?.buttons ?? []).map(b => b.label).join(", ")})`) ) return true;
        await answer(d, /radiant/i);
        await pause(2500);
        ctx.expect(!(await cursed()), "la malédiction cesse");
        const radiant = (await ctx.messagesSince(state.since)).filter(x => x.flags?.[MODULE_ID]?.discharge);
        ctx.expect(radiant.length === 1 && radiant[0].flags[MODULE_ID].discharge.type === "radiant", `dégâts de fin de malédiction : ${radiant[0]?.rolls?.[0]?.formula ?? "aucun"} radiant`);
        return true;
      }, { before: async () => ({ known: await connus(), since: await ctx.lastMessageId() }), usage: { autoReact: "none" } });
      ctx.expect(done, "épée longue du Paladin : touché (20 essais au plus)");
    });

    const sentinel = await lend(clerc, SENTINEL);
    await part("Sentinelle au seuil de la mort", async () => {
      await place(bandit, g.x + grid, g.y);
      // Indemne : pas de fenêtre pour le Guerrier.
      const whole = await hitUntil(bandit, await ctx.itemId(bandit.id, "scimitar"), guerrier, async (r, t) => {
        ctx.expect(!t.reaction && !t.halved, `Guerrier indemne touché : personne ne réagit (${t.reaction ?? "—"})`);
        return true;
      }, { before: async () => { await ctx.setHp(guerrier, homes.get(guerrier.id).hp); }, usage: { autoReact: "first" } });
      ctx.expect(whole, "cimeterre : touché (20 essais au plus)");
      await resetUses(clerc, sentinel);
      const bloodied = await hitUntil(bandit, await ctx.itemId(bandit.id, "scimitar"), guerrier, async (r, t) => {
        if ( process.env.DEBUG ) {
          ctx.log(`trace : ${(await ctx.engineLog()).slice(-14).join(" / ")}`.slice(0, 2500));
          ctx.log(`cible : ${JSON.stringify(t).slice(0, 400)}`);
        }
        ctx.expect(t.halved === true && /Sentinel/i.test(t.reaction ?? ""), `Guerrier En sang touché : le Clerc réagit (${t.reaction ?? "personne"}), dégâts divisés (${t.halved})`);
        const mult = r.targets.find(x => x.name === "Guerrier")?.damage?.multiplier ?? null;
        if ( mult !== null ) ctx.expect(mult === 0.5, `multiplicateur 0,5 (${mult})`);
        const item = await itemOf(clerc, sentinel);
        ctx.expect(item?.system?.uses?.spent === 1, `une utilisation de la Sentinelle dépensée (${item?.system?.uses?.spent})`);
        return true;
      }, { before: async () => { await ctx.setHp(guerrier, 5); }, usage: { autoReact: "first" } });
      ctx.expect(bloodied, "cimeterre sur le Guerrier En sang : touché (20 essais au plus)");
    });
  }
};
