/**
 * Qui une activité peut viser d'un clic (mode visée, ui/pointer.mjs), d'après le type de cible que dnd5e lui donne
 * (`target.affects.type`, CONFIG.DND5E.individualTargetTypes, config.mjs:2814) : self, ally, enemy, creature, object,
 * space, creatureOrObject, any, willing. Règles 2024 : « une créature » vous comprend, sauf si le texte dit « une autre
 * créature » (et dnd5e ne le code pas : c'est alors au joueur de ne pas se cliquer) ; une attaque ne vise jamais son auteur.
 * Fonctions pures.
 */

/** Les types qui se visent en cliquant une créature. */
export const CLICK_TARGET_TYPES = Object.freeze(["creature", "creatureOrObject", "ally", "enemy", "object", "willing", "any"]);

/** Ceux qui peuvent désigner le lanceur lui-même. */
const SELF_ALLOWED = Object.freeze(["creature", "creatureOrObject", "ally", "willing", "any"]);

/**
 * La règle de visée d'une activité, ou null si elle ne se vise pas d'un clic (zone à poser, portée personnelle, espace).
 * @param {{type: string, affects?: string, rangeUnits?: string, template?: string}} activity
 * @returns {{self: boolean, side: "ally"|"enemy"|null}|null}
 */
export function targetRule({ type, affects, rangeUnits, template }) {
  if ( template ) return null;                                      // une zone se pose, elle ne se vise pas
  if ( type === "attack" ) return { self: false, side: null };
  if ( !CLICK_TARGET_TYPES.includes(affects) || (rangeUnits === "self") ) return null;
  return { self: SELF_ALLOWED.includes(affects), side: ["ally", "enemy"].includes(affects) ? affects : null };
}

/**
 * Relation entre deux dispositions de token (1 amical, 0 neutre, -1 hostile, -2 secret) : « same » (même camp déclaré),
 * « opposed » (amical contre hostile), « neutral » (tout le reste : on ne sait pas).
 */
export function relationOf(mine, theirs) {
  if ( ![1, -1].includes(mine) || ![1, -1].includes(theirs) ) return "neutral";
  return mine === theirs ? "same" : "opposed";
}

/**
 * Pourquoi ce clic ne peut pas désigner cette créature, ou null. « self » : pas soi-même ; « notAlly » : un ennemi déclaré
 * pour un sort qui vise un allié ; « notEnemy » : un allié déclaré (ou soi) pour un sort qui vise un ennemi. Un token neutre
 * ou secret n'est jamais refusé : on ne sait pas de quel côté il est.
 * @param {{self: boolean, side: string|null}} rule
 * @param {{isSelf: boolean, relation: "same"|"opposed"|"neutral"}} candidate
 */
export function targetRefusal(rule, { isSelf, relation }) {
  if ( !rule ) return null;
  if ( isSelf ) return rule.self ? null : "self";
  if ( (rule.side === "ally") && (relation === "opposed") ) return "notAlly";
  if ( (rule.side === "enemy") && (relation === "same") ) return "notEnemy";
  return null;
}
