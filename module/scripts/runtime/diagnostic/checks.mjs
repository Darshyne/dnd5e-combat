/**
 * Les vérifications du diagnostic (SPEC §177) : celles des macros « Outils du MJ » (tools/macros/, SPEC §56), dont elles reprennent
 * la logique à l'identique, découpée en tâches. Une vérification ne modifie rien : `scan()` rend des tâches
 *   { check, root, where, text, apply?, preselect }
 * `root` : le document à sauvegarder avant de réparer (backup.mjs, `rootOf`) ; `apply()` répare et rend la phrase du compte rendu ;
 * une tâche sans `apply` est seulement signalée. Les textes sont ceux des macros (clés DND5ECOMBAT.Macro.*).
 */
import { MODULE_ID } from "../../constants.mjs";
import { loc, esc } from "../shared.mjs";
import { rootOf } from "./backup.mjs";
import { fresh } from "./fresh.mjs";
import { basicActionData } from "../../adapter/basics.mjs";
import { scrollSpellOf } from "../../adapter/scrolls.mjs";
import { localizeEffectNames } from "../../core/localize.mjs";
import { DDB_IMPORTER, importerErrors, importerOf } from "../../core/importer.mjs";
import { referenceReader, retranslationOf, applyRetranslation } from "../../adapter/retranslate.mjs";
import { contentOf } from "../../adapter/content.mjs";
import { dataFixPlanOf, applyDataFixes } from "../../adapter/data-fixes.mjs";
import { sourceKind } from "../../core/item-sources.mjs";
import { withDataFixes } from "../../core/data-fixes.mjs";
import { unmarkedItemEffects, unmarkedAppliedEffects, markEffects } from "../../adapter/antimagic.mjs";
import { phbDifferences, phbShape, renamedSourceItem, citesSubclass } from "../../core/phb-update.mjs";
import { spellDuplicates } from "../../core/spell-duplicates.mjs";
import { missingModifications, modifyOrigin } from "../../core/modify-item.mjs";

/**
 * §202 : les effets d'une référence du compendium, prêts à recopier — un effet au nom d'origine (anglais) de l'objet prend le nom
 * traduit de la référence, pour une traduction qui ne traduit pas les noms d'effets (core/localize.mjs).
 */
const effectsOf = (reference, effects=reference.effects) =>
  localizeEffectNames(effects.map(e => (e.toObject ? e.toObject() : e)), reference.flags?.babele?.originalName ?? null, reference.name);

const tr = prefix => (key, data) => loc(`Macro.${prefix}.${key}`, data);

/** §456 : un objet supprimé pour être recréé aussitôt (remplacement) — `leavesEffects` ne doit pas jouer (runtime/leaves.mjs). */
const replacing = () => ({ [MODULE_ID]: { replacing: true } });

/**
 * §456 : la référence du compendium telle que le moteur la rend (ses `dataFixes` appliqués). Comparée brute, un objet corrigé sur la fiche
 * (Sanctuaire de dame Nature, Coup brutal) paraissait « différent du Manuel » : `phb3-items` le remplaçait, la correction le refaisait.
 */
const fixedReference = doc => withDataFixes(doc.toObject(), contentOf(doc).entry?.dataFixes).data;

/**
 * Les objets propres à un token non lié : ceux de la SOURCE de son delta. Côté client, `token.delta.items` énumère l'inventaire
 * fusionné (base + delta) : les anciennes macros traitaient ainsi aussi, à travers chaque token, les objets de l'acteur de base (vu en
 * jeu le 2026-10-13 : réparer l'acteur puis son token échouait sur un objet de base déjà retiré).
 */
const ownItemIds = token => (token._source?.delta?.items ?? []).map(i => i._id);

/** Tous les objets du monde : objets du monde, objets des fiches, objets propres aux tokens non liés (leur delta seulement). */
function allItems() {
  const found = [];
  for ( const item of game.items ) found.push(item);
  for ( const actor of game.actors ) for ( const item of actor.items ) found.push(item);
  for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
    if ( token.actorLink || !token.actor ) continue;
    for ( const id of ownItemIds(token) ) {
      const item = token.actor.items.get(id);
      if ( item ) found.push(item);
    }
  }
  return found;
}

/** « Fiche — objet », ou « Monde — objet ». */
function whereOf(item) {
  const root = rootOf(item);
  return `<b>${esc(root?.type === "Item" ? loc("Diagnostic.Monde") : root?.name ?? "?")}</b> — ${esc(item.name)}`;
}

/* -------------------------------------------- */
/*  1. Midi-QOL, DAE, CPR (nettoyage-midi.js)     */
/* -------------------------------------------- */

const MIDI = (() => {
  const BAD = ["midi-qol", "midiProperties", "dae", "chris-premades", "gambits-premades", "itemacro", "autoanimations", "ActiveAuras",
    "times-up", "automated-conditions-5e", "darsh-automation", "cat", "link-item-resource-5e", "custom-character-sheet-sections", "boss-loot-assets-premium"];
  const OFFICIAL = /^Compendium\.(dnd-players-handbook|dnd-monster-manual|dnd5e)\./;
  const PHYSICAL = new Set(["weapon", "equipment", "consumable", "loot", "tool", "container"]);
  const STRIP_ONLY = new Set(["spirit-shroud", "anneau-de-chaleur-maudit", "staff"]);
  const RENAMED = { "blfx-scorching-ray": "scorching-ray", "bullseye-lantern-11438": "bullseye-lantern", "arcane-ward-resource-usage-10010": "arcane-ward" };
  const PACK_ORDER = ["dnd-players-handbook.equipment", "dnd-players-handbook.spells", "dnd-players-handbook.feats", "dnd-players-handbook.origins",
    "dnd-players-handbook.classes", "dnd5e.equipment24", "dnd5e.spells24", "dnd5e.feats24", "dnd5e.origins24", "dnd5e.classes24"];
  const THIRD_PARTY = /^Compendium.(chris-premades|midi-item-showcase|forge-vtt-shared|boss-loot)|^Compendium.world.ddb/;
  const PACT_TYPES = ["necrotic", "psychic", "radiant"];
  const MACRO_KEY = /midi-qol|chris-premades|DamageBonusMacro|ItemMacro/;
  return { BAD, OFFICIAL, PHYSICAL, STRIP_ONLY, RENAMED, PACK_ORDER, THIRD_PARTY, PACT_TYPES, MACRO_KEY };
})();

const hasBad = flags => Object.keys(flags ?? {}).some(k => MIDI.BAD.includes(k));
const cleanFlags = flags => Object.fromEntries(Object.entries(foundry.utils.deepClone(flags ?? {})).filter(([k]) => !MIDI.BAD.includes(k)));
const deletion = flags => {
  const del = foundry.data.operators.ForcedDeletion;
  return Object.fromEntries(Object.keys(flags ?? {}).filter(k => MIDI.BAD.includes(k)).map(k => [`flags.${k}`, new del()]));
};
const badEffect = e => hasBad(e.flags) || (e.type !== "base" && e.type !== "enchantment")
  || (e.system?.changes ?? e.changes ?? []).some(c => MIDI.MACRO_KEY.test(c.key ?? ""));
// §276 : un objet d'un autre module officiel (Ravenloft…) n'est pas « à reprendre » pour sa seule source.
const needsWork = item => hasBad(item.flags) || item.effects.some(badEffect) || (item.effects.invalidDocumentIds?.size > 0)
  || (sourceKind(item._stats?.compendiumSource) === "other");
