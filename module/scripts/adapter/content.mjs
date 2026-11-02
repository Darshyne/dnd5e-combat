/**
 * Ce qu'un item déclare au moteur, toutes couches confondues (SPEC §13.4) :
 *
 *   flag de l'item  >  surcouche du monde (réglage, MJ)  >  contenu du module  >  texte d'une capacité de PNJ (K1)  >  rien = natif
 *
 * L'identifiant est celui de dnd5e (`system.identifier`, gardé par les copies faites depuis un
 * compendium — vérifié : Spellbook crée le sort avec `toObject()` du sort du compendium). À
 * défaut : l'identifiant de la source de compendium (`_stats.compendiumSource`, que le cœur
 * remplit à la création, client-document.mjs:990), puis le nom en kebab-case.
 */

import { MODULE_ID } from "../constants.mjs";
import { mergeEntries, validateEntry, CONTENT_VERSION, ENTRY_KEYS } from "../core/content.mjs";
import { CONTENT, SOURCES } from "../content/index.mjs";
import { factsFor } from "./facts.mjs";
import { scrollSpellOf } from "./scrolls.mjs";
import { isObjectToken } from "./bodies.mjs";
import { monsterChoice, monsterDeaths, monsterEndings, monsterPushes, monsterReactions, monsterRecurring, monsterTypeGate, monsterAdvantage, monsterSaveDamage, monsterMissingStatus, monsterNoOpportunity,
  monsterBasicActions, monsterSightGate, monsterImmunity, monsterEffectDurations, monsterReactionWindow } from "../core/monster-text.mjs";
import { readDrain, drains } from "../core/drain.mjs";

export const OVERRIDES_SETTING = "contentOverrides";

/**
 * §117 : le contenu par objet ne s'applique qu'au niveau Intégral (runtime/levels.mjs). Fermé, `contentOf` ne rend rien : chaque
 * objet garde le comportement de dnd5e et les règles générales du moteur.
 */
let contentEnabled = true;
export function setContentEnabled(enabled) {
  contentEnabled = !!enabled;
}

/** Les clés de faits que le cœur des conditions connaît (pour valider une entrée). */
export const KNOWN_FACTS = factsFor();

/** Un nom en identifiant, comme dnd5e le forme (utils.mjs:112, `formatIdentifier`). */
const kebab = name => String(name ?? "").replaceAll(/(\w+)([\\|/])(\w+)/g, "$1-$3").slugify({ strict: true });

/**
 * L'identifiant sous lequel un item est reconnu, et d'où il vient.
 *
 * §19.9 : un item premium sans identifiant (Ravenloft) en reçoit un à sa création sur une fiche — dnd5e 6 l'écrit d'après le nom
 * (documents/item.mjs:1146, `_preCreate`), donc d'après le nom TRADUIT par Babele : « morsure-vampirique ». On le reconnaît par
 * l'id de sa source (content/sources.mjs), sinon par son nom anglais, que Babele garde (`flags.babele.originalName`, 2.9.1).
 */
export function identifierOf(item) {
  // §48 : un parchemin est reconnu sous l'identifiant du sort qu'il contient.
  const scroll = scrollSpellOf(item);
  if ( scroll ) return { id: scroll.identifier, from: "scroll" };
  const sourceUuid = item?._stats?.compendiumSource ?? item?.flags?.dnd5e?.sourceId ?? null;
  // §277 : les sources livrées (content/sources.mjs) et celles qu'un autre module enregistre avec sa table.
  // §334 : d'abord « acteur.item » — un id d'item du Monster Manual est partagé entre créatures (« mmBite0000000000 ») ; la clé
  // « mmHomunculus0000.mmBite0000000000 » vise la morsure de l'Homoncule seule.
  const parts = String(sourceUuid ?? "").split(".");
  const known = ((parts.length > 3) ? SOURCES[`${parts.at(-3)}.${parts.at(-1)}`] : null) ?? SOURCES[parts.at(-1)] ?? SOURCES[item?.id ?? ""];
  if ( known ) return { id: known, from: "source" };
  const own = item?.system?.identifier;
  const original = item?.flags?.babele?.originalName;
  const translated = !!own && !!original && (own === kebab(item.name)) && (kebab(original) !== own);
  if ( own && !translated ) return { id: own, from: "item" };
  const source = sourceUuid ? fromUuidSync(sourceUuid, { strict: false }) : null;
  if ( source?.system?.identifier ) return { id: source.system.identifier, from: "compendium" };
  if ( original ) return { id: kebab(original), from: "name" };
  if ( own ) return { id: own, from: "item" };
  if ( item?.name ) return { id: kebab(item.name), from: "name" };
  return { id: null, from: null };
}

