/**
 * Ce qu'un item déclare au moteur, toutes couches confondues (SPEC §13.4) :
 *
 *   flag de l'item  >  surcouche du monde (réglage, MJ)  >  contenu du module  >  rien = natif
 *
 * L'identifiant est celui de dnd5e (`system.identifier`, gardé par les copies faites depuis un
 * compendium — vérifié : Spellbook crée le sort avec `toObject()` du sort du compendium). À
 * défaut : l'identifiant de la source de compendium (`_stats.compendiumSource`, que le cœur
 * remplit à la création, client-document.mjs:990), puis le nom en kebab-case.
 */

import { MODULE_ID } from "../constants.mjs";
import { mergeEntries, validateEntry, CONTENT_VERSION, ENTRY_KEYS } from "../core/content.mjs";
import { CONTENT } from "../content/index.mjs";
import { SOURCE_IDENTIFIERS } from "../content/sources.mjs";
import { factsFor } from "./facts.mjs";
import { scrollSpellOf } from "./scrolls.mjs";

export const OVERRIDES_SETTING = "contentOverrides";

/**
 * §117 : le contenu par objet ne s'applique qu'au niveau Intégral (runtime/levels.mjs). Fermé, `contentOf` ne rend rien : chaque
 * objet garde le comportement de dnd5e et les règles générales du moteur.
 */
let contentEnabled = true;
export function setContentEnabled(enabled) {
  contentEnabled = !!enabled;
}
export function isContentEnabled() {
  return contentEnabled;
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
  const known = SOURCE_IDENTIFIERS[String(sourceUuid ?? "").split(".").at(-1)] ?? SOURCE_IDENTIFIERS[item?.id ?? ""];
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
  if ( !contentEnabled ) return { identifier: id, entry: null, layers: { module: false, world: false, item: false } };
  const layers = { module: id ? CONTENT[id] ?? null : null, world: id ? worldOverrides()[id] ?? null : null, item: itemLayer(item) };
  return {
    identifier: id,
    entry: mergeEntries([layers.module, layers.world, layers.item]),
    layers: { module: !!layers.module, world: !!layers.world, item: !!layers.item }
  };
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
  return units;
}

/** §124 : les activations qu'un joueur déclenche lui-même (pas une réaction, pas un supplément au coup). */
const PLAYER_ACTIVATIONS = ["action", "bonus"];
/** §124 : les cibles qui désignent une créature (ou un objet) autre que le lanceur. */
const TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any", "enemy", "object"];

/** Les cibles d'un soin qui désignent une autre créature que le lanceur. */
const HEAL_TARGETS = ["creature", "creatureOrObject", "ally", "willing", "any"];
