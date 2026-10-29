/**
 * Le contenu en marche : le réglage de la surcouche du monde, le refus d'un flag faux à
 * l'écriture (SPEC §7 : « une clé inconnue lève une erreur à l'écriture, pas un silence en
 * jeu »), l'API d'inspection, et l'enregistrement du contenu d'autres modules.
 *
 * Contenu d'un autre module (2026-10-03) — API publique, deux chemins équivalents :
 *
 *   Hooks.once("dnd5e-combat.registerContent", register => register("mon-module", TABLE));
 *   game.modules.get("dnd5e-combat")?.api?.content.register("mon-module", TABLE);
 *
 * `TABLE` : `{ identifiant dnd5e: entrée }`, dans le schéma de core/content.mjs (le même que le contenu livré). Le hook est
 * appelé une fois, à `setup` (après tous les `init`) : s'y inscrire depuis son propre `init`. L'appel direct marche dès que l'API
 * existe (`init` du moteur passé) ; `api.content.registered()` dit ce qui est enregistré. Chaque entrée est validée comme le
 * contenu livré : une entrée fausse est écartée et dite dans la console, les autres sont prises. La table est fusionnée
 * par-dessus le contenu livré, entrée par entrée (`mergeEntries`) ; enregistrer de nouveau la même source la remplace.
 * Le moteur ne connaît aucun de ces modules : sans eux, il tourne avec son seul contenu.
 *
 * §277 : `register(source, table, { sources })` — `sources` : `{ id de document: identifiant }`, pour des items qui n'ont pas
 * d'identifiant utilisable (un item premium sans identifiant, un item importé dont dnd5e a tiré l'identifiant du nom), reconnus par
 * l'id de leur source de compendium ou leur propre id, comme content/sources.mjs. Une paire fausse est écartée et dite ; les sources
 * suivent la table : réenregistrer la source les remplace, `unregister` les retire.
 */

import { MODULE_ID } from "../constants.mjs";
import { validateEntry, validateTable, validateSources, CONTENT_VERSION, ENTRY_KEYS } from "../core/content.mjs";
import { RECIPES, RECIPES_VERSION, FACTS, FACT_ARG_OPTIONS, FIELD_KINDS, PUBLIC_KEYS, buildEntry, buildCondition } from "../core/recipes.mjs";
import { CONTENT, SHIPPED, registerTable, unregisterTable, registeredTables, registerSources, registeredSources } from "../content/index.mjs";
import { OVERRIDES_SETTING, KNOWN_FACTS, worldOverrides, setWorldOverride, contentOf, inspect, identifierOf } from "../adapter/content.mjs";
import { buildSpellIndex, stampScroll } from "../adapter/scrolls.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

/** Le hook par lequel le moteur demande leur contenu aux autres modules (à `setup`). */
export const REGISTER_HOOK = `${MODULE_ID}.registerContent`;

/** Avant qu'un item soit créé ou modifié : ses flags du module doivent être valides, sinon l'écriture est refusée. */
function checkItemFlags(item, data) {
  const flags = data?.flags?.[MODULE_ID];
  if ( !flags ) return true;
  const layer = {};
  for ( const key of ENTRY_KEYS ) if ( (key in flags) && (flags[key] !== null) ) layer[key] = flags[key];
  const errors = validateEntry(layer, { facts: KNOWN_FACTS });
  if ( !errors.length ) return true;
  ui.notifications.error(loc("ContenuRefuse", { item: item.name ?? data.name ?? "", errors: errors.join(" ; ") }));
  console.error(`${MODULE_ID} | flags rejected on ${item.name ?? data.name}`, errors);
  return false;
}

/**
 * Enregistre la table de contenu d'un autre module (voir l'en-tête). Validée entrée par entrée comme le contenu livré.
 * @param {string} source                    L'id du module qui l'apporte.
 * @param {Record<string, object>} table     `{ identifiant dnd5e: entrée }`.
 * @param {{sources?: Record<string, string>}} [options]  §277 : `{ id de document: identifiant }`.
 * @returns {{source: string, accepted: string[], rejected: Record<string, string[]>, sources: string[], rejectedSources: string[]}}
 */
export function registerExternal(source, table, { sources={} }={}) {
  if ( (typeof source !== "string") || !source ) throw new Error(`${MODULE_ID} | content.register: the source module id is required`);
  if ( !table || (typeof table !== "object") || Array.isArray(table) ) {
    throw new Error(`${MODULE_ID} | content.register(${source}): the table is an object { identifier: entry }`);
  }
  const accepted = {};
  const rejected = {};
  for ( const [id, entry] of Object.entries(table) ) {
    const errors = validateEntry(entry, { facts: KNOWN_FACTS, at: `${id}.` });
    if ( errors.length ) rejected[id] = errors;
    else accepted[id] = entry;
  }
  const goodSources = {};
  const rejectedSources = validateSources(sources ?? {});
  if ( sources && (typeof sources === "object") && !Array.isArray(sources) ) {
    for ( const [docId, identifier] of Object.entries(sources) ) if ( !validateSources({ [docId]: identifier }).length ) goodSources[docId] = identifier;
  }
  registerSources(source, goodSources);
  registerTable(source, accepted);
  if ( Object.keys(rejected).length ) console.error(`${MODULE_ID} | content from ${source}: entries rejected`, rejected);
  if ( rejectedSources.length ) console.error(`${MODULE_ID} | content from ${source}: sources rejected`, rejectedSources);
  log(`content: ${Object.keys(accepted).length} entry(ies)${Object.keys(goodSources).length ? `, ${Object.keys(goodSources).length} source(s)` : ""} registered by ${source}`);
  return { source, accepted: Object.keys(accepted), rejected, sources: Object.keys(goodSources), rejectedSources };
}