/** La surcouche du monde : `{ identifiant: entrée }`, tenue par le MJ. */
export function worldOverrides() {
  const stored = game.settings.get(MODULE_ID, OVERRIDES_SETTING);
  if ( !stored || (typeof stored !== "object") ) return {};
  if ( stored.v !== CONTENT_VERSION ) return {};
  return stored.entries ?? {};
}

/** Écrit (ou retire, avec `null`) l'entrée d'un identifiant dans la surcouche du monde. MJ uniquement. */
export async function setWorldOverride(identifier, entry) {
  const entries = { ...worldOverrides() };
  if ( entry === null ) delete entries[identifier];
  else {
    const errors = validateEntry(entry, { facts: KNOWN_FACTS });
    if ( errors.length ) throw new Error(`${identifier}: ${errors.join("; ")}`);
    entries[identifier] = entry;
  }
  await game.settings.set(MODULE_ID, OVERRIDES_SETTING, { v: CONTENT_VERSION, entries });
  return entries[identifier] ?? null;
}

/** Ce qu'un item porte lui-même, validé ; une entrée fausse est ignorée (et signalée). */
function itemLayer(item) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  const layer = {};
  for ( const key of ENTRY_KEYS ) if ( key in flags ) layer[key] = flags[key];
  if ( !Object.keys(layer).length ) return null;
  const errors = validateEntry(layer, { facts: KNOWN_FACTS });
  if ( errors.length ) {
    console.warn(`${MODULE_ID} | ${item.name}: flags ignored — ${errors.join("; ")}`);
    return null;
  }
  return layer;
}

/**
 * L'entrée effective d'un item, couches combinées. `null` si rien n'est déclaré nulle part.
 * @returns {{entry: object|null, identifier: string|null, layers: {module: boolean, world: boolean, item: boolean}}}
 */
export function contentOf(item) {
  const { id } = identifierOf(item);
  if ( !contentEnabled ) return { identifier: id, entry: null, layers: { text: false, module: false, world: false, item: false } };
  const layers = { text: textLayer(item), module: id ? CONTENT[id] ?? null : null, world: id ? worldOverrides()[id] ?? null : null, item: itemLayer(item) };
  return {
    identifier: id,
    entry: mergeEntries([layers.text, layers.module, layers.world, layers.item]),
    layers: { text: !!layers.text, module: !!layers.module, world: !!layers.world, item: !!layers.item }
  };
}

/**
 * K1 (SPEC §322) : la couche la plus basse, lue dans le texte anglais d'origine d'une capacité de PNJ (`core/monster-text.mjs`) —
 * sauvegarde répétée à la fin de ses tours, second échec, fin sur dégâts ; K2 (§323) : mort à 0 PV, paliers de PV ; K3 (§324) : un seul effet. Le contenu livré, la surcouche du monde ou le flag de
 * l'item la remplacent dès qu'ils déclarent leurs propres `triggers`. Pas pour un sort (sa copie suit les règles du sort) ni pour un
 * personnage. Mise en cache par item et texte.
 */
