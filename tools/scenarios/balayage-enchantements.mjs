/**
 * §391 (issue #38, suite) : balayage des enchantements et transformations à PLUSIEURS profils (Arme élémentaire, Arme magique, Gourdin
 * magique, Frappe assurée, Empoisonneur, armes et armures +1/+2/+3 du DMG, Métamorphose suprême…) par les chemins qui sautent la fenêtre
 * de dnd5e :
 *   barre        `activity.use(…, { configure: false })` (avec l'emplacement de son niveau pour un sort) ;
 *   sans-empl.   un sort lancé par la fiche, emplacements vidés : « Plus de charge → Lancer quand même » (§77).
 * La fenêtre du moteur est répondue en prenant le DERNIER profil. Invariants : une fenêtre de choix s'ouvre ; si l'utilisation va à son
 * terme (`postUseActivity`), dnd5e reçoit le profil choisi ; aucune erreur dans la console. Une utilisation qui attend ensuite une cible
 * (Arme élémentaire : la créature puis son arme) est notée « suite attendue », sans défaut. La Forme sauvage (sa propre fenêtre, §16.39)
 * est sautée. Ne se joue que nommé : `node tools/scenario.mjs balayage-enchantements` ; `ITEMS=elemental-weapon,magic-weapon`.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const only = (process.env.ITEMS ?? "").split(",").filter(Boolean);
const PACKS = ["dnd-players-handbook.spells", "dnd-players-handbook.classes", "dnd-players-handbook.feats", "dnd-dungeon-masters-guide.equipment"];
const FULL = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));
const EMPTY = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 0, override: 0 }]));
const OWN = new Set(["wild-shape", "circle-forms"]);

export default {
  name: "balayage des enchantements et transformations à plusieurs profils (barre, sans emplacement)",
  scene: ARENE_SORTS.name,
  audit: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Lanceur") ) { ctx.log("Lanceur absent : lancer tools/arene-sorts.mjs"); return; }
    const caster = await ctx.token("Lanceur");
    // La cible désignée avant de lancer : une créature (Métamorphose suprême) ou le porteur de l'arme (Arme élémentaire, Arme magique).
    const target = await ctx.token(tokens.some(t => t.name === "Héros") ? "Héros" : (tokens.some(t => t.name === "Allié") ? "Allié" : "Lanceur"));
    const at = await ctx.position(caster);
    const effectsBefore = new Set(((await ctx.call("get-actor", { actorId: caster.actorId })).effects ?? []).map(e => e._id ?? e.id));
    // Les effets déjà posés sur les objets de la cible (ses enchantements à elle) : le test retire seulement ceux qu'il a posés.
    const itemEffects = async () => ((await ctx.call("get-actor", { actorId: target.actorId })).items ?? [])
      .flatMap(i => (i.effects ?? []).map(e => ({ item: i._id, effect: e._id ?? e.id })));
    const targetBefore = new Set((await itemEffects()).map(x => `${x.item}.${x.effect}`));
    const slots = table => ctx.call("update-actor", { actorId: caster.actorId, actorData: { system: { spells: { ...table, pact: { value: 0, override: 0 } } } } });
    const tidy = async () => {
      for ( const w of await ctx.engine("windows").catch(() => []) ) await ctx.engine("closeWindow", { id: w.id }).catch(() => {});
      for ( const d of (await ctx.call("list-dialogs", { dialogsOnly: false })).windows ?? [] ) {
        if ( /Usage|Dialog/.test(d.className ?? "") ) await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
      }
      for ( const x of (await itemEffects()).filter(x => !targetBefore.has(`${x.item}.${x.effect}`)) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${target.actorId}.Item.${x.item}`, effectId: x.effect }).catch(() => {});
      }
      for ( const e of ((await ctx.call("get-actor", { actorId: caster.actorId })).effects ?? []).filter(x => !effectsBefore.has(x._id ?? x.id)) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => { await tidy(); await slots(FULL); });

    const items = [];
    for ( const packId of PACKS ) {
      const index = await ctx.call("list-compendium-entries", { packId }).catch(() => []);
      for ( const e of (Array.isArray(index) ? index : []) ) {
        const { data } = await ctx.call("get-compendium-entry", { uuid: e.uuid });
        const id = data.system?.identifier;
        if ( only.length && !only.includes(id) ) continue;
        if ( OWN.has(id) ) continue;
        for ( const a of Object.values(data.system?.activities ?? {}) ) {
          if ( !["enchant", "transform"].includes(a.type) ) continue;
          const n = (a.type === "enchant") ? (a.effects ?? []).length : (a.profiles ?? []).length;
          if ( n > 1 ) { items.push({ uuid: e.uuid, data, type: a.type }); break; }
        }
      }
    }
    ctx.log(`${items.length} objet(s) à enchantement ou transformation à plusieurs profils`);
    const report = [];

    for ( const { uuid, data, type } of items ) {
      const id = data.system.identifier ?? data.name;
      const spell = data.type === "spell";
      const level = Number(data.system.level) || 0;
      const itemId = await ctx.ensureItem(caster, uuid);
      for ( const path of (spell && (level > 0)) ? ["barre", "sans-empl."] : ["barre"] ) {
        await slots(path === "sans-empl." ? EMPTY : FULL);
        await ctx.call("get-client-errors", { clear: true }).catch(() => {});
        const label = `${id} [${path}]`;
        const started = await ctx.engine("castFromBar", { tokenId: caster.id, itemId, type, sheet: path === "sans-empl.", targetIds: [target.id],
          slot: (spell && (path === "barre") && (level > 0)) ? `spell${level}` : null, x: at.x + ARENE_SORTS.grid, y: at.y }).catch(err => ({ error: err.message }));
        if ( started.error ) { report.push(`${label} : ${started.error}`); ctx.log(`${label} : ${started.error}`); continue; }
        let chose = null;
        let saw = false;
        const seen = new Set();
        const answered = new Set();
        let captured = null;
        for ( let i = 0; i < 16; i++ ) {
          captured = await ctx.engine("summonCaptured", {});
          if ( captured?.used ) break;
          const { windows = [] } = await ctx.call("list-dialogs", { details: true, dialogsOnly: false, waitMs: 500 });
          for ( const w of windows ) {
            seen.add(`${w.className}:${w.title}`);
            const radio = (w.fields ?? []).filter(f => f.name === "profile");
            if ( radio.length > 1 ) {
              saw = true;
              chose = radio.at(-1).value;
              await ctx.call("answer-dialog", { id: w.id, fields: { profile: chose }, button: "summon" }).catch(() => {});
            } else if ( (w.fields ?? []).some(f => ["enchantmentProfile", "transform.profile"].includes(f.name)) ) {
              // La fenêtre de dnd5e (ouverte par un chemin du moteur depuis la fiche : Arme élémentaire) propose le choix elle aussi.
              const field = w.fields.find(f => ["enchantmentProfile", "transform.profile"].includes(f.name));
              saw = saw || ((field.options ?? []).length > 1);
              chose = (field.options ?? []).at(-1)?.value ?? chose;
              await ctx.call("answer-dialog", { id: w.id, fields: { [field.name]: chose }, button: "use" }).catch(() => {});
            } else if ( (w.buttons ?? []).some(b => b.action === "yes") ) {
              await ctx.call("answer-dialog", { id: w.id, button: "yes" }).catch(() => {});
            } else if ( (w.className === "DialogV2") && (w.buttons ?? []).length && !answered.has(w.id) ) {
              // La suite d'un chemin du moteur (l'arme de la créature pour Arme élémentaire, Arme magique) : son bouton par défaut.
              answered.add(w.id);
              // Une fenêtre à cartes (l'arme de la créature) : la première carte ; sinon son bouton par défaut.
              const clicked = await ctx.engine("clickCard", { id: w.id }).catch(() => null);
              if ( !clicked?.clicked ) {
                const button = (w.buttons.find(x => x.default) ?? w.buttons[0]).action;
                await ctx.call("answer-dialog", { id: w.id, button }).catch(() => {});
              }
            }
          }
          if ( saw && (i > 12) ) break;
          await pause(300);
        }
        const used = captured?.used ?? null;
        const got = used ? (type === "enchant" ? used.enchantmentProfile : used.transformProfile) : null;
        const problems = [];
        // Un seul profil disponible à ce niveau (Arme magique +1 au niveau 2, Gourdin magique) : rien à choisir.
        if ( !saw && ((started.profiles?.length ?? 0) > 1) ) problems.push(`${started.profiles.length} profils, aucune fenêtre de choix (fenêtres vues : ${[...seen].join(" | ") || "aucune"})`);
        if ( used && chose && (got !== chose) ) problems.push(`dnd5e reçoit ${got}, pas le profil choisi`);
        await pause(800);
        const errors = ((await ctx.call("get-client-errors", { levels: ["error", "uncaught", "unhandledrejection"] }).catch(() => ({ entries: [] }))).entries ?? [])
          .filter(e => !/boss-loot-assets-premium/.test(String(e.text ?? "")));
        if ( errors.length ) problems.push(`erreur console : ${String(errors[0].text).slice(0, 120)}`);
        const note = used ? `profil reçu ${got === chose ? "= choisi" : got}` : `suite attendue (fenêtres : ${[...seen].join(" | ") || "aucune"})`;
        ctx.expect(!problems.length, `${label} : ${problems.length ? problems.join(" ; ") : note}`);
        report.push(`${label} : ${problems.length ? problems.join(" ; ") : "ok"}`);
        await tidy();
      }
    }
    ctx.log(`rapport : ${report.filter(r => !r.endsWith(": ok")).length} ligne(s) en défaut sur ${report.length}`);
  }
};
