/**
 * §182 : le cône de vision d'un observateur, lu dans Foundry (`core/cone.mjs`). S'applique à une créature **du MJ** (ni PJ ni
 * possédée par un joueur), **hors d'un combat commencé** où elle figure, quand le réglage de monde `visionCones` est allumé.
 * Angle : flag du token `flags.dnd5e-combat.coneAngle` > réglage `coneAngles` par type > défaut ; un `sight.angle` de token plus
 * étroit l'emporte. Vision aveugle, perception des vibrations et vision véritable : 360° dans leur portée.
 */

import { MODULE_ID } from "../constants.mjs";
import { parseConeAngles, coneAngleFor, inCone, formatConeAngles } from "../core/cone.mjs";
import { committedPosition, tokenCenter } from "./turn.mjs";
import { settingOr } from "./settings.mjs";

export const CONES_SETTING = "visionCones";
export const ANGLES_SETTING = "coneAngles";
export const DEFAULT_ANGLES_TEXT = formatConeAngles();

/** Les sens qui perçoivent tout autour (ids des modes de détection du cœur et de dnd5e). */
const ALL_AROUND = ["blindsight", "feelTremor", "seeAll"];

let cachedText = null;
let cachedTable = null;
function angles() {
  let text;
  try { text = game.settings.get(MODULE_ID, ANGLES_SETTING); } catch { text = DEFAULT_ANGLES_TEXT; }
  if ( text !== cachedText ) { cachedText = text; cachedTable = parseConeAngles(text); }
  return cachedTable;
}

function enabled() {
  return settingOr(CONES_SETTING, false) === true;
}

/** Un PJ, ou une créature qu'un joueur possède : jamais de cône (le joueur voit ce qu'il voit). */
const playerSide = actor => !!actor && ((actor.type === "character") || !!actor.hasPlayerOwner);

/** Figure-t-il dans un combat commencé ? */
function fighting(doc) {
  return !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.tokenId === doc.id));
}

/**
 * Le cône d'un observateur, ou null s'il voit à 360° (réglage coupé, PJ, en combat, angle ≥ 360).
 * @param {TokenDocument} doc
 * @returns {{angle: number, rotation: number}|null}
 */
export function coneOf(doc) {
  if ( !doc?.actor || !enabled() || playerSide(doc.actor) || fighting(doc) ) return null;
  const details = doc.actor.system?.details ?? {};
  const own = Number(doc.getFlag?.(MODULE_ID, "coneAngle"));
  let angle = Number.isFinite(own) && (own > 0) ? own : coneAngleFor(angles(), {
    type: details.type?.value ?? null, subtype: details.type?.subtype ?? null, identifier: doc.actor.system?.identifier ?? null
  });
  const sight = Number(doc.sight?.angle);
  if ( Number.isFinite(sight) && (sight > 0) && (sight < angle) ) angle = sight;
  if ( !(angle < 360) ) return null;
  return { angle, rotation: Number(doc.rotation) || 0 };
}

/** La portée (unités de la grille) d'un sens qui perçoit tout autour, la plus grande ; 0 sans. */
function allAroundRange(doc) {
  let best = 0;
  for ( const id of ALL_AROUND ) {
    const mode = doc.detectionModes?.[id];
    if ( !mode || (mode.enabled === false) ) continue;
    const range = (mode.range === null || mode.range === undefined) ? Infinity : Number(mode.range);
    if ( range > best ) best = range;
  }
  return best;
}

/**
 * La cible est-elle **hors** du cône de l'observateur (et hors de portée de ses sens à 360°) ? false quand il n'a pas de cône.
 * Les points testés : le centre et les quatre coins de la cible.
 */
export function outsideCone(observer, target) {
  const cone = coneOf(observer);
  if ( !cone || !target?.parent ) return false;
  const eye = tokenCenter(observer);
  const pos = committedPosition(target);
  const grid = target.parent.grid;
  // La taille du document engagé, comme la position (`_source`) : pas celle, animée, d'un changement de taille en cours.
  const size = target._source ?? target;
  const w = (size.width ?? 1) * grid.sizeX, h = (size.height ?? 1) * grid.sizeY;
  const points = [{ x: pos.x + w / 2, y: pos.y + h / 2 }, { x: pos.x, y: pos.y }, { x: pos.x + w, y: pos.y },
    { x: pos.x, y: pos.y + h }, { x: pos.x + w, y: pos.y + h }];
  if ( inCone(eye, cone.rotation, cone.angle, points) ) return false;
  const range = allAroundRange(observer);
  if ( range > 0 ) {
    const distance = grid.measurePath([eye, points[0]]).distance;
    if ( distance <= range ) return false;
  }
  return true;
}