const touchedByMidi = actor => hasBad(actor.flags) || actor.effects.some(e => hasBad(e.flags))
  || actor.items.some(i => hasBad(i.flags) || i.effects.some(e => hasBad(e.flags)) || MIDI.THIRD_PARTY.test(i._stats?.compendiumSource ?? ""));

async function officialFor(item) {
  const src = item._stats?.compendiumSource ?? "";
  const kind = sourceKind(src);
  if ( (kind === "reference") || (kind === "premium") ) { const doc = await fromUuid(src).catch(() => null); if ( doc ) return doc; }
  // §276 : jamais d'homonyme par identifiant pour un objet d'un autre module officiel — vu le 2026-10-28, le don « Survivant » de
  // Ravenloft (identifiant `survivor`) remplacé par l'aptitude « Survivor » du Champion.
  if ( kind === "premium" ) return null;
  const identifier = MIDI.RENAMED[item.system.identifier] ?? item.system.identifier;
  for ( const pack of MIDI.PACK_ORDER.map(id => game.packs.get(id)).filter(p => p?.documentName === "Item") ) {
    const index = await pack.getIndex({ fields: ["system.identifier"] });
    const hit = index.find(e => (e.system?.identifier === identifier) && (e.type === item.type));
    if ( hit ) return pack.getDocument(hit._id);
  }
  return null;
}

function midiReplacement(item, doc) {
  const data = doc.toObject();
  const old = item.toObject();
  data._id = item.id;
  const kept = cleanFlags(old.flags);
  data.flags = foundry.utils.mergeObject(foundry.utils.deepClone(data.flags ?? {}), { ...kept, babele: data.flags?.babele ?? kept.babele }, { inplace: false });
  if ( !data.flags.babele ) delete data.flags.babele;
  data._stats = { ...(data._stats ?? {}), compendiumSource: doc.uuid };
  data.sort = old.sort;
  const s = old.system ?? {};
  const keep = paths => { for ( const p of paths ) { const v = foundry.utils.getProperty(s, p); if ( v !== undefined ) foundry.utils.setProperty(data.system, p, v); } };
  keep(["uses.spent", "container"]);
  if ( item.type === "spell" ) keep(["method", "prepared", "sourceItem", "sourceClass", "ability"]);
  if ( MIDI.PHYSICAL.has(item.type) ) {
    if ( !(item.system.identifier in MIDI.RENAMED) ) { data.name = old.name; data.img = old.img; }
    keep(["quantity", "equipped", "attuned", "attunement", "identified"]);
  }
  for ( const [id, activity] of Object.entries(s.activities ?? {}) ) {
    if ( data.system.activities?.[id] && (activity.uses?.spent !== undefined) ) foundry.utils.setProperty(data.system.activities[id], "uses.spent", activity.uses.spent);
  }
  return data;
}

/** Le nettoyage d'une fiche, tel que la macro le fait : `dry` n'écrit rien. Rend les lignes du compte rendu. */
export async function cleanActor(actor, dry) {
  const t = tr("CleanMidi");
  const lines = [];
  const ids = identifier => actor.items.filter(i => i.system.identifier === identifier);
  for ( const item of [...actor.items] ) {
    // Un sort donné par un objet remplacé plus haut dans la boucle : dnd5e l'a retiré avec lui et recréé sous un autre id (#111).
    if ( !actor.items.has(item.id) ) continue;
    const id = item.system.identifier;
    const src = item._stats?.compendiumSource ?? "";
    const duplicate = (id === "dark-ones-blessing" && src.startsWith("Compendium.chris-premades") && ids(id).length > 1)
      || (id === "blade-ward" && !MIDI.OFFICIAL.test(src) && ids(id).length > 1)
      || (id === "arcane-ward-resource-usage-10010" && ids("arcane-ward").length > 0);
    if ( (id === "generic-actions") || duplicate ) {
      lines.push(`🗑 ${esc(item.name)}`);
      if ( !dry ) await item.delete();
      continue;
    }
    if ( !needsWork(item) ) continue;
    const doc = MIDI.STRIP_ONLY.has(id) || /^spell-scroll/.test(id) ? null : await officialFor(item);
    const custom = MIDI.PHYSICAL.has(item.type) && !!doc && (doc.name !== item.name) && !MIDI.THIRD_PARTY.test(src) && !(id in MIDI.RENAMED);
    if ( doc && !custom ) {
      lines.push(`♻ ${esc(item.name)} ← ${esc(doc.name)} (${esc(doc.uuid.replace("Compendium.", ""))})`);
      if ( !dry ) {
        const data = midiReplacement(item, doc);
        await actor.deleteEmbeddedDocuments("Item", [item.id], replacing());
        await actor.createEmbeddedDocuments("Item", [data], { keepId: true });
      }
      continue;
    }
    if ( !hasBad(item.flags) && !item.effects.some(badEffect) && !(item.effects.invalidDocumentIds?.size > 0) ) continue;
    const invalid = [...(item.effects.invalidDocumentIds ?? [])];
    const effects = item.effects.filter(badEffect);
    lines.push(`🧹 ${t("Cleaned", { name: esc(item.name), campaign: doc ? ` ${t("CampaignItem")}` : "",
      flags: Object.keys(deletion(item.flags)).map(k => k.slice(6)).join(", ") || "—" })}`
      + `${invalid.length ? ` ; ${t("AuraEffectsDeleted", { count: invalid.length })}` : ""}${effects.length ? ` ; ${t("EffectsCleaned", { names: esc(effects.map(e => e.name).join(", ")) })}` : ""}`);
    if ( dry ) continue;
    if ( invalid.length ) await item.deleteEmbeddedDocuments("ActiveEffect", invalid);
    const update = deletion(item.flags);
    if ( Object.keys(update).length ) await item.update(update);
    for ( const e of effects ) {
      const changes = (e.system?.changes ?? e.changes ?? []).filter(c => !MIDI.MACRO_KEY.test(c.key ?? ""));
      await e.update({ ...deletion(e.flags), "system.changes": changes });
    }
  }
  if ( ids("pact-of-the-blade").length ) {
    for ( const weapon of actor.items.filter(i => (i.type === "weapon") && (i.system.type?.value !== "natural")) ) {
      const base = weapon._source.system.damage?.base ?? {};
      const types = [...(base.types ?? [])];
      if ( !MIDI.PACT_TYPES.every(x => types.includes(x)) ) continue;
      const kept = types.filter(x => !MIDI.PACT_TYPES.includes(x));
      const bonus = /^\s*[+-]?\d+\s*$/.test(String(base.bonus ?? "")) ? "" : base.bonus;
      lines.push(`🗡 ${t("PactWeapon", { name: esc(weapon.name), types: types.join(", "), kept: kept.join(", ") || "—" })}`
        + `${bonus !== base.bonus ? `, ${t("FixedBonusRemoved", { bonus: esc(base.bonus) })}` : ""}`);
      if ( !dry ) await weapon.update({ "system.damage.base.types": kept, "system.damage.base.bonus": bonus ?? "" });
    }
  }
  const actorDeletion = deletion(actor.flags);
  if ( Object.keys(actorDeletion).length ) {
    lines.push(`🧹 ${t("SheetFlags", { flags: Object.keys(actorDeletion).map(k => k.slice(6)).join(", ") })}`);
    if ( !dry ) await actor.update(actorDeletion);
  }
  for ( const e of actor.effects ) {
    if ( !hasBad(e.flags) ) continue;
    lines.push(`🧹 ${esc(e.name)}`);
    if ( !dry ) await e.update(deletion(e.flags));
  }
  return lines;
}