const textCache = new Map();
function textLayer(item) {
  if ( (item?.actor?.type !== "npc") || (item.type === "spell") ) return null;
  const html = item.flags?.babele?.originalPayload?.description ?? item.system?.description?.value ?? "";
  if ( !html ) return null;
  const key = `${item.uuid}|${html.length}|${item.effects?.size ?? 0}`;
  if ( textCache.has(key) ) return textCache.get(key);
  const effects = (item.effects?.contents ?? []).map(e => ({ id: e.id, statuses: [...(e.statuses ?? [])] }));
  const activities = Array.from(item.system?.activities ?? []).map(a => ({ id: a.id, name: a.name ?? "" }));
  const triggers = monsterEndings(html, effects);
  // K2 (§323) : la mort à 0 PV et les paliers de PV que le texte promet.
  const deaths = monsterDeaths(html, { activities, effects });
  // K3 (§324) : un seul des effets — tiré au dé ou au choix de la créature.
  const choice = monsterChoice(html, effects);
  // K6 (§327) : parade (« adds N to its AC »), Réactions perdues, action OU action Bonus.
  const acEffect = (item.effects?.contents ?? []).flatMap(e => e.changes ?? []).find(c => c.key === "system.attributes.ac.bonus" && /^\+?\d+$/.test(String(c.value).trim()));
  const reacts = monsterReactions(html, { reaction: activities.some(a => item.system.activities.get(a.id)?.activation?.type === "reaction"),
    acEffect: acEffect ? Number(String(acEffect.value).replace("+", "")) : null });
  // K7 (§328) : dégâts récurrents au porteur, soins bloqués, absorption — pas pour une capacité que la brique Avaler joue déjà.
  const recurring = monsterRecurring(html, effects, Array.from(item.system?.activities ?? []).map(a => ({ id: a.id, type: a.type })));
  if ( CONTENT[identifierOf(item).id]?.swallow ) delete recurring.triggers;
  // K8 (§329) : poussées et tractions lues dans le texte.
  const kinds = { save: activities.some(a => item.system.activities.get(a.id)?.type === "save"), attack: activities.some(a => item.system.activities.get(a.id)?.type === "attack") };
  const pushes = monsterPushes(html, kinds);
  // K10 (§331) : Avantage conditionnel lu dans le texte.
  const advantage = monsterAdvantage(html, identifierOf(item).id);
  // K12 (§333) : l'état que la donnée oublie de poser.
  const acts = Array.from(item.system?.activities ?? []).map(a => ({ id: a.id, type: a.type, effects: (a.effects ?? []).map(e => e._id ?? e.id) }));
  // §334 : un état lu avec sa durée d'un tour la reçoit par `effectEnds` « status:<état> ».
  const missing = monsterMissingStatus(html, { activities: acts, effects }).map(({ ends, ...t }) => {
    if ( ends ) (recurring.effectEnds ??= {})[`status:${t.do[0].status}`] = ends;
    return t;
  });
  // K1 (§334) : immunité temporaire après une réussite.
  const immunity = monsterImmunity(html, identifierOf(item).id, acts);
  if ( immunity ) missing.push(immunity.trigger);
  // §334 : la fenêtre d'une Réaction de monstre d'après son déclencheur, quand la parade de K6 n'en donne pas.
  const reactionConditions = Array.from(item.system?.activities ?? []).filter(a => a.activation?.type === "reaction").map(a => a.activation?.condition ?? "");
  const outward = Array.from(item.system?.activities ?? []).some(a => (a.activation?.type === "reaction") && ["save", "attack", "damage"].includes(a.type));
  const window = (reactionConditions.length && !reacts.triggers?.length) ? monsterReactionWindow(html, reactionConditions, outward,
    Array.from(item.system?.activities ?? []).find(a => a.activation?.type === "reaction")?.id ?? null) : [];
  const allTriggers = [...triggers, ...(reacts.triggers ?? []), ...window, ...(recurring.triggers ?? []), ...pushes, ...advantage, ...missing];
  // §334 : les durées en tours que le texte donne aux effets, Réactions perdues et soins bloqués par effet.
  const durations = monsterEffectDurations(html, { activities: acts, effects });
  if ( durations.effectEnds ) recurring.effectEnds = { ...durations.effectEnds, ...(recurring.effectEnds ?? {}) };
  if ( durations.noReactions && !reacts.noReactions ) recurring.noReactions = durations.noReactions;
  if ( durations.blocksHealing && !recurring.blocksHealing ) recurring.blocksHealing = durations.blocksHealing;
  const { triggers: _r, ...recurringRest } = recurring;
  const { triggers: _t, ...restrictions } = reacts;
  // K11 (§332) : pas de moitié des dégâts sur une réussite quand le texte n'en donne pas.
  const saveDamage = monsterSaveDamage(html, Array.from(item.system?.activities ?? []).map(a => ({ id: a.id, type: a.type, onSave: a.damage?.onSave ?? null })));
  if ( saveDamage ) recurringRest.saveDamage = saveDamage;
  // K12 (§333) : plus d'attaque d'opportunité, Foncer / Se désengager / Se cacher, drain du maximum de PV dit par le texte.
  if ( monsterNoOpportunity(html, effects) ) recurringRest.noOpportunityAttacks = true;
  // §334 : « moves up to (half) its Speed without provoking Opportunity Attacks » — le reste du tour sans attaque d'opportunité.
  if ( /\bmoves? up to (?:half )?its (?:\w+ )?Speed without provoking\b/i.test(html.replace(/<[^>]+>/g, " ").replace(/&Reference\[([^\]]*)\]/g, "$1")) ) recurringRest.noOpportunity = "afterUse";
  const basics = monsterBasicActions(html, acts);
  if ( basics ) recurringRest.basicActions = basics;
  if ( drains(readDrain(html)) ) recurringRest.drain = true;
  // K9 (§330) : porte de type (« Constructs and Undead succeed automatically »).
  const typeGate = monsterTypeGate(html);
  // K12 (§333) : « that can see the X » — une créature qui ne voit pas la source n'est pas affectée.
  const sight = monsterSightGate(html, acts);
  const gates = [typeGate?.unaffectedIf, sight, immunity?.gate].filter(Boolean);
  const gate = gates.length ? { unaffectedIf: (gates.length > 1) ? { any: gates } : gates[0] } : null;
  const layer = (allTriggers.length || Object.keys(deaths).length || choice || Object.keys(restrictions).length || Object.keys(recurringRest).length || gate)
    ? { ...(allTriggers.length ? { triggers: allTriggers } : {}), ...deaths, ...restrictions, ...recurringRest, ...(choice ? { choice } : {}), ...(gate ? { targets: gate } : {}) } : null;
  if ( textCache.size > 2000 ) textCache.clear();
  textCache.set(key, layer);
  return layer;
}

