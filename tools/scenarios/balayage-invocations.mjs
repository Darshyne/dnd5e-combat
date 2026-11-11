/**
 * §389 (issue #38) : balayage des invocations par les VRAIS chemins de lancement — les balayages de sorts et d'aptitudes
 * (`tools/lib/balayage.mjs`) sautent les activités « summon » et lancent tout avec `confirmed` : ni la barre d'actions, ni la fiche,
 * ni « Lancer quand même » n'y passaient, et Convocation de céleste (forme imposée), Création de morts-vivants (0 goule) n'avaient
 * rien pour les attraper. Ici, chaque sort du Manuel des joueurs qui invoque est prêté au Lanceur de l'« Arène des sorts » et lancé :
 *   barre        comme la barre de DAS · Combat UI : emplacement de son niveau, sans la fenêtre de dnd5e (`castFromBar`) ;
 *   fiche        comme un clic dans la fiche : fenêtre de dnd5e ou du moteur, consommation (`castFromBar({ sheet })`) ;
 *   sans-empl.   la fiche, emplacements vidés : le MJ passe par « Plus de charge → Lancer quand même » (§77, §384).
 * Les fenêtres sont répondues en choisissant la DERNIÈRE forme (une forme imposée d'office — la première — se voit) et, s'il y a un
 * nombre à choisir, 2. Invariants, sans dépendre des dés :
 *   1. plusieurs formes → une fenêtre de choix s'ouvre (celle du moteur ou celle de dnd5e) ;
 *   2. la forme choisie est celle que dnd5e invoque ;
 *   3. au moins une créature posée, autant que le nombre choisi (ou que dnd5e en compte) ;
 *   4. le sort part au moins à son niveau ;
 *   5. pas de créature du SRD 2014 quand le Monster Manual 2024 ou le SRD 2024 l'a (§386) ;
 *   6. aucune erreur dans la console du MJ.
 * Sautés (dit dans le rapport) : invocations « par FP » (dnd5e ouvre le navigateur de compendium : Appel de familier), Lumière et
 * Flamme éternelle (leur propre fenêtre, §16.35), invocations qui visent un objet ou une créature (Animation des objets, Doigt de mort). Ne se joue que nommé : `node tools/scenario.mjs balayage-invocations`. Variables :
 * `SORTS=summon-celestial,create-undead` (identifiants), `CHEMINS=barre,fiche` (par défaut les trois).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";
import { CONTENT } from "../../module/scripts/content/index.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const only = (process.env.SORTS ?? "").split(",").filter(Boolean);
// §392 : `OBJETS=1` balaie les objets magiques (DMG, SRD 2024) au lieu des sorts — pour un objet, la barre et la fiche passent par le
// même chemin (la fenêtre de dnd5e) : « fiche » seul.
const ITEMS = !!process.env.OBJETS;
const PACKS = ITEMS ? ["dnd-dungeon-masters-guide.equipment", "dnd5e.equipment24"] : ["dnd-players-handbook.spells"];
const PATHS = (process.env.CHEMINS ?? (process.env.OBJETS ? "fiche" : "barre,fiche,sans-empl.")).split(",").filter(Boolean);
const FULL = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));
const EMPTY = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 0, override: 0 }]));
const OWN_WINDOW = new Set(["light", "continual-flame"]);

export default {
  name: process.env.OBJETS ? "balayage des invocations des objets magiques (DMG, SRD 2024)" : "balayage des invocations par les vrais chemins (barre, fiche, sans emplacement)",
  scene: ARENE_SORTS.name,
  audit: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Lanceur") ) { ctx.log("Lanceur absent : lancer tools/arene-sorts.mjs"); return; }
    const caster = await ctx.token("Lanceur");
    const at = await ctx.position(caster);
    const grid = ARENE_SORTS.grid;
    const sceneId = (await ctx.scene()).sceneId;
    const mm = (await ctx.call("list-compendiums", {})).some(p => (p.id === "dnd-monster-manual.actors") || (p.id === "dnd5e.actors24"));
    const actorsBefore = new Set((await ctx.call("list-actors", {})).map(a => a.id));
    const effectsBefore = new Set(((await ctx.call("get-actor", { actorId: caster.actorId })).effects ?? []).map(e => e._id ?? e.id));
    const placed = new Set();
    const made = new Set();
    const slots = async table => ctx.call("update-actor", { actorId: caster.actorId, actorData: { system: { spells: { ...table, pact: { value: 0, override: 0 } } } } });

    const tidy = async () => {
      const live = (await ctx.call("list-scene-objects", { sceneId, type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of placed ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { sceneId, type: "Token", objectId: id }).catch(() => {});
      placed.clear();
      for ( const d of (await ctx.call("list-dialogs", { dialogsOnly: false })).windows ?? [] ) {
        if ( /Usage|Dialog/.test(d.className ?? "") ) await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
      }
      for ( const e of ((await ctx.call("get-actor", { actorId: caster.actorId })).effects ?? []).filter(x => !effectsBefore.has(x._id ?? x.id)) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      await tidy();
      await slots(FULL);
      for ( const id of made ) if ( !actorsBefore.has(id) ) await ctx.call("trash-document", { documentType: "Actor", documentId: id }).catch(() => {});
    });

    // Les sorts du Manuel qui invoquent (activité « summon »).
    const spells = [];
    for ( const packId of PACKS ) for ( const e of (await ctx.call("list-compendium-entries", { packId }).catch(() => [])) ?? [] ) {
      const { data } = await ctx.call("get-compendium-entry", { uuid: e.uuid });
      const id = data.system?.identifier;
      if ( only.length && !only.includes(id) ) continue;
      const summon = Object.values(data.system?.activities ?? {}).find(a => a.type === "summon");
      if ( summon ) spells.push({ uuid: e.uuid, data, summon });
    }
    spells.sort((a, b) => (a.data.system.level - b.data.system.level) || a.data.name.localeCompare(b.data.name));
    ctx.log(`${spells.length} sort(s) qui invoquent, chemins : ${PATHS.join(", ")}`);
    const report = [];

    for ( const { uuid, data, summon } of spells ) {
      const id = data.system.identifier;
      const level = Number(data.system.level) || 0;
      if ( summon.summon?.mode === "cr" ) { report.push(`${id} : sauté (invocation par FP, navigateur de compendium)`); continue; }
      if ( OWN_WINDOW.has(id) ) { report.push(`${id} : sauté (sa propre fenêtre, §16.35)`); continue; }
      // §394 : seules les invocations que le contenu fait viser (`targetedSummon` : Doigt de mort relève un cadavre) attendent un
      // clic — scénario `invocations-ciblees`, dans l'Arène des invocations.
      const affects = (summon.target?.override ? summon.target?.affects?.type : data.system.target?.affects?.type) ?? "";
      if ( CONTENT[id]?.targetedSummon ) {
        report.push(`${id} : sauté (vise ${affects} : attend un clic)`);
        ctx.log(`${id} : sauté (vise ${affects} : attend un clic)`);
        continue;
      }
      // §393 : un objet est prêté par son uuid (DMG et SRD 2024 partagent des identifiants), équipé et harmonisé.
      const itemId = await ctx.ensureItem(caster, uuid, ITEMS ? { byUuid: true, ready: true } : {});
      const forms = (summon.profiles ?? []).filter(p => ((p.level?.min ?? 0) <= level) && ((p.level?.max ?? 99) >= level)).length;
      for ( const path of PATHS ) {
        if ( (path === "sans-empl.") && (level < 1) ) continue;
        if ( (path === "barre") && (level < 1) ) continue;
        await slots(path === "sans-empl." ? EMPTY : FULL);
        await ctx.refill(caster, itemId);   // §393 : les charges du passage précédent
        await ctx.call("get-client-errors", { clear: true }).catch(() => {});
        const label = `${id} [${path}]`;
        const started = await ctx.engine("castFromBar", { tokenId: caster.id, itemId, sheet: path !== "barre",
          slot: (path === "barre") ? `spell${level}` : null, x: at.x + grid, y: at.y + (2 * grid) });
        const profiles = started.profiles ?? [];
        // Les fenêtres, jusqu'à ce que dnd5e invoque (ou abandonne) : on choisit la dernière forme, et 2 créatures s'il y a un nombre.
        let chose = null;
        let wanted = null;
        let sawChoice = false;
        let captured = null;
        for ( let i = 0; i < 24; i++ ) {
          captured = await ctx.engine("summonCaptured", {});
          if ( captured?.tokens ) break;
          const { windows = [] } = await ctx.call("list-dialogs", { details: true, waitMs: 500 });
          for ( const w of windows ) {
            const fields = w.fields ?? [];
            const radio = fields.filter(f => f.name === "profile");
            const select = fields.find(f => f.name === "summons.profile");
            const count = fields.find(f => f.name === "count");
            if ( radio.length || count ) {
              sawChoice = sawChoice || (radio.length > 1) || !!count;
              chose = radio.length ? radio[radio.length - 1].value : (chose ?? null);
              // En deux temps, comme un joueur : la forme d'abord (elle redessine la liste des nombres), puis le nombre.
              let state = w;
              if ( radio.length ) state = (await ctx.call("answer-dialog", { id: w.id, fields: { profile: chose }, waitMs: 300 }).catch(() => null))?.window ?? w;
              const counts = (state.fields ?? []).find(f => f.name === "count");
              wanted = (counts && (counts.options ?? []).some(o => o.value === "2")) ? 2 : null;
              await ctx.call("answer-dialog", { id: w.id, fields: wanted ? { count: "2" } : {}, button: "summon" }).catch(() => {});
            } else if ( select ) {
              sawChoice = sawChoice || ((select.options ?? []).length > 1);
              chose = (select.options ?? []).at(-1)?.value ?? null;
              await ctx.call("answer-dialog", { id: w.id, fields: { "summons.profile": chose }, button: "use" }).catch(() => {});
            } else if ( (w.buttons ?? []).some(b => ["yes", "go"].includes(b.action)) ) {
              await ctx.call("answer-dialog", { id: w.id, button: (w.buttons ?? []).some(b => b.action === "go") ? "go" : "yes" }).catch(() => {});
            } else if ( /UsageDialog/.test(w.className ?? "") ) {
              await ctx.call("answer-dialog", { id: w.id, button: "use" }).catch(() => {});
            }
          }
          await pause(300);
        }
        const tokensOut = captured?.tokens ?? [];
        for ( const t of tokensOut ) { placed.add(t.id); if ( t.actorId ) made.add(t.actorId); }
        const problems = [];
        if ( (forms > 1) && !sawChoice ) problems.push(`${forms} formes, aucune fenêtre de choix`);
        if ( chose && captured?.summoned?.profile && (captured.summoned.profile !== chose) ) problems.push(`forme invoquée ${captured.summoned.name || captured.summoned.profile}, pas celle choisie`);
        if ( !tokensOut.length ) problems.push("aucune créature posée");
        // §392 : la créature réellement invoquée existe (lien du DMG réparé) — dnd5e l'a posée sous ce nom.
        if ( tokensOut.length ) ctx.log(`${label} : ${tokensOut.map(t => t.name).join(", ")} (${String(captured?.summoned?.uuid ?? "").split(".").slice(1, 3).join(".")})`);
        const expected = Number(captured?.summoned?.count) || null;
        if ( wanted && expected && (expected !== wanted) ) problems.push(`${wanted} créature(s) choisie(s), dnd5e en compte ${expected}`);
        if ( tokensOut.length && expected && (tokensOut.length !== expected) ) problems.push(`${tokensOut.length} posée(s) pour ${expected} attendue(s)`);
        if ( captured?.summoned?.level && (captured.summoned.level < level) ) problems.push(`lancé au niveau ${captured.summoned.level} (sort de niveau ${level})`);
        if ( mm && String(captured?.summoned?.uuid ?? "").startsWith("Compendium.dnd5e.monsters.") ) problems.push("créature du SRD 2014");
        await pause(1500);
        const errors = (await ctx.call("get-client-errors", { levels: ["error", "uncaught", "unhandledrejection"] }).catch(() => ({ entries: [] }))).entries ?? [];
        // Une erreur d'animation de BLFX (module tiers) est notée à part, pas comptée contre le moteur.
        const blfx = e => /boss-loot-assets-premium/.test(String(e.text ?? e.message ?? ""));
        const ours = errors.filter(e => !blfx(e));
        if ( ours.length ) problems.push(`erreur console : ${String(ours[0].text).slice(0, 120)}`);
        if ( errors.length > ours.length ) ctx.log(`${label} : erreur d'animation de BLFX (tiers), non comptée`);
        ctx.expect(!problems.length, `${label} : ${problems.length ? problems.join(" ; ") : `${tokensOut.length} posée(s), niveau ${captured?.summoned?.level ?? "?"}`}`);
        report.push(`${label} : ${problems.length ? problems.join(" ; ") : "ok"}`);
        // L'animation d'apparition (BLFX, darsh-animations) tourne encore quelques secondes : retirer la créature avant qu'elle finisse
        // fait planter BLFX (« reading 'rotation' »), compté au lancement suivant.
        await pause(4000);
        await tidy();
      }
    }
    ctx.log(`rapport : ${report.filter(r => !r.endsWith(": ok")).length} ligne(s) en défaut sur ${report.length}`);
  }
};