const cleanMidi = {
  id: "clean-midi", icon: "fa-solid fa-flask",
  async scan() {
    const tasks = [];
    for ( const actor of game.actors.filter(touchedByMidi) ) {
      const lines = await cleanActor(actor, true);
      if ( !lines.length ) continue;
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text: lines.join("<br>"), preselect: actor.hasPlayerOwner,
        apply: async () => (await cleanActor(fresh(actor), false)).join("<br>") });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  2. Effets du Manuel des joueurs              */
/* -------------------------------------------- */

const phbEffects = {
  id: "phb-effects", icon: "fa-solid fa-ankh",
  async scan() {
    const SOURCES = /^Compendium\.dnd-players-handbook\.(origins|classes|feats)\.Item\./;
    const tasks = [];
    for ( const actor of game.actors ) for ( const item of actor.items ) {
      const source = item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId;
      if ( !source || !SOURCES.test(source) ) continue;
      const reference = await fromUuid(source).catch(() => null);
      if ( !reference?.effects?.size ) continue;
      // §438 : un objet d'une ancienne version dont l'identifiant ou les activités ont changé (Manuel 3.0.0) se remplace (`phb3-items`) ;
      // y recopier les effets neufs mélangerait les deux formes.
      if ( phbDifferences(phbShape(item.toObject()), phbShape(fixedReference(reference))).some(r => ["identifier", "activities"].includes(r)) ) continue;
      const missing = reference.effects.filter(e => !item.effects.has(e.id));
      if ( !missing.length ) continue;
      const copies = effectsOf(reference, missing);
      const names = esc(copies.map(e => e.name).join(", "));
      tasks.push({ root: rootOf(item), where: whereOf(item), text: names, preselect: true,
        apply: async () => {
          await fresh(item).createEmbeddedDocuments("ActiveEffect", copies, { keepId: true });
          return names;
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  3. Objets aux effets perdus                  */
/* -------------------------------------------- */

const lostEffects = {
  id: "item-effects", icon: "fa-solid fa-hammer",
  async scan() {
    const t = tr("RepairItems");
    const TYPES = new Set(["equipment", "weapon", "consumable", "tool", "loot", "container"]);
    const refs = new Map();
    for ( const id of ["dnd-dungeon-masters-guide.equipment", "dnd-players-handbook.equipment"] ) {
      const pack = game.packs.get(id);
      if ( !pack ) continue;
      const index = await pack.getIndex({ fields: ["system.identifier"] });
      for ( const e of index ) if ( e.system?.identifier && !refs.has(e.system.identifier) ) refs.set(e.system.identifier, { pack, id: e._id });
    }
    const cache = new Map();
    const reference = async identifier => {
      if ( !cache.has(identifier) ) { const r = refs.get(identifier); cache.set(identifier, r ? await r.pack.getDocument(r.id) : null); }
      return cache.get(identifier);
    };
    const tasks = [];
    for ( const scanned of allItems() ) {
      if ( !TYPES.has(scanned.type) ) continue;
      const item = scanned;
      const identifier = item.system?.identifier;
      if ( !identifier || !refs.has(identifier) ) continue;
      const ref = await reference(identifier);
      if ( !ref?.effects?.size ) continue;
      const where = whereOf(item);
      const copies = effectsOf(ref);
      const names = esc(copies.map(e => e.name).join(", "));
      if ( item.effects.size ) {
        if ( ref.effects.some(e => !item.effects.has(e.id)) ) tasks.push({ root: rootOf(item), where, text: t("LineDifferent", { where, names }) });
        continue;
      }
      tasks.push({ root: rootOf(item), where, text: t("LineToCopy", { where, names }), preselect: true,
        apply: async () => {
          const item = fresh(scanned);
          if ( ref.effects.some(e => e.type === "enchantment") ) {
            // Des effets d'enchantement ne s'ajoutent pas à un objet existant (dnd5e les refuse, data/active-effect/enchantment.mjs,
            // `_preCreate`) : l'objet est remplacé par une copie neuve du compendium, qui garde nom, quantité, conteneur, prix,
            // ordre et flags des autres modules.
            const data = game.items.fromCompendium(ref);
            data.name = item.name;
            data.effects = effectsOf(ref, data.effects ?? []);
            data.sort = item.sort;
            Object.assign(data.system, { quantity: item.system.quantity, container: item.system.container ?? null, price: item.system.price ?? data.system.price });
            for ( const [scope, value] of Object.entries(item.flags ?? {}) ) if ( !["dnd5e", "core"].includes(scope) ) data.flags[scope] = foundry.utils.deepClone(value);
            if ( item.parent ) await item.parent.createEmbeddedDocuments("Item", [data]);
            else await Item.implementation.create({ ...data, folder: item.folder?.id ?? null });
            await item.delete();
            return t("LineReplaced", { where, names });
          }
          await item.createEmbeddedDocuments("ActiveEffect", copies, { keepId: true });
          const refused = ref.effects.filter(e => !item.effects.has(e.id)).map(e => e.name);
          if ( refused.length ) throw new Error(t("EffectsRefused", { names: esc(refused.join(", ")) }));
          return t("LineCopied", { where, names });
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  4. Parchemins de sort                        */
/* -------------------------------------------- */

const scrolls = {
  id: "scrolls", icon: "fa-solid fa-scroll",
  async scan() {
    const t = tr("Scrolls");
    const isScroll = item => (item.type === "consumable") && (item.system?.type?.value === "scroll");
    const legacyOf = item => {
      const source = item._stats?.compendiumSource ?? "";
      if ( source.startsWith("Compendium.dnd5e.items.") ) return t("LegacyOldCompendium");
      if ( item.flags?.ddbimporter ) return t("LegacyDdb");
      if ( item.flags?.["chris-premades"] || item.flags?.["midi-qol"] || item.flags?.midiProperties ) return t("LegacyMidi");
      return null;
    };
    let sources = null;
    const sourceOf = async identifier => {
      if ( !sources ) {
        sources = new Map();
        const FIRST = ["dnd-players-handbook.spells", "dnd5e.spells24"];
        const rank = pack => (FIRST.includes(pack.collection) ? FIRST.indexOf(pack.collection) : FIRST.length);
        for ( const pack of [...game.packs].filter(p => p.documentName === "Item").sort((a, b) => rank(a) - rank(b)) ) {
          const index = await pack.getIndex({ fields: ["system.identifier"] });
          for ( const e of index ) if ( (e.type === "spell") && e.system?.identifier && !sources.has(e.system.identifier) ) sources.set(e.system.identifier, e.uuid);
        }
      }
      return sources.get(identifier);
    };
    const tasks = [];
    for ( const scanned of allItems().filter(isScroll) ) {
      const item = scanned;
      if ( item.system.activities?.some?.(a => a.type === "cast") ) continue;   // format actuel : rien à faire
      const where = whereOf(item);
      const spell = scrollSpellOf(item);
      if ( !spell ) { tasks.push({ root: rootOf(item), where, text: t("LineNotFound", { where }) }); continue; }
      const label = t("SpellLabel", { identifier: spell.identifier, level: spell.level ?? "?" });
      const legacy = legacyOf(item);
      const noted = item.flags?.[MODULE_ID]?.scroll?.identifier ?? null;
      const note = { identifier: spell.identifier, level: spell.level, school: spell.school };
      if ( legacy ) {
        tasks.push({ root: rootOf(item), where, text: `${label} — ${t("LegacyFormat", { legacy })}`, preselect: true,
          apply: async () => {
            const item = fresh(scanned);
            const uuid = await sourceOf(spell.identifier);
            if ( !uuid ) throw new Error(t("SpellNotInCompendiums"));
            const source = await fromUuid(uuid);
            const scroll = await CONFIG.Item.documentClass.createScrollFromSpell(source, {}, { dialog: false, level: spell.level ?? source.system.level });
            if ( !scroll ) throw new Error(t("ScrollNotCreated"));
            const data = scroll.toObject();
            const { ForcedReplacement, ForcedDeletion } = foundry.data.operators;
            await item.update({
              name: data.name,
              "system.activities": ForcedReplacement.create(data.system.activities),
              "system.description": data.system.description,
              "system.properties": data.system.properties,
              "system.source": data.system.source,
              "system.identifier": data.system.identifier,
              "system.uses.max": data.system.uses?.max ?? item.system.uses?.max,
              "flags.dnd5e.spellLevel": data.flags?.dnd5e?.spellLevel ?? item.flags?.dnd5e?.spellLevel,
              "flags.dnd5e.scaling": data.flags?.dnd5e?.scaling ?? 0,
              [`flags.${MODULE_ID}.scroll`]: note,
              "flags.ddbimporter": new ForcedDeletion(),
              "flags.midi-qol": new ForcedDeletion(),
              "flags.midiProperties": new ForcedDeletion(),
              "flags.chris-premades": new ForcedDeletion()
            });
            if ( item.effects.size ) await item.deleteEmbeddedDocuments("ActiveEffect", item.effects.map(e => e.id));
            if ( data.effects?.length ) await item.createEmbeddedDocuments("ActiveEffect", data.effects, { keepId: true });
            return t("LineRebuilt", { where, label, legacy, name: esc(data.name) });
          } });
      } else if ( noted !== spell.identifier ) {
        tasks.push({ root: rootOf(item), where, text: `${label} — ${t("ToNote")}`, preselect: true,
          apply: async () => {
            await fresh(scanned).update({ [`flags.${MODULE_ID}.scroll`]: note });
            return t("LineNoted", { where, label, legacy: "" });
          } });
      }
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  4 bis. Objets importés de D&D Beyond          */
/* -------------------------------------------- */

/**
 * §245 (issue #21) : un objet importé par DDB Importer (`flags.ddbimporter`) porte ses activités et ses effets sous d'autres ids que
 * l'objet officiel (Manuel, SRD). Une règle du contenu qui cite l'un de ces ids ne trouve rien : l'automatisation de l'objet peut ne
 * rien faire (l'Armure d'Agathys donnait ses PV temporaires, pas sa riposte). Le moteur ne s'y adapte pas, par décision : le
 * diagnostic les signale, sans rien réparer. Ne sont retenus que les objets dont la règle cite un id d'activité ou d'effet de l'objet
 * officiel absent de l'objet importé ; sans objet officiel dans le monde, les ids cités qui ont l'allure d'un id Foundry (16
 * caractères, au moins un chiffre).
 * @returns {Promise<Array<{item: Item, official: Item|null, viaMidi: boolean}>>}
 */
export const ddbItemsAtRisk = () => importedItemsAtRisk(DDB_IMPORTER.id);

/**
 * Les importeurs déclarés par d'autres modules (`registerImporter`), dans l'ordre : chacun a sa vérification, après « ddb ».
 * @type {Map<string, {id: string, flag: string, name: string, hint: string, icon: string}>}
 */
const IMPORTERS = new Map();

/**
 * Un autre module déclare son importeur d'objets : le diagnostic liste ceux de ses objets dont la règle cite un id que l'objet n'a
 * pas, et les remplace par l'objet officiel comme pour DDB Importer (même id, état de la fiche et flags de l'importeur gardés ;
 * pas de verrou). Une seconde déclaration du même `id` par le même appelant remplace la première.
 * @param {{id: string, flag: string, name: string, hint?: string, icon?: string}} def  voir core/importer.mjs, `importerErrors`
 * @returns {string}  l'id de sa vérification
 */
export function registerImporter(def) {
  const errors = importerErrors(def, [...IMPORTERS.values()].filter(other => other.id !== def?.id));
  if ( errors.length ) throw new Error(`${MODULE_ID} | diagnostic.registerImporter: ${errors.join(" ; ")}`);
  IMPORTERS.set(def.id, Object.freeze({ id: def.id, flag: def.flag, name: def.name, hint: def.hint ?? "",
    icon: def.icon ?? "fa-solid fa-file-import" }));
  return importedCheckId(def.id);
}

/** L'importeur n'est plus déclaré. @returns {boolean} s'il l'était */
export function unregisterImporter(id) {
  return IMPORTERS.delete(id);
}

const importedCheckId = id => `imported-${id}`;

/** @param {string} importer  l'id de l'importeur examiné (`importerOf`) */
async function importedItemsAtRisk(importer) {
  const out = [];
  const declared = [...IMPORTERS.values()];
  for ( const item of allItems() ) {
    if ( importerOf(item.flags, declared) !== importer ) continue;
    const { entry } = contentOf(item);
    if ( !entry ) continue;
    const cited = new Set(JSON.stringify(entry).match(/[A-Za-z0-9]{16}/g) ?? []);
    if ( !cited.size ) continue;
    const official = await officialFor(item).catch(() => null);
    const idsOf = doc => new Set([...Object.keys(doc?._source?.system?.activities ?? {}), ...(doc?.effects?.map(e => e.id) ?? [])]);
    const own = idsOf(item);
    const reference = official ? idsOf(official) : null;
    const relevant = [...cited].filter(id => reference ? reference.has(id) : /\d/.test(id));
    if ( !relevant.some(id => !own.has(id)) ) continue;
    // La vérification « Midi-QOL » remplace déjà cet objet par l'officiel (fiche touchée par Midi, objet à reprendre).
    const actor = item.parent?.documentName === "Actor" ? item.parent : null;
    const viaMidi = !!official && !!actor && touchedByMidi(actor) && needsWork(item);
    out.push({ item, official, viaMidi });
  }
  return out;
}

/**
 * Les objets que la réparation ne remplace pas : classes, sous-classes et origines, et tout objet officiel à avancements — les choix
 * faits sur la fiche (compétences, dons, valeurs d'échelle…) vivent dans ses avancements et ne passent pas d'une version à l'autre.
 */
const DDB_BY_HAND = new Set(["class", "subclass", "background", "race"]);
const ddbRepairable = official => !DDB_BY_HAND.has(official.type)
  && !Object.keys(official._source?.system?.advancement ?? {}).length;

/**
 * L'objet officiel à la place de l'objet importé, comme la vérification Midi-QOL (`midiReplacement` : même id, état de la fiche
 * gardé). `flags.ddbimporter` reste : DDB Importer apparie ses objets par `flags.ddbimporter.id` et le nom, ou par `id` +
 * `definitionId` (sorts, objets ; pas les aptitudes). Sans verrou, la synchro suivante le recrée en version DDB, sous le même id ;
 * avec le verrou (`ignoreItemImport`, l'option « Ignore this item » de DDB Importer), elle le laisse tel quel — et le garde même
 * retiré de D&D Beyond. Verrouillé, un objet sans `definitionId` garde son nom DDB, sans quoi la synchro ne le reconnaîtrait plus et
 * ajouterait la version DDB à côté.
 */
function ddbReplacement(item, doc, { lock=false }={}) {
  const data = midiReplacement(item, doc);
  const ddbFlags = foundry.utils.deepClone(item._source.flags?.ddbimporter ?? {});
  if ( lock ) {
    ddbFlags.ignoreItemImport = true;
    if ( ddbFlags.definitionId === undefined ) data.name = item._source.name;
  }
  data.flags.ddbimporter = ddbFlags;
  if ( !item.parent ) data.folder = item._source.folder ?? null;
  return data;
}

const ddb = {
  id: "ddb", group: "ddb", icon: "fa-brands fa-d-and-d-beyond", options: [{ id: "lock", default: false }],
  async scan() {
    const t = tr("Ddb");
    return (await ddbItemsAtRisk()).map(({ item, official, viaMidi }) => {
      const name = esc(item.name);
      const where = whereOf(item);
      const root = rootOf(item);
      if ( viaMidi ) return { root, where, text: t("LineMidi", { name, official: esc(official.name) }) };
      if ( !official ) return { root, where, text: t("LineNone", { name }) };
      const target = { name, official: esc(official.name), pack: esc(official.pack ?? "") };
      if ( !ddbRepairable(official) ) return { root, where, text: t("LineByHand", target) };
      const text = t("LineRepair", target);
      return { root, where, text, preselect: true,
        apply: async ({ lock=false }={}) => {
          const current = fresh(item);
          const data = ddbReplacement(current, official, { lock });
          const parent = current.parent;
          if ( parent ) {
            await parent.deleteEmbeddedDocuments("Item", [current.id], replacing());
            await parent.createEmbeddedDocuments("Item", [data], { keepId: true });
          } else {
            await current.delete();
            await Item.implementation.create(data, { keepId: true });
          }
          return lock ? `${text} ${t("Locked")}` : text;
        } };
    });
  }
};

/* -------------------------------------------- */
/*  4 ter. Objets d'un importeur déclaré          */
/* -------------------------------------------- */

/**
 * La vérification d'un importeur déclaré par un autre module : comme « ddb », sans verrou (le moteur ne sait rien de sa
 * synchronisation). Les flags de l'importeur restent (`midiReplacement` garde les flags de l'objet) ; un objet du monde garde son
 * dossier. Son nom et son aide viennent de la déclaration (`name`, `hint`), pas des traductions du moteur.
 */
function importedCheck(def) {
  return {
    id: importedCheckId(def.id), icon: def.icon, name: def.name, hint: def.hint,
    async scan() {
      const t = tr("Ddb");
      return (await importedItemsAtRisk(def.id)).map(({ item, official, viaMidi }) => {
        const name = esc(item.name);
        const where = whereOf(item);
        const root = rootOf(item);
        if ( viaMidi ) return { root, where, text: t("LineMidi", { name, official: esc(official.name) }) };
        if ( !official ) return { root, where, text: t("LineNone", { name }) };
        const target = { name, official: esc(official.name), pack: esc(official.pack ?? "") };
        if ( !ddbRepairable(official) ) return { root, where, text: t("LineByHand", target) };
        const text = t("LineRepair", target);
        return { root, where, text, preselect: true,
          apply: async () => {
            const current = fresh(item);
            const data = midiReplacement(current, official);
            const parent = current.parent;
            if ( parent ) {
              await parent.deleteEmbeddedDocuments("Item", [current.id], replacing());
              await parent.createEmbeddedDocuments("Item", [data], { keepId: true });
            } else {
              data.folder = current._source.folder ?? null;
              await current.delete();
              await Item.implementation.create(data, { keepId: true });
            }
            return text;
          } };
      });
    }
  };
}

/* -------------------------------------------- */
/*  5. Actions de base sur les tas d'Item Piles   */
/* -------------------------------------------- */

const pileBasics = {
  id: "item-piles", icon: "fa-solid fa-sack-xmark",
  async scan() {
    const isPile = actor => actor?.flags?.["item-piles"]?.data?.enabled === true;
    const isBasic = item => !!item.flags?.[MODULE_ID]?.basicAction;
    const tasks = [];
    const add = (actor, basics) => {
      if ( !basics.length ) return;
      const root = rootOf(actor);
      tasks.push({ root, where: `<b>${esc(root.name)}</b>`, text: esc(basics.map(i => i.name).join(", ")), preselect: true,
        apply: async () => {
          await fresh(actor).deleteEmbeddedDocuments("Item", basics.map(i => i.id));
          return esc(basics.map(i => i.name).join(", "));
        } });
    };
    for ( const actor of game.actors ) if ( isPile(actor) ) add(actor, actor.items.filter(isBasic));
    for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
      if ( token.actorLink || !token.actor || !isPile(token.actor) ) continue;
      const own = new Set(ownItemIds(token));
      add(token.actor, token.actor.items.filter(i => isBasic(i) && own.has(i.id)));
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  6. Fiches de créatures                       */
/* -------------------------------------------- */

const creatures = {
  id: "creatures", icon: "fa-solid fa-paw",
  async scan() {
    const t = tr("RepairCreatures");
    const RENAMED = { "tactique-de-meute": "pack-tactics", "esquive-instinctive": "uncanny-dodge", "ascendance-feerique": "fey-ancestry",
      "forme-brumeuse": "misty-form" };
    const BASIC = { dash: "dash", course: "dash", foncer: "dash", disengage: "disengage", desengagement: "disengage",
      "se-desengager": "disengage", dodge: "dodge", esquive: "dodge", esquiver: "dodge", help: "help", aider: "help", hide: "hide",
      "se-cacher": "hide", ready: "ready", preparer: "ready", "se-preparer": "ready" };
    const kebab = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const idOf = item => item.system?.identifier || kebab(item.name);
    const tasks = [];
    for ( const actor of game.actors ) {
      if ( !["npc", "character"].includes(actor.type) ) continue;
      for ( const item of actor.items ) {
        const id = idOf(item);
        const where = whereOf(item);
        if ( RENAMED[id] && (item.system.identifier !== RENAMED[id]) ) {
          const what = t("WhatRename", { from: item.system.identifier || t("Empty"), to: RENAMED[id] });
          tasks.push({ root: rootOf(item), where, text: what, preselect: true,
            apply: async () => { await fresh(item).update({ "system.identifier": RENAMED[id] }); return what; } });
        } else if ( (actor.type === "npc") && (item.type === "feat") && BASIC[id] && !item.getFlag(MODULE_ID, "basicAction") ) {
          const what = t("WhatBasic", { to: BASIC[id] });
          tasks.push({ root: rootOf(item), where, text: what, preselect: true,
            apply: async () => {
              // Une seule action de base du moteur par sorte : une seconde copie CPR de la même action est seulement retirée.
              const owner = fresh(actor);
              if ( !owner.items.some(i => i.getFlag(MODULE_ID, "basicAction") === BASIC[id]) ) {
                await owner.createEmbeddedDocuments("Item", [basicActionData(BASIC[id])]);
              }
              await fresh(item).delete();
              return what;
            } });
        }
      }
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  7. Textes restés dans la langue d'origine     */
/* -------------------------------------------- */

/**
 * §203 : reprendre la traduction actuelle des compendiums (celle de la langue de ce client, par Babele) pour les objets et acteurs
 * du monde qui en viennent et dont des textes sont restés dans la langue d'origine — importés avant l'installation d'une traduction,
 * ou par un client dans une autre langue, ou par un joueur sans droit de parcourir les fichiers (Babele ne traduit rien pour lui).
 * Babele garde sur chaque document traduit ses valeurs d'origine (`flags.babele.originalPayload`) : un champ n'est repris que s'il
 * vaut encore exactement l'original — un texte modifié à la main ne bouge pas (core/localize.mjs) ; les identifiants, les ids
 * d'activités et d'effets ne changent jamais (l'automatisation suit), un identifiant tiré du nom est figé. Les noms des tokens déjà posés
 * ne changent pas (ils ne sont pas dans la sauvegarde) ; ceux posés ensuite prennent le nom du token prototype.
 */
const retranslate = {
  id: "retranslate", icon: "fa-solid fa-language",
  async scan() {
    if ( !game.babele ) return [];
    const t = tr("Retranslate");
    const reference = referenceReader();
    const fieldsText = fields => [...new Set(fields.map(f => f.split(".")[0]))].map(f => t(`Field.${f}`)).join(", ");
    const tasks = [];
    const add = async (scanned, where) => {
      const plan = await retranslationOf(scanned, reference);
      if ( !plan.fields.length ) return;
      const text = t("Line", { name: esc(plan.update.name ?? scanned.name), fields: fieldsText(plan.fields) });
      tasks.push({ root: rootOf(scanned), where, text, preselect: true,
        apply: async () => { await applyRetranslation(fresh(scanned), plan); return text; } });
    };
    for ( const actor of game.actors ) await add(actor, `<b>${esc(actor.name)}</b>`);
    for ( const item of allItems() ) await add(item, whereOf(item));
    return tasks;
  }
};

/* -------------------------------------------- */
/*  8. Donnée premium à corriger                  */
/* -------------------------------------------- */

/**
 * O1 (§335) : les objets premium dont la donnée contredit la règle et que le moteur sait corriger (`dataFixes`, core/data-fixes.mjs) —
 * ce que le MJ actif fait à la création (runtime/data-fixes.mjs) pour ce qui existait déjà. Seuls les champs du plan changent ; une
 * valeur modifiée à la main (différente de l'origine déclarée) ne bouge pas.
 */
const dataFixes = {
  id: "data-fixes", icon: "fa-solid fa-screwdriver-wrench",
  async scan() {
    const t = tr("DataFixes");
    const tasks = [];
    for ( const scanned of allItems() ) {
      const plan = dataFixPlanOf(scanned);
      if ( !plan ) continue;
      const text = t("Line", { name: esc(scanned.name), count: plan.fields.length });
      tasks.push({ root: rootOf(scanned), where: whereOf(scanned), text, preselect: true,
        apply: async () => {
          const item = fresh(scanned);
          const now = dataFixPlanOf(item);
          if ( now ) await applyDataFixes(item, now);
          return text;
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  9. Effets magiques non marqués (antimagie)    */
/* -------------------------------------------- */

/**
 * §436 : la marque `system.magical` que la migration de dnd5e 6.1 pose sur les effets d'un sort, d'un parchemin ou d'un item `mgc`, et
 * que le moteur pose à la création (runtime/antimagic.mjs) — sans elle, le statut `antimagic` ne suspend pas l'effet. Ici, ce qui était
 * déjà sur les fiches : les effets des items magiques, et les effets posés sur les acteurs depuis eux. Rien d'autre ne change.
 */
const magicalEffects = {
  id: "magical-effects", icon: "fa-solid fa-wand-sparkles",
  async scan() {
    const t = tr("MagicalEffects");
    const tasks = [];
    for ( const scanned of allItems() ) {
      const ids = unmarkedItemEffects(scanned);
      if ( !ids.length ) continue;
      const text = t("Line", { name: esc(scanned.name), count: ids.length });
      tasks.push({ root: rootOf(scanned), where: whereOf(scanned), text, preselect: true,
        apply: async () => { await markEffects(fresh(scanned), ids); return text; } });
    }
    const actors = [...game.actors];
    for ( const scene of game.scenes ) for ( const token of scene.tokens ) if ( !token.actorLink && token.actor ) actors.push(token.actor);
    for ( const scanned of actors ) {
      const ids = unmarkedAppliedEffects(scanned);
      if ( !ids.length ) continue;
      const text = t("Line", { name: esc(scanned.name), count: ids.length });
      tasks.push({ root: rootOf(scanned), where: `<b>${esc(scanned.name)}</b>`, text, preselect: true,
        apply: async () => { await markEffects(fresh(scanned), ids); return text; } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  10. Manuel des joueurs 3.0.0                  */
/* -------------------------------------------- */

/**
 * §438 : les fiches faites avec le Manuel des joueurs 2.2.0 gardent leurs objets tels qu'ils étaient ; dnd5e 6.1.0 ne migre qu'un
 * identifiant de sous-classe (Cercle de la Lune, `SubclassData.#migrateMoonIdentifier`) et le module du Manuel n'a aucun code de
 * migration. Deux vérifications, à la demande de l'utilisateur (2026-11-14) :
 *  - `phb3-subclasses` : l'identifiant d'une sous-classe du Manuel remis à celui de sa référence (`vengeance` → `oath-vengeance`), et
 *    les sorts qu'elle a donnés (`system.sourceItem` « subclass:<id> », dnd5e.mjs:23417) suivis. Cochée d'office. L'aperçu signale les
 *    objets qui citent encore l'ancien identifiant dans une formule (`@scale.fey.…` des anciennes Frappes effroyables) : à remplacer ;
 *  - `phb3-items` : les aptitudes et sorts du Manuel dont la référence a changé (identifiant, activités, effets, contenu, avancement)
 *    remplacés par elle — même id, état de la fiche gardé (utilisations, préparation, origine d'avancement) comme le nettoyage de
 *    Midi-QOL le fait. Une tâche par fiche, l'aperçu liste chaque objet et ce qui change ; rien n'est coché d'office.
 */
const PHB_ITEM = /^Compendium\.dnd-players-handbook\.(classes|feats|origins|spells)\.Item\./;
const sourceOf = item => item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId ?? "";

const phb3Subclasses = {
  id: "phb3-subclasses", icon: "fa-solid fa-signature",
  async scan() {
    const t = tr("Phb3Subclasses");
    const tasks = [];
    for ( const item of allItems() ) {
      if ( (item.type !== "subclass") || !PHB_ITEM.test(sourceOf(item)) ) continue;
      const reference = await fromUuid(sourceOf(item)).catch(() => null);
      const from = item._source.system?.identifier ?? item.system.identifier;
      const to = reference?.system?.identifier;
      if ( !to || (from === to) ) continue;
      const actor = item.actor;
      const spells = (actor?.items ?? []).filter(i => (i.type === "spell") && renamedSourceItem(i._source.system?.sourceItem, from, to));
      const citing = (actor?.items ?? []).filter(i => (i !== item) && citesSubclass(i._source.system, from));
      const text = [t("Line", { from: esc(from), to: esc(to) }),
        spells.length ? t("Spells", { count: spells.length }) : null,
        citing.length ? `⚠ ${t("Cites", { from: esc(from), names: esc(citing.map(i => i.name).join(", ")) })}` : null].filter(Boolean).join("<br>");
      tasks.push({ root: rootOf(item), where: whereOf(item), text, preselect: true,
        apply: async () => {
          const own = fresh(item);
          await own.update({ "system.identifier": to });
          for ( const spell of spells ) await fresh(spell).update({ "system.sourceItem": renamedSourceItem(spell._source.system.sourceItem, from, to) });
          return text;
        } });
    }
    return tasks;
  }
};

/** L'objet du Manuel remplacé par sa référence : données de la référence, état de la fiche gardé (midiReplacement), plus sa classe. */
function phb3Replacement(item, reference) {
  const data = midiReplacement(item, reference);
  const old = item.toObject().system ?? {};
  if ( old.classIdentifier && !data.system.classIdentifier ) data.system.classIdentifier = old.classIdentifier;
  const grant = spellGrantOf(item);
  if ( grant ) {
    // §469 : un sort accordé par un avancement (Châtiment divin du Paladin, sort gratuit d'un don…) reçoit à l'octroi les réglages de cet
    // avancement — utilisations gratuites, récupération, activité « lancer gratuitement » (dnd5e, spell-config.mjs:78-118, appelé par
    // item-grant.mjs:119). La référence du compendium ne les a pas : on les réapplique comme dnd5e, l'usage dépensé gardé.
    grant.configuration.spell.applySpellChanges(data, { ability: grant.value?.ability });
    if ( old.uses?.spent !== undefined ) foundry.utils.setProperty(data, "system.uses.spent", old.uses.spent);
  }
  return data;
}

/**
 * §469 : l'avancement qui a accordé ce sort, s'il lui donne des réglages (`configuration.spell`) — retrouvé par le drapeau
 * `dnd5e.advancementOrigin` (« idObjet.idAvancement », advancement.mjs:385-391) sur la fiche du sort. Null sinon.
 */
function spellGrantOf(item) {
  if ( item.type !== "spell" ) return null;
  const [itemId, advancementId] = String(item.getFlag("dnd5e", "advancementOrigin") ?? "").split(".");
  const grant = item.parent?.items?.get(itemId)?.advancement?.byId?.[advancementId];
  return grant?.configuration?.spell?.applySpellChanges ? grant : null;
}

/** §469 : ce sort a-t-il perdu les utilisations gratuites que son avancement lui donne (remplacement d'avant le correctif) ? */
function lostSpellGrant(item) {
  const uses = spellGrantOf(item)?.configuration.spell.uses;
  return !!(uses?.max && uses?.per && !item._source.system?.uses?.max);
}

/** Les objets du Manuel d'une fiche à revoir : `{ item, reference, reasons }` (référence null : elle n'existe plus). */
async function phb3Outdated(actor) {
  const out = [];
  for ( const item of actor.items ) {
    if ( !["feat", "spell"].includes(item.type) || !PHB_ITEM.test(sourceOf(item)) ) continue;
    const reference = await fromUuid(sourceOf(item)).catch(() => null);
    if ( !reference ) { out.push({ item, reference: null, reasons: [] }); continue; }
    const reasons = phbDifferences(phbShape(item.toObject()), phbShape(fixedReference(reference)));
    if ( lostSpellGrant(item) ) reasons.push("grant");
    if ( reasons.length ) out.push({ item, reference, reasons });
  }
  return out;
}

const phb3Items = {
  id: "phb3-items", icon: "fa-solid fa-book-open",
  async scan() {
    const t = tr("Phb3Items");
    const tasks = [];
    for ( const actor of game.actors ) {
      const outdated = await phb3Outdated(actor);
      if ( !outdated.length ) continue;
      const lines = outdated.map(({ item, reference, reasons }) => reference
        ? `♻ ${esc(item.name)} — ${reasons.map(r => t(`Reason.${r}`)).join(", ")}`
        : `⚠ ${t("Gone", { name: esc(item.name) })}`);
      const replaceable = outdated.filter(o => o.reference);
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text: lines.join("<br>"), preselect: false,
        ...(replaceable.length ? { apply: async () => {
          const sheet = fresh(actor);
          const done = [];
          for ( const { item, reference } of replaceable ) {
            const current = sheet.items.get(item.id);
            if ( !current ) continue;
            const data = phb3Replacement(current, reference);
            await sheet.deleteEmbeddedDocuments("Item", [current.id], replacing());
            await sheet.createEmbeddedDocuments("Item", [data], { keepId: true });
            done.push(`♻ ${esc(current.name)} ← ${esc(reference.name)}`);
          }
          return done.join("<br>");
        } } : {}) });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  Sorts en double (doublons-sorts.js)          */
/* -------------------------------------------- */

/**
 * Les sorts en double d'une fiche (core/spell-duplicates.mjs) : un module de préparation des sorts qui reconnaît un sort par l'uuid de
 * son compendium d'origine ajoute une seconde copie d'un sort venu d'un autre compendium (SRD contre Manuel). Le sort gardé : celui du
 * Manuel des joueurs (les listes de sorts de classe du Manuel citent ses sorts), sinon du SRD 5.2. Une tâche par fiche.
 */
const PREFERRED_SPELL_PACKS = Object.freeze(["Compendium.dnd-players-handbook.spells.", "Compendium.dnd5e.spells24."]);

/** Le nom lisible du compendium d'où vient un sort, ou « créé à la main ». */
function spellSourceLabel(spell) {
  const source = sourceOf(spell);
  if ( !source.startsWith("Compendium.") ) return loc("Macro.SpellDuplicates.NoSource");
  const id = source.split(".").slice(1, 3).join(".");
  const pack = game.packs.get(id);
  if ( !pack ) return id;
  // Deux compendiums peuvent porter le même titre (« Spells » du Manuel et du SRD) : le paquet qui le livre les distingue.
  const { packageType, packageName } = pack.metadata;
  const owner = (packageType === "system") ? game.system?.title : (packageType === "module") ? game.modules.get(packageName)?.title : null;
  return owner ? `${owner} · ${pack.title}` : pack.title;
}

/** Les groupes de doublons d'une fiche, avec leurs documents. */
function spellDuplicatesOf(actor) {
  const spells = actor.itemTypes?.spell ?? [];
  const described = spells.map(s => ({
    id: s.id, name: s.name, identifier: s.system.identifier, method: s.system.method, prepared: Number(s.system.prepared) || 0,
    classIdentifier: s._source.system?.classIdentifier ?? "", sourceItem: s._source.system?.sourceItem ?? "", source: sourceOf(s),
    cachedFor: s.flags?.dnd5e?.cachedFor ?? null, flagScopes: Object.keys(s._source.flags ?? {}), sort: s.sort ?? 0
  }));
  const casterClasses = Object.keys(actor.spellcastingClasses ?? {});
  return spellDuplicates(described, { casterClasses, preferred: PREFERRED_SPELL_PACKS });
}

const spellDuplicatesCheck = {
  id: "spell-duplicates", icon: "fa-solid fa-clone",
  async scan() {
    const t = tr("SpellDuplicates");
    const state = p => t(`Prepared.${Number(p) || 0}`);
    const tasks = [];
    for ( const actor of game.actors ) {
      const groups = spellDuplicatesOf(actor);
      if ( !groups.length ) continue;
      const item = id => actor.items.get(id);
      const lines = groups.map(g => {
        const keep = item(g.keep.id);
        const raised = g.raisePrepared ? ` → ${state(g.prepared)}` : "";
        return `♊ ${t("Keep", { name: esc(keep.name), source: esc(spellSourceLabel(keep)), state: state(g.keep.prepared) + raised })}`
          + g.remove.map(r => ` ; ${t("Remove", { name: esc(item(r.id).name), source: esc(spellSourceLabel(item(r.id))), state: state(r.prepared) })}`).join("");
      });
      const text = lines.join("<br>");
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text, preselect: actor.hasPlayerOwner,
        apply: async () => {
          const sheet = fresh(actor);
          for ( const g of groups ) {
            const keep = sheet.items.get(g.keep.id);
            if ( !keep ) continue;
            const update = {};
            if ( g.raisePrepared ) update["system.prepared"] = g.prepared;
            for ( const { scope, from } of g.flagScopes ) {
              const value = sheet.items.get(from)?._source.flags?.[scope];
              if ( value !== undefined ) update[`flags.${scope}`] = foundry.utils.deepClone(value);
            }
            if ( Object.keys(update).length ) await keep.update(update);
            const ids = g.remove.map(r => r.id).filter(id => sheet.items.has(id));
            if ( ids.length ) await sheet.deleteEmbeddedDocuments("Item", ids);
          }
          return text;
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  Enchantements « ModifyItem » (enchantements-aptitudes.js) */
/* -------------------------------------------- */

/**
 * §453 : la progression « ModifyItem » de dnd5e 6.1 pose un enchantement de l'aptitude sur un autre objet de la fiche, seulement quand
 * elle s'applique et seulement sur les objets déjà là (dnd5e.mjs `ModifyItemAdvancement#apply`). Un sort appris après, ou une aptitude
 * remplacée par sa version du Manuel 3.0.0 (`phb3-items`), reste sans enchantement (core/modify-item.mjs). La réparation le pose comme
 * dnd5e : copie de l'effet de l'aptitude, `transfer`, marques `advancementOrigin` / `sourceId`, origine = l'aptitude (dnd5e crée alors
 * ses riders à la création de l'effet, `_onCreateOperation` → `collectRiders`), et l'inscrit dans `value.modified` de la progression,
 * riders compris, pour qu'une redescente de niveau le retire.
 */
async function modifyItemFeatures(actor) {
  const features = [];
  for ( const item of actor.items ) {
    const advancements = [];
    for ( const [id, adv] of Object.entries(item._source.system?.advancement ?? {}) ) {
      if ( adv?.type !== "ModifyItem" ) continue;
      const changes = [];
      for ( const c of adv.configuration?.changes ?? [] ) {
        const effect = c.uuid ? await fromUuid(c.uuid).catch(() => null) : item.effects.get(c._id);
        changes.push({ _id: c._id, uuid: c.uuid ?? null, identifiers: c.identifiers ?? [], effectName: effect?.name ?? "", exists: !!effect });
      }
      advancements.push({ id: adv._id ?? id, changes, modified: adv.value?.modified ?? [] });
    }
    if ( advancements.length ) features.push({ id: item.id, name: item.name, advancements });
  }
  return features;
}

async function missingEnchantmentsOf(actor) {
  const features = await modifyItemFeatures(actor);
  if ( !features.length ) return [];
  const targetsOf = key => [...(actor.identifiedItems?.get(key) ?? [])]
    .map(i => ({ id: i.id, name: i.name, dependent: !!i.flags?.dnd5e?.dependentOn }));
  const effectsOf = id => (actor.items.get(id)?.effects ?? []).map(e => ({ id: e.id, name: e.name, type: e.type,
    advancementOrigin: e.flags?.dnd5e?.advancementOrigin, sourceId: e.flags?.dnd5e?.sourceId }));
  return missingModifications(features, targetsOf, effectsOf);
}

/** Pose l'enchantement d'un changement sur l'objet visé, comme dnd5e, et l'inscrit dans la progression. */
async function applyModification(actor, { feature, advancement, change, target }) {
  const own = actor.items.get(feature.id);
  const item = actor.items.get(target.id);
  const effect = change.uuid ? await fromUuid(change.uuid) : own?.effects.get(change._id);
  if ( !own || !item || !effect ) return false;
  const data = effect.toObject();
  data._id = foundry.utils.randomID();
  data._stats = { ...(data._stats ?? {}), [effect.inCompendium ? "compendiumSource" : "duplicateSource"]: effect.uuid,
    [effect.inCompendium ? "duplicateSource" : "compendiumSource"]: null };
  foundry.utils.setProperty(data, "flags.dnd5e.advancementOrigin", modifyOrigin(own.id, advancement.id));
  foundry.utils.setProperty(data, "flags.dnd5e.sourceId", effect.uuid);
  foundry.utils.setProperty(data, "system.origin.item", own.uuid);
  data.transfer = true;
  const [created] = await item.createEmbeddedDocuments("ActiveEffect", [data], { keepId: true });
  if ( !created ) return false;
  // Les riders que dnd5e vient de créer (activités et effets de l'objet, objets de la fiche) dépendent de cet effet.
  const updated = actor.items.get(item.id);
  const rel = doc => foundry.utils.buildRelativeUuid(doc, actor);
  const riders = [
    ...(updated?.system.activities ?? []).filter(a => a.flags?.dnd5e?.dependentOn === created.id).map(a => `${rel(updated)}.Activity.${a.id}`),
    ...(updated?.effects ?? []).filter(e => e.flags?.dnd5e?.dependentOn === created.id).map(rel),
    ...actor.items.filter(i => i.flags?.dnd5e?.dependentOn === created.uuid).map(rel)
  ];
  const modified = foundry.utils.deepClone(own._source.system.advancement?.[advancement.id]?.value?.modified ?? []);
  modified.push({ change: change._id, effect: created.id, item: item.id, riders });
  await own.update({ [`system.advancement.${advancement.id}.value.modified`]: modified });
  return true;
}

const modifyItemCheck = {
  id: "modify-item", icon: "fa-solid fa-gem",
  async scan() {
    const t = tr("ModifyItem");
    const tasks = [];
    for ( const actor of game.actors ) {
      const missing = await missingEnchantmentsOf(actor);
      if ( !missing.length ) continue;
      const text = missing.map(m => `✨ ${t("Line", { feature: esc(m.feature.name), target: esc(m.target.name),
        effect: esc(m.change.effectName || m.feature.name) })}`).join("<br>");
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text, preselect: actor.hasPlayerOwner,
        apply: async () => {
          const sheet = fresh(actor);
          const done = [];
          // Relu au moment de réparer : une autre tâche, ou une montée de niveau, a pu le poser entre-temps.
          for ( const m of await missingEnchantmentsOf(sheet) ) {
            if ( await applyModification(sheet, m) ) done.push(`✨ ${t("Line", { feature: esc(m.feature.name), target: esc(m.target.name),
              effect: esc(m.change.effectName || m.feature.name) })}`);
          }
          return done.join("<br>");
        } });
    }
    return tasks;
  }
};

/** Les vérifications, dans l'ordre où les macros les proposaient. */
export const CHECKS = Object.freeze([cleanMidi, phbEffects, lostEffects, scrolls, ddb, pileBasics, creatures,
  retranslate, dataFixes, magicalEffects, phb3Subclasses, phb3Items, spellDuplicatesCheck, modifyItemCheck]);

/** Les vérifications du moment : celles du moteur, et, après « ddb », celle de chaque importeur déclaré par un autre module. */
export function allChecks() {
  const declared = [...IMPORTERS.values()].map(importedCheck);
  if ( !declared.length ) return CHECKS;
  const at = CHECKS.indexOf(ddb) + 1;
  return [...CHECKS.slice(0, at), ...declared, ...CHECKS.slice(at)];
}
