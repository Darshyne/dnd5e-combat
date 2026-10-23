/**
 * Le balayage de l'« Arène des sorts » (2026-10-22, relevé des trous) : chaque item d'une liste — sorts, dons, aptitudes — prêté au
 * Lanceur (`tools/arene-sorts.mjs`), chacune de ses activités utilisée une fois sur la cible que ses données désignent (zone posée
 * sur la Cible, soin sur l'Allié, item personnel sur le Lanceur), et des invariants qui ne dépendent pas des dés :
 *  1. l'utilisation a lieu (dnd5e ne la refuse pas) ;
 *  2. une activité d'attaque ou de sauvegarde reçoit une résolution du moteur, et celle-ci est tranchée (pas bloquée en route) ;
 *  3. PV lus sur chaque cible = dégâts consignés par la résolution (soins compris, en négatif) ;
 *  4. une activité qui pose des effets les pose sur la cible touchée / qui rate (ou sans jet), et sur personne d'autre que les
 *     cibles de la résolution ;
 *  5. un sort de concentration laisse le Lanceur concentré ;
 *  6. un sort de niveau ≥ 1 dépense un emplacement de son niveau, un seul (`consume: true`) ;
 *  7. aucune erreur dans la console du MJ pendant l'utilisation.
 * Hors du balayage : activités d'invocation, de métamorphose et de renvoi (`forward`), téléportations et murs posés point par point
 * (ils attendent un clic). Rapport : `prive/balayages/<kind>-<date>.json` et `.md` (noms et constats, aucun texte d'item).
 * Scénarios : `balayage-sorts`, `balayage-aptitudes` (ne se jouent que nommés).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CONTENT } from "../../module/scripts/content/index.mjs";
import { ARENE_SORTS } from "./stages.mjs";

const SLOTS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));
const SKIPPED_TYPES = new Set(["summon", "transform", "forward"]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {object} ctx  le contexte d'un scénario (tools/scenario.mjs)
 * @param {object} options
 * @param {string} options.kind        nom du rapport (« sorts », « aptitudes »)
 * @param {string[]} options.packs     compendiums lus
 * @param {(data: object) => boolean} options.select   les items balayés
 * @param {(data: object) => string} options.sortKey   l'ordre du balayage
 * @param {object} options.lend        retouches de `system` au prêt (un sort préparé…)
 * @param {boolean} options.consume    dépenser les ressources (emplacements)
 */