/** §53 : l'entrée d'un identifiant sans item (une potion détruite en étant bue) : contenu du module < surcouche du monde. */
export function entryOfIdentifier(id) {
  if ( !contentEnabled ) return null;
  return id ? mergeEntries([CONTENT[id] ?? null, worldOverrides()[id] ?? null]) : null;
}

/**
 * L'item qui a lancé une copie de sort (`flags.dnd5e.cachedFor` = uuid relatif de son activité d'incantation,
 * activity/cast.mjs:118-145), ou null. Une créature qui « lance Immobilisation de personne » par une capacité
 * (une créature d'un module tiers) y déclare ce que SA version ajoute au sort : les étapes d'issue du sort
 * lisent aussi celles de cet item (adapter/usage.mjs, `outcomeStepsOf`).
 */
export function castItemOf(item) {
  const cached = item?.flags?.dnd5e?.cachedFor;
  const m = (typeof cached === "string") ? cached.match(/Item.([A-Za-z0-9]{16}).Activity.[A-Za-z0-9]{16}$/) : null;
  return m ? (item.actor?.items?.get(m[1]) ?? null) : null;
}

/** Pour l'inspection en jeu : ce que chaque item d'un acteur déclare, et d'où. */
export function inspect(actor) {
  return (actor?.items ?? []).map(item => {
    const { id, from } = identifierOf(item);
    const { entry, layers } = contentOf(item);
    return { item: item.name, identifier: id, identifierFrom: from, layers, entry };
  }).filter(r => r.entry);
}

