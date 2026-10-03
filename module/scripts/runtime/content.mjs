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
 */

import { MODULE_ID } from "../constants.mjs";
import { validateEntry, validateTable, CONTENT_VERSION, ENTRY_KEYS } from "../core/content.mjs";
import { CONTENT, SHIPPED, registerTable, unregisterTable, registeredTables } from "../content/index.mjs";
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
  console.error(`${MODULE_ID} | flags refusés sur ${item.name ?? data.name}`, errors);
  return false;
}

/**
 * Enregistre la table de contenu d'un autre module (voir l'en-tête). Validée entrée par entrée comme le contenu livré.
 * @param {string} source                    L'id du module qui l'apporte.
 * @param {Record<string, object>} table     `{ identifiant dnd5e: entrée }`.
 * @returns {{source: string, accepted: string[], rejected: Record<string, string[]>}}
 */
export function registerExternal(source, table) {
  if ( (typeof source !== "string") || !source ) throw new Error(`${MODULE_ID} | content.register : l'id du module source est requis`);
  if ( !table || (typeof table !== "object") || Array.isArray(table) ) {
    throw new Error(`${MODULE_ID} | content.register(${source}) : la table est un objet { identifiant: entrée }`);
  }
  const accepted = {};
  const rejected = {};
  for ( const [id, entry] of Object.entries(table) ) {
    const errors = validateEntry(entry, { facts: KNOWN_FACTS, at: `${id}.` });
    if ( errors.length ) rejected[id] = errors;
    else accepted[id] = entry;
  }
  registerTable(source, accepted);
  if ( Object.keys(rejected).length ) console.error(`${MODULE_ID} | contenu de ${source} : entrées écartées`, rejected);
  log(`contenu : ${Object.keys(accepted).length} entrée(s) enregistrée(s) par ${source}`);
  return { source, accepted: Object.keys(accepted), rejected };
}

/** À `setup` : les autres modules donnent leur contenu par le hook, s'ils ne l'ont pas déjà fait par l'API. */
function collectExternal() {
  Hooks.callAll(REGISTER_HOOK, (source, table) => registerExternal(source, table));
}

/** À `ready` : le contenu en vigueur (livré et enregistré) et la surcouche du monde sont relus ; ce qui est faux est dit une fois. */
function audit() {
  const shipped = validateTable(CONTENT, { facts: KNOWN_FACTS });
  if ( shipped.length ) console.error(`${MODULE_ID} | contenu livré invalide`, shipped);
  const stored = game.settings.get(MODULE_ID, OVERRIDES_SETTING);
  if ( stored && (typeof stored === "object") && Object.keys(stored).length && (stored.v !== CONTENT_VERSION) ) {
    console.warn(`${MODULE_ID} | surcouche du monde ignorée : schéma ${stored.v} ≠ ${CONTENT_VERSION}`);
  }
  const world = validateTable(worldOverrides(), { facts: KNOWN_FACTS });
  if ( world.length ) console.warn(`${MODULE_ID} | surcouche du monde : entrées invalides`, world);
  const external = Object.entries(registeredTables()).map(([source, ids]) => `${source} (${ids.length})`);
  log(`contenu : ${Object.keys(SHIPPED).length} entrée(s) livrée(s)${external.length ? `, enregistrées : ${external.join(", ")}` : ""}, `
    + `${Object.keys(worldOverrides()).length} du monde`);
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
  /** `register(source, table)` : le contenu d'un autre module (voir l'en-tête de runtime/content.mjs). */
  register: registerExternal,
  /** `unregister(source)` : retire la table d'un module. */
  unregister: unregisterTable,
  /** `{ source: [identifiants] }` : ce que d'autres modules ont enregistré. */
  registered: registeredTables
});

export function registerContent() {
  game.settings.register(MODULE_ID, OVERRIDES_SETTING, { scope: "world", config: false, type: Object, default: {} });
  route("preCreateItem", (item, data) => checkItemFlags(item, data), { cancellable: true, label: "contenu : flags à la création" });
  route("preUpdateItem", (item, changes) => checkItemFlags(item, changes), { cancellable: true, label: "contenu : flags à la modification" });
  route("setup", collectExternal, { label: "contenu : tables des autres modules" });
  route("ready", audit, { label: "contenu : audit" });
  // §48 : un parchemin se reconnaît au sort qu'il contient — noté à sa création (dnd5e ne le garde pas), retrouvé par son nom
  // pour les parchemins déjà faits (index des sorts des compendiums et du monde).
  route("dnd5e.createScrollFromSpell", stampScroll, { label: "parchemin : sort contenu" });
  route("ready", () => buildSpellIndex().then(n => log(`index des sorts (parchemins) : ${n} clés`)), { label: "parchemin : index des sorts" });
}
