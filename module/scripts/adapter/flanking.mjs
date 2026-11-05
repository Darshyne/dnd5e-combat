/**
 * §369 (issue GitHub #27) : la prise en tenaille sur la scène — trois réglages de monde, la tenaille désactivée par défaut.
 *  - `flanking` : « off » (défaut) ou « advantage » ;
 *  - `flankingSide` : qui en profite — « all » (PJ et PNJ, défaut), « pc » (PJ seulement), « npc » (PNJ seulement) ;
 *  - `flankingConga` : pas de tenaille en chaîne — une créature elle-même prise en tenaille ne prend pas en tenaille et n'y aide pas.
 * Rien n'est posé sur les tokens : la tenaille se juge à chaque attaque (et à chaque survol de la chance de toucher), depuis les
 * positions validées (`_source`), si bien qu'un allié qui s'éloigne ou tombe ne la donne plus.
 *
 * Conditions (DMG 2014, règle optionnelle) : attaque au corps à corps, attaquant et allié au contact de la cible (1,50 m, en 3D),
 * de part et d'autre (core/flanking.mjs), sur le même plan qu'elle ; l'allié est un allié de l'attaquant (factions), ni mort, ni
 * Neutralisé, ni caché, et voit la cible ; l'attaquant aussi doit la voir. Grille carrée seulement.
 */
import { MODULE_ID } from "../constants.mjs";
import { flanks, flankingApplies } from "../core/flanking.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { rangeIssue } from "../core/range.mjs";
import { committedPosition, distanceBetween } from "./turn.mjs";
import { areAllies, areEnemies } from "./factions.mjs";
import { canSee, isVisionAvailable } from "./vision.mjs";
import { samePlane } from "./plane.mjs";
import { isDeadActor } from "./death.mjs";
import { isObjectToken } from "./bodies.mjs";

export const FLANKING_SETTING = "flanking";
export const FLANKING_SIDE_SETTING = "flankingSide";
export const FLANKING_CONGA_SETTING = "flankingConga";

const read = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; }
};

/** La tenaille est-elle en service sur ce monde ? */
export const flankingOn = () => read(FLANKING_SETTING, "off") === "advantage";

/** L'espace d'un token en cases (à `pos` s'il est donné : position hypothétique de l'attaquant au bout d'une approche). */
function spaceOf(token, pos=null) {
  const grid = token.parent.grid;
  const p = pos ? { ...committedPosition(token), ...pos } : committedPosition(token);
  return { x: p.x / grid.sizeX, y: p.y / grid.sizeY, w: p.width ?? 1, h: p.height ?? 1 };
}

const touching = (a, b, factors, positions) => rangeIssue(distanceBetween(a, b, positions), { value: 5, units: "ft" }, factors) === null;
const sees = (observer, target) => !isVisionAvailable() || canSee(observer, target);
const able = token => token?.actor && !token.hidden && !isObjectToken(token) && !isDeadActor(token.actor)
  && !INCAPACITATING.some(s => token.actor.statuses?.has?.(s));

/** Les créatures qui peuvent prendre `target` en tenaille dans le camp de `side` : au contact, valides, qui la voient. */
function flankersOf(target, side, factors, exclude=null) {
  return target.parent.tokens.filter(t => (t !== target) && (t !== exclude) && able(t) && areAllies(side, t) && areEnemies(t, target)
    && samePlane(t, target) && touching(t, target, factors) && sees(t, target));
}

/** Cette créature est-elle elle-même prise en tenaille (par deux de ses ennemis) ? Sert la règle « pas de tenaille en chaîne ». */
function isFlanked(token, factors, pos=null) {
  const box = spaceOf(token, pos);
  const enemies = token.parent.tokens.filter(t => (t !== token) && able(t) && areEnemies(t, token) && samePlane(t, token)
    && touching(t, token, factors, pos ? { posB: pos } : {}) && sees(t, token));
  return enemies.some((a, i) => enemies.slice(i + 1).some(b => areAllies(a, b) && flanks(box, spaceOf(a), spaceOf(b))));
}

/**
 * Le nom de l'allié avec qui l'attaquant prend la cible en tenaille, ou null.
 * @param {TokenDocument} origin
 * @param {TokenDocument} target
 * @param {{ranged: boolean, factors: object, posA?: object}} options
 * @returns {string|null}
 */
export function flankingAlly(origin, target, { ranged, factors, posA }={}) {
  if ( ranged || !origin?.actor || !target?.actor || (origin === target) ) return null;
  const grid = origin.parent?.grid;
  if ( !grid || grid.isGridless || !grid.isSquare || (origin.parent !== target.parent) ) return null;
  if ( !flankingApplies({ mode: read(FLANKING_SETTING, "off"), side: read(FLANKING_SIDE_SETTING, "all"), attackerIsPc: origin.actor.type === "character" }) ) return null;
  if ( !areEnemies(origin, target) || !samePlane(origin, target) || !touching(origin, target, factors, { posA }) || !sees(origin, target) ) return null;
  const conga = read(FLANKING_CONGA_SETTING, false) === true;
  if ( conga && isFlanked(origin, factors, posA) ) return null;
  const box = spaceOf(target), mine = spaceOf(origin, posA);
  const ally = flankersOf(target, origin, factors, origin)
    .find(t => flanks(box, mine, spaceOf(t)) && !(conga && isFlanked(t, factors)));
  return ally?.name ?? null;
}
