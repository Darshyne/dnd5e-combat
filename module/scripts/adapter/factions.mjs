/**
 * §181 : la faction d'un token et son « camp », lus dans Foundry ; la table du cœur (`core/factions.mjs`) tenue à jour.
 *
 * Faction d'un token, dans l'ordre : flag du token `flags.dnd5e-combat.faction` (le MJ l'a posé sur ce token) > flag de
 * l'acteur (posé sur l'acteur : vaut pour tous ses tokens, liés ou non) > `party` pour un PJ ou ce que possède un joueur >
 * la première règle de type qui correspond (réglage `factionRules`) > aucune. Une valeur `"none"` dans un flag dit
 * « aucune faction » et arrête la recherche.
 *
 * Réglage de monde `factions` : `{ factions: [{ id, name, color, rules }], relations: { "a|b": relation } }` (normalisé par le
 * cœur). Rancunes : flag de scène `flags.dnd5e-combat.grudges`, couples `[a, b]` d'ids de faction ou d'uuid de token.
 */

import { MODULE_ID } from "../constants.mjs";
import { settingOr } from "./settings.mjs";
import {
  PARTY, GENERIC_FACTIONS, normalizeFactions, factionByRules, useFactionTable, factionTable, hostileSides, alliedSides,
  targetRelation, factionRelation
} from "../core/factions.mjs";

export const FACTIONS_SETTING = "factions";
export const RULES_SETTING = "factionRules";
export const NONE = "none";

/** Le réglage par défaut : les PJ et les factions génériques, aucune relation (tout suit la disposition). */
export function defaultFactions() {
  return { factions: [{ id: PARTY, color: "#3a7bd5", rules: {} }, ...GENERIC_FACTIONS.map(f => ({ ...f, name: "", rules: { ...f.rules } }))], relations: {} };
}

let settings = normalizeFactions(defaultFactions());

/** Le nom affiché d'une faction (générique : traduit, si le MJ ne l'a pas renommée). */
export function factionName(faction) {
  if ( !faction ) return "";
  if ( faction.name ) return faction.name;
  const key = faction.id === PARTY ? "DND5ECOMBAT.Factions.Party" : `DND5ECOMBAT.Factions.Generic.${faction.id}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : faction.id;
}

/** Le réglage normalisé, tel que le cœur le lit. */
export function factionSettings() {
  return settings;
}

const readSetting = () => {
  return settingOr(FACTIONS_SETTING, null);
};
const rulesOn = () => {
  return settingOr(RULES_SETTING, true) !== false;
};

/** Recharger la table du cœur : réglage + rancunes de la scène affichée. */
export function refreshFactionTable(scene=globalThis.canvas?.scene ?? null) {
  settings = normalizeFactions(readSetting() ?? defaultFactions());
  const grudges = (scene?.getFlag?.(MODULE_ID, "grudges") ?? []).filter(g => Array.isArray(g) && (g.length === 2));
  useFactionTable({ factions: settings.factions, relations: settings.relations, grudges });
}

const doc = t => t?.document ?? t ?? null;

/** Un PJ, ou une créature qu'un joueur possède (familier, invocation) ? */
function isParty(actor) {
  return !!actor && ((actor.type === "character") || !!actor.hasPlayerOwner);
}

/** La faction d'un token (document ou objet), ou null. */
export function factionOf(token) {
  const t = doc(token);
  if ( !t ) return null;
  const known = id => settings.factions.some(f => f.id === id);
  const own = t.getFlag?.(MODULE_ID, "faction");
  if ( own === NONE ) return null;
  if ( own && known(own) ) return own;
  const actor = t.actor ?? null;
  const fromActor = actor?.getFlag?.(MODULE_ID, "faction");
  if ( fromActor === NONE ) return null;
  if ( fromActor && known(fromActor) ) return fromActor;
  if ( isParty(actor) ) return PARTY;
  if ( !actor || !rulesOn() ) return null;
  const details = actor.system?.details ?? {};
  return factionByRules(settings.factions, {
    type: details.type?.value ?? null, subtype: details.type?.subtype ?? null, identifier: actor.system?.identifier ?? null
  });
}

/** La faction posée à la main (token, sinon acteur), sans les règles : pour l'interface. */
export function explicitFaction(token) {
  const t = doc(token);
  return t?.getFlag?.(MODULE_ID, "faction") ?? t?.actor?.getFlag?.(MODULE_ID, "faction") ?? null;
}

/**
 * Le camp d'un token, ce que le cœur compare : `{ disposition, faction, uuid, stance }`. `disposition` peut être forcée
 * (un objet piloté prend celle de son lanceur, `runtime/actions.mjs` `hostileTo`).
 */
export function sideOf(token, { disposition }={}) {
  const t = doc(token);
  if ( !t ) return { disposition: disposition ?? null };
  return {
    disposition: disposition ?? t.disposition, faction: factionOf(t), uuid: t.uuid ?? null,
    stance: t.getFlag?.(MODULE_ID, "stance") ?? null
  };
}

/** Ennemis ? (factions, sinon Amical contre Hostile) */
export function areEnemies(a, b) {
  return hostileSides(sideOf(a), sideOf(b));
}

/** Même camp ? (factions, sinon même disposition) */
export function areAllies(a, b) {
  return alliedSides(sideOf(a), sideOf(b));
}

/** Pour le ciblage : « same », « opposed », « neutral ». */
export function relationForTargeting(a, b) {
  return targetRelation(sideOf(a), sideOf(b));
}

/** La relation publique : `hostile`, `neutral` ou `allied` (factions, sinon déduite des dispositions). */
export function relationBetween(a, b) {
  const sa = sideOf(a), sb = sideOf(b);
  const r = factionRelation(sa, sb);
  if ( r ) return r;
  if ( hostileSides(sa, sb) ) return "hostile";
  return alliedSides(sa, sb) ? "allied" : "neutral";
}

export { factionTable, PARTY };

/** Alliés déclarés : même camp **et** pas neutre (un neutre n'a pas d'alliés) — factions, sinon Amical/Amical ou Hostile/Hostile. */
export function areSworn(a, b) {
  const sa = sideOf(a), sb = sideOf(b);
  const r = factionRelation(sa, sb);
  if ( r ) return r === "allied";
  return [1, -1].includes(sa.disposition) && (sa.disposition === sb.disposition);
}