export async function sweep(ctx, { kind, packs, select, sortKey, lend, consume }) {
  const names = Object.keys(ARENE_SORTS.tokens);
  const { tokens } = await ctx.scene();
  if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log("tokens de l'arène manquants : lancer tools/arene-sorts.mjs"); return; }
  const t = Object.fromEntries(await Promise.all(names.map(async n => [n, await ctx.token(n)])));
  const caster = t["Lanceur"];
  const grid = ARENE_SORTS.grid;
  const sceneId = (await ctx.scene()).sceneId;
  const keep = new Set(Object.values(t).map(x => x.id));

  // Les items : index des compendiums, filtres du balayage.
  const docs = [];
  for ( const packId of packs ) {
    const index = await ctx.call("list-compendium-entries", { packId });
    for ( const e of (Array.isArray(index) ? index : Object.values(index).find(Array.isArray)) ?? [] ) {
      if ( !["spell", "feat"].includes(e.type) ) continue;
      const { data } = await ctx.call("get-compendium-entry", { uuid: e.uuid });
      if ( select(data) ) docs.push({ uuid: e.uuid, data });
    }
  }
  docs.sort((a, b) => sortKey(a.data).localeCompare(sortKey(b.data)));
  const from = process.env.DEPUIS ? docs.findIndex(d => d.data.system.identifier === process.env.DEPUIS) : 0;
  const list = docs.slice(Math.max(0, from));
  ctx.log(`${list.length} item(s) à balayer`);

  const centre = async tok => { const b = await ctx.box(tok); return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }; };
  const px = feet => (Number(feet) || 0) / 5 * grid;
  const slotsOf = async () => (await ctx.call("get-actor", { actorId: caster.actorId })).system?.spells ?? {};
  const tokenOf = tr => Object.values(t).find(x => (x.id === tr.tokenId) || (x.name === tr.name));
  /** PV et PV temporaires (acteurs liés de l'arène) : un soin en PV temporaires (Armure d'Agathys, Simulacre de vie) compte aussi. */
  const hpOf = async tok => {
    const hp = (await ctx.call("get-actor", { actorId: tok.actorId })).system?.attributes?.hp ?? {};
    return (Number(hp.value) || 0) + (Number(hp.temp) || 0);
  };

  /** Tout ce qu'une utilisation a laissé : effets, zones, tokens invoqués, PV, emplacements, fenêtres. */
  const cleanup = async () => {
    for ( const tok of Object.values(t) ) {
      const actor = await ctx.call("get-actor", { actorId: tok.actorId });
      for ( const e of actor.effects ?? [] ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: tok.actorId, effectId: e._id ?? e.id }).catch(() => {});
      await ctx.setHp(tok, 999);
    }
    const { objects } = await ctx.call("list-scene-objects", { sceneId, types: ["Token", "Region", "Wall", "AmbientLight", "Tile"] });
    for ( const [type, found] of Object.entries(objects ?? {}) ) {
      for ( const o of found ?? [] ) {
        if ( (type === "Token") && keep.has(o.id) ) continue;
        await ctx.call("delete-scene-object", { sceneId, type, objectId: o.id }).catch(() => {});
      }
    }
    await ctx.call("update-actor", { actorId: caster.actorId, actorData: { system: { spells: SLOTS } } });
    for ( const w of await ctx.engine("windows").catch(() => []) ) await ctx.engine("closeWindow", { id: w.id }).catch(() => {});
  };

  /** La cible et la zone d'une activité, d'après ses données. */
  const aim = async (item, activity) => {
    const s = item.system;
    // L'activité a ses propres cible et portée quand elle les surcharge — et toujours sur un don ou une aptitude, qui n'en a pas.
    const target = (activity.target?.override || !s.target) ? activity.target : s.target;
    const range = (activity.range?.override || !s.range) ? activity.range : s.range;
    const template = target?.template?.type ? target.template : null;
    const affects = target?.affects?.type ?? "";
    let who = (activity.type === "heal") || ["ally", "willing"].includes(affects) ? t["Allié"] : t["Cible"];
    if ( ((range?.units === "self") && !template) || (affects === "self") ) who = caster;
    if ( !template ) return { targets: [who] };
    if ( template.type === "wall" ) return { skip: "mur posé point par point" };
    // Une taille peut être une formule du niveau du sort (Confusion : « @item.level * 5 - 10 ») : évaluée au niveau de base.
    const formula = String(template.size || 5).replace(/@item\.level/g, String(s.level ?? 0));
    const size = px(/^[\d\s+\-*/().]+$/.test(formula) ? Function(`return (${formula})`)() : 5);
    const onSelf = range?.units === "self";
    const at = await centre(onSelf ? caster : t["Cible"]);
    const near = [t["Cible"], t["Cible voisine"]];
    switch ( template.type ) {
      case "cone": case "line": case "rect": {
        // La Cible est à 20 ft : un cône de 15 ft ne l'atteindrait pas. On ne teste pas la géométrie ici, mais ce que l'item fait
        // aux créatures prises : la zone va du Lanceur jusqu'au bout de la Cible voisine.
        const c = await centre(caster);
        const far = await centre(t["Cible voisine"]);
        const start = c.box.x + c.box.width;
        const length = Math.max(size, far.box.x + far.box.width - start);
        const width = Math.max(grid * 1.5, template.type === "line" ? px(template.width || 5) : size);
        return { targets: near, area: { shape: "rectangle", x: start, y: far.y - width / 2, width: length, height: width } };
      }
      case "cube": case "square":
        return { targets: near, area: { shape: "rectangle", x: at.x - size / 2, y: at.y - size / 2, width: size, height: size } };
      default:
        // Une émanation autour du Lanceur : l'ennemi au contact et l'Allié y sont (le Lanceur n'est pas une cible de sa propre zone).
        return { targets: onSelf ? [t["Ennemi au contact"], t["Allié"]] : near, area: { shape: "circle", x: at.x, y: at.y, radius: size } };
    }
  };

  const report = [];
  await cleanup();
  for ( const { uuid, data } of list ) {
    const s = data.system;
    const ident = s.identifier;
    const isSpell = data.type === "spell";
    const row = { name: data.name, identifier: ident, level: isSpell ? s.level : (s.requirements ?? ""),
      engine: Object.keys(CONTENT[ident] ?? {}).filter(k => k !== "source"), runs: [], notes: [] };
    report.push(row);
    if ( CONTENT[ident]?.teleport || CONTENT[ident]?.pointWall ) { row.notes.push(`non joué : ${CONTENT[ident]?.teleport ? "téléportation" : "mur point par point"} (attend un clic)`); continue; }
    let itemId;
    try { itemId = await ctx.ensureItem(caster, uuid, { system: lend }); }
    catch ( err ) { row.notes.push(`prêt impossible : ${err.message}`); continue; }
    for ( const activity of Object.values(s.activities ?? {}) ) {
      const label = `${activity.type}${activity.name ? ` « ${activity.name} »` : ""}`;
      if ( SKIPPED_TYPES.has(activity.type) ) { row.notes.push(`${label} : non joué`); continue; }
      // Les dégâts d'un châtiment se lancent après le coup d'une arme (§107) : utilisés seuls, ils frapperaient le Lanceur.
      if ( CONTENT[ident]?.smite && (activity.type === "damage") ) { row.notes.push(`${label} : non joué (après un coup d'arme)`); continue; }
      const run = { activity: label, issues: [] };
      row.runs.push(run);
      const bad = msg => run.issues.push(msg);
      try {
        const plan = await aim(data, activity);
        if ( plan.skip ) { run.skipped = plan.skip; continue; }
        if ( activity.type === "heal" ) await ctx.setHp(t["Allié"], 500);
        const hp0 = new Map();
        for ( const tok of Object.values(t) ) hp0.set(tok.id, await hpOf(tok));
        const slots0 = await slotsOf();
        await ctx.clientErrors();
        // Une question du moteur ou de dnd5e chez le MJ (cible consentante ?, caractéristique du Maléfice, rituel ou emplacement…) :
        // première option, notée dans le rapport. Elle peut tenir l'utilisation en suspens : on la cherche pendant et juste après.
        const known = new Set(((await ctx.call("list-dialogs", {}).catch(() => null))?.windows ?? []).map(w => w.id));
        let done = false;
        let ritualAsked = false;
        const using = ctx.use({ tokenId: caster.id, itemId, activityId: activity._id, targetTokenIds: plan.targets.map(x => x.id),
          consume, ...(plan.area ? { area: plan.area } : {}) })
          .catch(err => ({ used: false, reason: err.message })).finally(() => { done = true; });
        for ( let after = 0; after < 4; ) {
          const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1500, details: true }).catch(() => null);
          for ( const d of r?.windows ?? [] ) {
            known.add(d.id);
            // Rituel ou emplacement : l'emplacement, pour que l'invariant de la dépense se vérifie.
            const buttons = (d.buttons ?? []).filter(x => !/cancel|annuler|close|fermer/i.test(`${x.action ?? ""} ${x.label ?? ""}`));
            const b = buttons.find(x => /slot|emplacement/i.test(x.label ?? "")) ?? buttons[0] ?? d.buttons?.[0];
            if ( !b ) continue;
            await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
            if ( /slot|emplacement/i.test(b.label ?? "") ) ritualAsked = true;
            row.notes.push(`${label} : fenêtre « ${String(d.title ?? "").slice(0, 60)} » → ${b.label ?? b.action}`);
          }
          if ( done ) after++;
        }
        const used = await using;
        // §139 : la question « rituel ou emplacement » annule l'utilisation et la relance avec la réponse, hors de `use-activity`.
        if ( !used?.used && ritualAsked ) { run.skipped = "relancé par le moteur après la question rituel / emplacement (§139)"; continue; }
        if ( !used?.used ) { bad(`pas d'utilisation : ${used?.reason ?? "?"}`); continue; }

        // 2. La résolution.
        let r = null;
        if ( used.usageMessageId ) {
          for ( let i = 0; (i < 8) && !r; i++ ) { r = await ctx.resolution(used.usageMessageId); if ( !r ) await pause(500); }
          if ( r ) {
            // `use-activity` coupe l'enchaînement des jets (`subsequentActions: false`, §233) : les dégâts ou le soin d'une activité
            // sans jet d'attaque se lancent comme le bouton de la carte.
            if ( /^awaiting(Rolls|Damage|Healing)$/.test(r.step ?? "") ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => {});
            try { r = await ctx.settle(used.usageMessageId, { timeoutMs: 25000 }); }
            catch ( err ) { bad(`résolution bloquée : ${err.message.replace(/^résolution \S+ /, "")}`); }
          }
        }
        if ( ["attack", "save"].includes(activity.type) && !r ) bad("aucune résolution du moteur");
        await pause(1500);
        run.step = r?.step;

        // 3. Les PV.
        for ( const tr of r?.targets ?? [] ) {
          const tok = tokenOf(tr);
          if ( !tok || ((tr.damage?.applied ?? tr.healing?.applied ?? null) === null) ) continue;
          const delta = hp0.get(tok.id) - await hpOf(tok);
          const applied = Number(tr.damage?.applied ?? 0) - Number(tr.healing?.applied ?? 0);
          if ( delta !== applied ) bad(`${tok.name} : PV ${hp0.get(tok.id)} → ${hp0.get(tok.id) - delta}, consigné ${applied}`);
        }

        // 4. Les effets.
        const declared = (activity.effects ?? []).map(e => e._id);
        // Un enchantement se pose sur un item (l'arme), pas sur une créature : le Lanceur n'en porte pas.
        if ( declared.length && !CONTENT[ident]?.zoneEffects && (activity.type !== "enchant") ) {
          const affected = r?.targets?.length
            ? r.targets.filter(tr => (tr.hit !== false) && (tr.save?.success !== true) && !tr.unaffected).map(tokenOf).filter(Boolean)
            : plan.targets;
          for ( const tok of affected ) {
            const on = await ctx.effectsFrom(tok, ident);
            if ( !on.filter(e => !(e.statuses ?? []).includes("concentrating")).length ) bad(`${tok.name} : aucun effet de l'item (${declared.length} déclaré(s))`);
          }
          const touched = new Set((r?.targets ?? []).map(tr => tr.name).concat(plan.targets.map(x => x.name), [caster.name]));
          for ( const tok of Object.values(t) ) {
            if ( !touched.has(tok.name) && (await ctx.effectsFrom(tok, ident)).length ) bad(`${tok.name} : effet de l'item posé hors des cibles`);
          }
        }

        // 5. La concentration.
        // Seule l'activité qui lance le sort (elle prend l'emplacement) commence la concentration : pas « Déplacer les lumières ».
        if ( isSpell && (s.properties ?? []).includes("concentration") && (activity.consumption?.spellSlot !== false) ) {
          const on = await ctx.effectsFrom(caster, ident);
          if ( !on.some(e => (e.statuses ?? []).includes("concentrating")) ) bad("Lanceur non concentré");
        }

        // 6. L'emplacement.
        if ( isSpell && consume && (s.level >= 1) ) {
          const slots1 = await slotsOf();
          const spent = Object.keys(SLOTS).map(k => [k, (slots0[k]?.value ?? 0) - (slots1[k]?.value ?? 0)]).filter(([, n]) => n);
          const consumes = activity.consumption?.spellSlot !== false;
          if ( consumes && !((spent.length === 1) && (spent[0][0] === `spell${s.level}`) && (spent[0][1] === 1)) ) bad(`emplacement : ${spent.map(([k, n]) => `${k} −${n}`).join(", ") || "aucun dépensé"}`);
          if ( !consumes && spent.length ) bad(`emplacement dépensé par une activité qui n'en prend pas (${spent.map(([k]) => k).join(", ")})`);
        }

        // 7. La console (les erreurs connues hors moteur sont filtrées par le lanceur, `ctx.clientErrors`).
        const errors = await ctx.clientErrors();
        if ( process.env.PILE ) for ( const e of errors ) console.log(JSON.stringify(e).slice(0, 3000));
        // Une aptitude prêtée hors de sa classe : ses formules citent une échelle ou un niveau que le Lanceur n'a pas.
        if ( !isSpell && errors.length && /@(scale|classes)\./.test(JSON.stringify(activity)) ) {
          run.issues.length = 0;
          run.skipped = "formules de classe (échelle, niveau) absentes du Lanceur";
          continue;
        }
        for ( const e of errors ) bad(`erreur : ${[e.message ?? e.text ?? e, e.stack ?? ""].join(" ").replace(/\s+/g, " ").slice(0, process.env.PILE ? 1500 : 200)}`);
      }
      catch ( err ) { bad(`interrompu : ${err.message.slice(0, 200)}`); }
      finally { await cleanup(); }
    }
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId }).catch(() => {});
    const issues = row.runs.flatMap(x => x.issues.map(i => `${x.activity} — ${i}`));
    ctx.log(`${issues.length ? "✗" : "✓"} ${data.name} (${row.level})${issues.length ? ` : ${issues.join(" ; ")}` : ""}${row.notes.length ? ` [${row.notes.join(" ; ")}]` : ""}`);
    for ( const i of issues ) ctx.expect(false, `${data.name} : ${i}`);
  }

  const date = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  mkdirSync("prive/balayages", { recursive: true });
  writeFileSync(`prive/balayages/${kind}-${date}.json`, JSON.stringify(report, null, 1));
  const spells = kind === "sorts";
  const md = [`| ${spells ? "Sort" : "Aptitude"} | ${spells ? "Niv." : "Prérequis"} | Moteur | Constats |`, "|---|---|---|---|"].concat(report.map(r => {
    const issues = r.runs.flatMap(x => x.issues.map(i => `${x.activity} : ${i}`).concat(x.skipped ? [`${x.activity} : non joué (${x.skipped})`] : [])).concat(r.notes);
    return `| ${r.name} | ${r.level} | ${r.engine.join(", ")} | ${issues.join(" ; ").replace(/\|/g, "/") || "✓"} |`;
  }));
  writeFileSync(`prive/balayages/${kind}-${date}.md`, md.join("\n") + "\n");
  ctx.log(`rapport : prive/balayages/${kind}-${date}.md`);
}