/** À `setup` : les autres modules donnent leur contenu par le hook, s'ils ne l'ont pas déjà fait par l'API. */
function collectExternal() {
  Hooks.callAll(REGISTER_HOOK, (source, table, options) => registerExternal(source, table, options));
}

/** À `ready` : le contenu en vigueur (livré et enregistré) et la surcouche du monde sont relus ; ce qui est faux est dit une fois. */
function audit() {
  const shipped = validateTable(CONTENT, { facts: KNOWN_FACTS });
  if ( shipped.length ) console.error(`${MODULE_ID} | invalid shipped content`, shipped);
  const stored = game.settings.get(MODULE_ID, OVERRIDES_SETTING);
  if ( stored && (typeof stored === "object") && Object.keys(stored).length && (stored.v !== CONTENT_VERSION) ) {
    console.warn(`${MODULE_ID} | world overlay ignored: schema ${stored.v} ≠ ${CONTENT_VERSION}`);
  }
  const world = validateTable(worldOverrides(), { facts: KNOWN_FACTS });
  if ( world.length ) console.warn(`${MODULE_ID} | world overlay: invalid entries`, world);
  const external = Object.entries(registeredTables()).map(([source, ids]) => `${source} (${ids.length})`);
  log(`content: ${Object.keys(SHIPPED).length} shipped entry(ies)${external.length ? `, registered: ${external.join(", ")}` : ""}, `
    + `${Object.keys(worldOverrides()).length} from the world`);
}

/** Exposé sur `game.modules.get("dnd5e-combat").api.content`. */
export const contentApi = Object.freeze({
  version: CONTENT_VERSION,
  /** Le contenu en vigueur : livré + enregistré par d'autres modules. */
  shipped: CONTENT,
  facts: Object.keys(KNOWN_FACTS),
  world: worldOverrides,
  set: setWorldOverride,
  of: contentOf,
  identifierOf,
  inspect,
  validate: entry => validateEntry(entry, { facts: KNOWN_FACTS }),
  /** §277 : les erreurs d'une table de sources `{ id de document: identifiant }` (vide = valide). */
  validateSources,
  /** `register(source, table, { sources? })` : le contenu d'un autre module (voir l'en-tête de runtime/content.mjs). */
  register: registerExternal,
  /** `unregister(source)` : retire la table d'un module, et ses sources. */
  unregister: unregisterTable,
  /** `{ source: [identifiants] }` : ce que d'autres modules ont enregistré. */
  registered: registeredTables,
  /** §277 : `{ source: { id de document: identifiant } }` : les sources que d'autres modules ont enregistrées. */
  sources: registeredSources,
  /**
   * §114 : les recettes — les briques du schéma dites pour un outil sans code (core/recipes.mjs). `build(recettes, { identifier,
   * base })` rend `{ entry, errors }` ; l'entrée se valide ensuite par `validate`, comme tout contenu.
   */
  recipes: Object.freeze({
    version: RECIPES_VERSION,
    list: RECIPES,
    facts: FACTS,
    factOptions: FACT_ARG_OPTIONS,
    fieldKinds: FIELD_KINDS,
    publicKeys: PUBLIC_KEYS,
    build: buildEntry,
    condition: buildCondition
  })
});

export function registerContent() {
  game.settings.register(MODULE_ID, OVERRIDES_SETTING, { scope: "world", config: false, type: Object, default: {} });
  route("preCreateItem", (item, data) => checkItemFlags(item, data), { cancellable: true, label: "content: flags on creation" });
  route("preUpdateItem", (item, changes) => checkItemFlags(item, changes), { cancellable: true, label: "content: flags on update" });
  route("setup", collectExternal, { label: "content: other modules' tables" });
  route("ready", audit, { label: "content: audit" });
  // §48 : un parchemin se reconnaît au sort qu'il contient — noté à sa création (dnd5e ne le garde pas), retrouvé par son nom
  // pour les parchemins déjà faits (index des sorts des compendiums et du monde).
  route("dnd5e.createScrollFromSpell", stampScroll, { label: "scroll: contained spell" });
  route("ready", () => buildSpellIndex().then(n => log(`spell index (scrolls): ${n} keys`)), { label: "scroll: spell index" });
}
