/**
 * Escalade (SPEC §192, lots 1 et 2), lue dans Foundry : les murs qu'un token touche, son état de grimpeur, ses vitesses, la marche
 * au plafond (sa capacité, le plafond au-dessus de lui).
 *
 * Vérifié :
 *  - les arêtes d'un niveau sont dans `Level#edges` (client/documents/level.mjs:51, un `CanvasEdges`), interrogées par rectangle
 *    (`CanvasEdges#getEdges(rect, { includeOuterBounds })`, canvas/geometry/edges/edges.mjs:140) ; une arête de mur porte son
 *    document (`Edge#object`, client/documents/wall.mjs:164-166), ses extrémités `a` / `b` et sa restriction `move`
 *    (edge.mjs:23-35) ;
 *  - les murs du cœur n'ont pas de hauteur (common/documents/wall.mjs) : on monte le long de la face, dans la même pièce ;
 *  - les murs posés par un sort portent `flags.dnd5e-combat.zone` (adapter/walls.mjs:40) ; leur région porte l'item (`flags.dnd5e.item`).
 */

import { MODULE_ID } from "../constants.mjs";
import { segmentTouchesRect, isClimbableWall, climbSpeed, climbMultiplier, climbFallReason, grantsCeiling, ceilingPerch } from "../core/climb.mjs";
import { identifierOf, contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { settingOr } from "./settings.mjs";
import { committedPosition, positionOf } from "./turn.mjs";
import { groundUnder, boundsUnder, speedsOf } from "./altitude.mjs";

export const CLIMB_RULES_SETTING = "climbRules";
/** Un mur tracé un peu à côté du bord de la case compte encore (fraction d'une case). */
const WALL_TOLERANCE = 0.1;

/** Les règles d'escalade du monde : `2024` (sans jet) ou `house` (DD 15 à chaque tour, chute sur un échec). */
export function climbRules() {
  return settingOr(CLIMB_RULES_SETTING, "2024") === "house" ? "house" : "2024";
}

/** Le token grimpe-t-il (mode de déplacement `climb`) ? */
export const isClimbing = token => token?._source?.movementAction === "climb";

/** Le drapeau d'escalade du moteur (`flags.dnd5e-combat.climb` : `from`, `checkedAt`, `ceiling`). */
export const CLIMB_FLAG = "climb";
/** Le miroir vertical posé au plafond (`flags.dnd5e-combat.ceilingFlip` : `{ scaleY }`, l'échelle d'origine). */
export const FLIP_FLAG = "ceilingFlip";

/** §192 lot 2 : le token marche-t-il au plafond (en escalade, drapeau `climb.ceiling`) ? */
export const isOnCeiling = token => isClimbing(token) && (token.getFlag?.(MODULE_ID, CLIMB_FLAG)?.ceiling === true);

/** L'identifiant du sort qui a posé ce mur, ou null (un mur ordinaire). */
function spellOfWall(wall) {
  const regionId = wall.getFlag?.(MODULE_ID, "zone");
  if ( !regionId ) return null;
  const region = wall.parent?.regions.get(regionId);
  const item = fromUuidSync(region?.getFlag("dnd5e", "item") ?? "", { strict: false });
  return item ? (identifierOf(item).id ?? "spell") : "spell";
}

/**
 * Les murs que le token touche à une position (son emprise, le long de son niveau) et qu'on peut grimper : ni porte ouverte, ni mur
 * sans restriction de déplacement, ni mur de sort (sauf Mur de pierre).
 * @param {TokenDocument} token
 * @param {object} [pos]  Position (source ou point de passage), sinon la position validée.
 * @returns {WallDocument[]}
 */
export function wallsNear(token, pos=committedPosition(token)) {
  const scene = token?.parent;
  const grid = scene?.grid;
  if ( !grid ) return [];
  const level = scene.levels?.get?.(pos.level ?? token._source.level) ?? scene.initialLevel ?? null;
  const edges = level?.edges;
  if ( typeof edges?.getEdges !== "function" ) return [];
  const width = (pos.width ?? token._source.width ?? 1) * grid.sizeX;
  const height = (pos.height ?? token._source.height ?? 1) * grid.sizeY;
  const tolerance = grid.size * WALL_TOLERANCE;
  const rect = { x: pos.x, y: pos.y, width, height };
  const query = new PIXI.Rectangle(rect.x - tolerance, rect.y - tolerance, width + (2 * tolerance), height + (2 * tolerance));
  const out = [];
  let found;
  try { found = edges.getEdges(query, { includeOuterBounds: false }); }
  catch { return []; }
  for ( const edge of found ) {
    if ( edge.type !== "wall" ) continue;
    const wall = edge.object?.document ?? edge.object;
    if ( !wall?.documentName || out.includes(wall) ) continue;
    if ( !segmentTouchesRect(edge.a, edge.b, rect, tolerance) ) continue;
    const openDoor = (wall.door !== CONST.WALL_DOOR_TYPES.NONE) && (wall.ds === CONST.WALL_DOOR_STATES.OPEN);
    if ( !isClimbableWall({ move: edge.move !== CONST.WALL_MOVEMENT_TYPES.NONE, openDoor, spell: spellOfWall(wall) }) ) continue;
    out.push(wall);
  }
  return out;
}

/** La vitesse d'escalade du token (`native` : une vraie vitesse d'escalade, sinon la marche) et le multiplicateur de coût de dnd5e. */
export function climbingOf(token) {
  const speeds = speedsOf(token?.actor);
  return { ...climbSpeed(speeds), multiplier: climbMultiplier(speeds) };
}

/** Pourquoi ce grimpeur ne tient plus au mur, ou null : À terre, Neutralisé, Agrippé, sans vitesse. */
export function climbFallReasonFor(token) {
  const actor = token?.actor;
  const statuses = actor?.statuses ?? new Set();
  return climbFallReason({
    prone: statuses.has("prone"), incapacitated: statuses.has("incapacitated"), grappled: statuses.has("grappled"),
    speed: climbSpeed(speedsOf(actor)).speed
  });
}

/** Le token est-il au-dessus de son sol ? */
export function aboveGround(token) {
  return (token._source.elevation ?? 0) > groundUnder(token) + 1e-6;
}

/* -------------------------------------------- */
/*  Plafonds (lot 2)                            */
/* -------------------------------------------- */

/**
 * La créature peut-elle marcher au plafond (§192.3) ? Par un item qu'elle porte — identifiant `spider-climb` (trait de monstre, trait
 * du Dhampir de Ravenloft), `slippers-of-spider-climbing`, `cloak-of-arachnida` (équipés), ou toute entrée de contenu `climbsCeilings`
 * (ouvert aux voisins) — ou par un effet qu'un tel item a posé (le SORT Pattes d'araignée : le connaître ne suffit pas, comme pour
 * l'espace partagé, adapter/space-sharing.mjs).
 * @param {Actor5e} actor
 */
export function canWalkCeilings(actor) {
  if ( !actor ) return false;
  const grants = item => grantsCeiling(identifierOf(item).id, contentOf(item).entry);
  for ( const item of actor.items ?? [] ) {
    if ( item.type === "spell" ) continue;
    if ( (item.type === "equipment") && !item.system?.equipped ) continue;
    if ( grants(item) ) return true;
  }
  for ( const effect of actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && grants(item) ) return true;
  }
  return false;
}

/**
 * L'élévation des pieds du token accroché au plafond au-dessus d'une position (la plus basse Surface `move` au-dessus de son sol,
 * `ceilingAt`, moins sa hauteur), ou null sans plafond. `pos` : point de passage ou position d'arrivée, sinon la position validée.
 */
export function ceilingPerchFor(token, pos=committedPosition(token)) {
  const scene = token?.parent;
  if ( !scene?.grid ) return null;
  const { ceiling } = boundsUnder(token, pos);   // déjà : plafond moins la hauteur du token (tête comprise)
  if ( !Number.isFinite(ceiling) ) return null;
  const depth = positionOf({ ...token._source, ...pos }).depth ?? 1;
  return ceilingPerch(ceiling + (depth * scene.grid.distance), depth, scene.grid.distance);
}

/** Le token, à cette position, serait-il bien accroché au plafond (ses pieds à la hauteur du perchoir) ? */
export function hangsAt(token, pos=committedPosition(token)) {
  const perch = ceilingPerchFor(token, pos);
  return (perch !== null) && (Math.abs((pos.elevation ?? token._source.elevation ?? 0) - perch) < 1e-6);
}
