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
import { basicActionData } from "../../adapter/basics.mjs";
import { scrollSpellOf } from "../../adapter/scrolls.mjs";
import { localizeEffectNames, retranslateItem, retranslateActor } from "../../core/localize.mjs";

/**
 * §202 : les effets d'une référence du compendium, prêts à recopier — un effet au nom d'origine (anglais) de l'objet prend le nom
 * traduit de la référence, pour une traduction qui ne traduit pas les noms d'effets (core/localize.mjs).
 */
const effectsOf = (reference, effects=reference.effects) =>
  localizeEffectNames(effects.map(e => (e.toObject ? e.toObject() : e)), reference.flags?.babele?.originalName ?? null, reference.name);

/**
 * Le document tel qu'il est au moment de réparer. Une tâche garde le document de l'analyse ; entre-temps, une autre réparation a pu
 * faire recréer par le cœur l'acteur propre d'un token (vu : réparer l'acteur de base, puis son token non lié, échouait).
 */
function fresh(doc) {
  // L'acteur propre d'un token se relit par son token (son uuid seul ne rend pas l'acteur propre, vu en jeu) ; ses objets, par lui.
  if ( (doc?.documentName === "Actor") && doc.isToken ) return fromUuidSync(doc.token.uuid, { strict: false })?.actor ?? doc;
  if ( (doc?.parent?.documentName === "Actor") && doc.parent.isToken ) {
    const actor = fresh(doc.parent);
    return actor?.[doc.collectionName]?.get(doc.id) ?? doc;
  }
  return fromUuidSync(doc.uuid, { strict: false }) ?? doc;
}
const tr = prefix => (key, data) => loc(`Macro.${prefix}.${key}`, data);

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
const needsWork = item => hasBad(item.flags) || item.effects.some(badEffect) || (item.effects.invalidDocumentIds?.size > 0)
  || !MIDI.OFFICIAL.test(item._stats?.compendiumSource ?? "") && !!item._stats?.compendiumSource;
const touchedByMidi = actor => hasBad(actor.flags) || actor.effects.some(e => hasBad(e.flags))
  || actor.items.some(i => hasBad(i.flags) || i.effects.some(e => hasBad(e.flags)) || MIDI.THIRD_PARTY.test(i._stats?.compendiumSource ?? ""));

async function officialFor(item) {
  const src = item._stats?.compendiumSource ?? "";
  if ( MIDI.OFFICIAL.test(src) ) { const doc = await fromUuid(src).catch(() => null); if ( doc ) return doc; }
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
  if ( item.type === "spell" ) keep(["method", "prepared", "sourceClass", "ability"]);
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
async function cleanActor(actor, dry) {
  const t = tr("CleanMidi");
  const lines = [];
  const ids = identifier => actor.items.filter(i => i.system.identifier === identifier);
  for ( const item of [...actor.items] ) {
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
        await actor.deleteEmbeddedDocuments("Item", [item.id]);
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

/** Les vérifications, dans l'ordre où les macros les proposaient. */
/* -------------------------------------------- */
/*  7. Textes restés dans la langue d'origine     */
/* -------------------------------------------- */

/**
 * §203 : reprendre la traduction actuelle des compendiums (celle de la langue de ce client, par Babele) pour les objets et acteurs
 * du monde qui en viennent et dont des textes sont restés dans la langue d'origine — importés avant l'installation d'une traduction,
 * ou par un client dans une autre langue, ou par un joueur sans droit de parcourir les fichiers (Babele ne traduit rien pour lui).
 * Babele garde sur chaque document traduit ses valeurs d'origine (`flags.babele.originalPayload`) : un champ n'est repris que s'il
 * vaut encore exactement l'original — un texte modifié à la main ne bouge pas (core/localize.mjs). Les noms des tokens déjà posés
 * ne changent pas (ils ne sont pas dans la sauvegarde) ; ceux posés ensuite prennent le nom du token prototype.
 */
const retranslate = {
  id: "retranslate", icon: "fa-solid fa-language",
  async scan() {
    if ( !game.babele ) return [];
    const t = tr("Retranslate");
    const cache = new Map();
    const reference = async uuid => {
      if ( !uuid?.startsWith("Compendium.") ) return null;
      if ( !cache.has(uuid) ) cache.set(uuid, await fromUuid(uuid).catch(() => null));
      const doc = cache.get(uuid);
      return doc?.flags?.babele?.originalPayload ? doc : null;
    };
    const sourceOf = doc => doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? null;
    // L'acteur de base d'un objet (celui d'un token non lié : son acteur du monde), et sa référence traduite.
    const baseActor = item => {
      const actor = item.parent;
      if ( actor?.documentName !== "Actor" ) return null;
      return actor.isToken ? (game.actors.get(actor.token?.actorId) ?? null) : actor;
    };
    const fieldsText = fields => [...new Set(fields.map(f => f.split(".")[0]))].map(f => t(`Field.${f}`)).join(", ");
    const tasks = [];
    for ( const actor of game.actors ) {
      const ref = await reference(sourceOf(actor));
      if ( !ref ) continue;
      const { update, fields } = retranslateActor(actor.toObject(), ref.flags.babele.originalPayload, ref.toObject());
      if ( !fields.length ) continue;
      const where = `<b>${esc(actor.name)}</b>`;
      const text = t("Line", { name: esc(update.name ?? actor.name), fields: fieldsText(fields) });
      tasks.push({ root: rootOf(actor), where, text, preselect: true,
        apply: async () => { await fresh(actor).update(update); return text; } });
    }
    for ( const scanned of allItems() ) {
      // La référence : l'objet de même id dans la créature traduite d'où vient la fiche, sinon la source de l'objet lui-même.
      const refActor = await reference(sourceOf(baseActor(scanned)));
      let ref = refActor?.items?.get(scanned.id) ?? null;
      if ( !ref?.flags?.babele?.originalPayload ) ref = await reference(sourceOf(scanned));
      if ( !ref ) continue;
      const { update, effects, fields } = retranslateItem(scanned.toObject(), ref.flags.babele.originalPayload, ref.toObject());
      if ( !fields.length ) continue;
      const text = t("Line", { name: esc(update.name ?? scanned.name), fields: fieldsText(fields) });
      tasks.push({ root: rootOf(scanned), where: whereOf(scanned), text, preselect: true,
        apply: async () => {
          const item = fresh(scanned);
          if ( Object.keys(update).length ) await item.update(update);
          if ( effects.length ) await item.updateEmbeddedDocuments("ActiveEffect", effects);
          return text;
        } });
    }
    return tasks;
  }
};

export const CHECKS = Object.freeze([cleanMidi, phbEffects, lostEffects, scrolls, pileBasics, creatures, retranslate]);