/**
 * §123 : l'unité de portée d'une activité, corrigée par le contenu quand les données se trompent (`ranges`, §16.43) — Imposition des
 * mains et la trousse de soins sont « personnelles » dans le Manuel des joueurs alors qu'elles touchent une créature. Ce qui décide
 * « sur soi » (visée au clic, plan de la carte) lit ceci, pas `activity.range.units`.
 */
export function rangeUnitsOf(activity) {
  const fixed = activity?.item ? contentOf(activity.item).entry?.ranges?.[activity.id] : null;
  if ( fixed?.units ) return fixed.units;
  const units = activity?.range?.units ?? null;
  // Règle générale : un SOIN « personnel » qui vise une créature — une seule, sans zone — vise en fait une autre créature (ou soi).
  // Relevé du Manuel des joueurs (2026-10-10) : Imposition des mains, Main guérisseuse, Ultime miséricorde, Toucher du médecin,
  // Ralliement, Champ protecteur, Éclat protecteur amélioré, Interception — toutes soignaient le lanceur, quelle que soit la cible.
  // Sans portée connue (null) : la visée s'ouvre (soi compris), sans contrôle de distance — `ranges` la précise quand le texte la donne.
  const affects = activity?.target?.affects;
  const one = !activity?.target?.template?.type && ["", "1"].includes(String(affects?.count ?? "").trim());
  if ( (units !== "self") || !one ) return units;
  if ( (activity?.type === "heal") && HEAL_TARGETS.includes(affects?.type) ) return null;
  // §124 : de même une capacité qu'un joueur lance lui-même (action, action Bonus), hors soin et hors attaque (une attaque se vise
  // déjà), dont le moteur n'a pas de règle — Paume vibratoire (fin des vibrations), Toucher restaurateur, Bastion de la loi, Nimbe
  // sacré, Champion ancestral, ordre au compagnon du Rôdeur, Murmures psychiques : sans cible désignée, rien ne se passait. Celles que
  // le moteur prend en charge (Déluge de coups, Transposition du filou, Prêtre de guerre…) gardent leur propre circuit.
  if ( (activity?.type !== "attack") && PLAYER_ACTIVATIONS.includes(activity?.activation?.type)
    && TARGETS.includes(affects?.type) && !contentOf(activity.item).entry ) return null;
  // §253 : un piège (PNJ au type de créature « Trap » des pièges du DMG 2024, ou token objet du moteur) a une portée « personnelle »
  // dans les données mais frappe une créature : lancé à la main sans cible désignée, la visée s'ouvre (rien ne se passait).
  if ( TARGETS.includes(affects?.type) && trapLike(activity?.actor) ) return null;
  return units;
}

const TRAP_TYPE = /^(traps?|pièges?)$/i;

/** §253 : un acteur piège — type de créature personnalisé « Trap » (DMG 2024), ou le token d'un objet du moteur. */
export function trapLike(actor) {
  const type = actor?.system?.details?.type;
  if ( (type?.value === "custom") && TRAP_TYPE.test(String(type.custom ?? "").trim()) ) return true;
  return isObjectToken(actor?.token);
}

/** §124 : les activations qu'un joueur déclenche lui-même (pas une réaction, pas un supplément au coup). */
const PLAYER_ACTIVATIONS = ["action", "bonus"];
/** §124 : les cibles qui désignent une créature (ou un objet) autre que le lanceur. */
const TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any", "enemy", "object"];

/** Les cibles d'un soin qui désignent une autre créature que le lanceur. */
const HEAL_TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any"];
