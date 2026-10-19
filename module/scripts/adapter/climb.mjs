/**
 * Escalade (SPEC §192, lots 1 à 3), lue dans Foundry : les murs qu'un token touche, son état de grimpeur, ses vitesses, la marche
 * au plafond (sa capacité, le plafond au-dessus de lui), les surfaces glissantes et le Mouvement acrobatique du moine (§195).
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
import {
  segmentTouchesRect, isClimbableWall, climbSpeed, climbMultiplier, climbFallReason, grantsCeiling, ceilingPerch, acrobaticAllowed, ledgeRise
} from "../core/climb.mjs";
import { identifierOf, contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { isConcentrationEffect } from "./concentration.mjs";
import { settingOr } from "./settings.mjs";
import { committedPosition, positionOf } from "./turn.mjs";
import { groundUnder, boundsUnder, speedsOf, levelAt } from "./altitude.mjs";

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
 * l'espace partagé, adapter/space-sharing.mjs). Sur une surface glissante (`slippery`, §195), pas par les Pantoufles d'araignée.
 * @param {Actor5e} actor
 * @param {{slippery?: boolean}} [options]
 */
export function canWalkCeilings(actor, { slippery=false }={}) {
  if ( !actor ) return false;
  const grants = item => grantsCeiling(identifierOf(item).id, contentOf(item).entry, { slippery });
  for ( const item of actor.items ?? [] ) {
    if ( item.type === "spell" ) continue;
    if ( (item.type === "equipment") && !item.system?.equipped ) continue;
    if ( grants(item) ) return true;
  }
  for ( const effect of actor.effects ?? [] ) {
    // §195 : la concentration du lanceur a pour origine le sort aussi — elle ne donne rien (Pattes d'araignée lancée sur un allié).
    if ( effect.disabled || effect.isSuppressed || isConcentrationEffect(effect) ) continue;
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

/* -------------------------------------------- */
/*  Contenu (lot 3, §195)                       */
/* -------------------------------------------- */

/** La zone d'une région est-elle glissante (son item déclare `slippery` : Graisse, flaque d'Huile) ? */
function isSlipperyRegion(region) {
  const uuid = region.getFlag?.("dnd5e", "item");
  if ( !uuid ) return false;
  const item = fromUuidSync(uuid, { strict: false });
  return contentOf(item).entry?.slippery === true;
}

/**
 * Le token se tient-il, à cette position, sur une surface glissante — dans une zone Graisse ou une flaque d'Huile (élévation comprise :
 * la zone a sa tranche, on en sort en montant) ?
 * @param {TokenDocument} token
 * @param {object} [pos]
 */
export function inSlipperyZone(token, pos=committedPosition(token)) {
  for ( const region of token?.parent?.regions ?? [] ) {
    if ( !isSlipperyRegion(region) ) continue;
    try { if ( token.testInsideRegion(region, pos) ) return true; }
    catch { /* région sans forme */ }
  }
  return false;
}

/** La créature peut-elle marcher au plafond là où se tient ce token (les Pantoufles ne tiennent pas sur une surface glissante) ? */
export const canWalkCeilingsAt = (token, pos=committedPosition(token)) => canWalkCeilings(token?.actor, { slippery: inSlipperyZone(token, pos) });

/** L'item de Mouvement acrobatique de l'acteur (contenu `climbsOnTurn`), ou null. */
export function acrobaticItemOf(actor) {
  return (actor?.items ?? []).find(i => contentOf(i).entry?.climbsOnTurn === true) ?? null;
}

/**
 * Le token peut-il « courir sur le mur » maintenant (Mouvement acrobatique, §195) : l'item, sans armure ni bouclier, et en combat à son
 * tour seulement (hors combat, toujours).
 */
export function acrobaticFor(token) {
  const actor = token?.actor;
  if ( !acrobaticItemOf(actor) ) return false;
  const ac = actor.system?.attributes?.ac ?? {};
  const combat = game.combat?.started ? game.combat : null;
  const inCombat = !!combat?.combatants.some(c => c.tokenId === token.id);
  return acrobaticAllowed({ armor: !!ac.equippedArmor, shield: !!ac.equippedShield, inCombat, ownTurn: combat?.combatant?.tokenId === token.id });
}

/* -------------------------------------------- */
/*  Se hisser (§209)                             */
/* -------------------------------------------- */

/**
 * §216 : un mur du niveau `level` sépare-t-il ces deux cases à cette hauteur ? (Le mur extérieur d'un étage entre le grimpeur dehors
 * et le plancher de l'étage : on ne s'y hisse pas à travers.) Le test de mouvement du cœur, de centre à centre, sur ce niveau ; sans
 * canevas, rien ne bloque.
 */
export function crossingBlocked(token, from, to, level, elevation) {
  const scene = token?.parent;
  const grid = scene?.grid;
  const backend = CONFIG.Canvas?.polygonBackends?.move;
  if ( !grid || (typeof backend?.testCollision !== "function") || !canvas?.ready || (canvas.scene !== scene) ) return false;
  const w = (token._source.width ?? 1) * grid.sizeX / 2;
  const h = (token._source.height ?? 1) * grid.sizeY / 2;
  const doc = scene.levels?.get?.(level) ?? undefined;
  try {
    return backend.testCollision({ x: from.x + w, y: from.y + h, elevation }, { x: to.x + w, y: to.y + h, elevation },
      { type: "move", mode: "any", level: doc }) === true;
  } catch { return false; }
}

/** Les quatre directions d'un rebord, et leur nom (clé de traduction `Escalade.Dir.*`). */
const LEDGE_DIRS = Object.freeze([{ di: -1, dj: 0, dir: "n" }, { di: 1, dj: 0, dir: "s" }, { di: 0, dj: 1, dir: "e" }, { di: 0, dj: -1, dir: "w" }]);

/**
 * §209 : les rebords où ce grimpeur peut se hisser maintenant — une case voisine (nord, sud, est, ouest) dont le sol est plus haut que ses
 * pieds et à portée de sa tête, avec la place de s'y tenir (`ledgeRise`). Au mur seulement (pas au plafond). Rend pour chacun la case,
 * le point d'arrivée, le sol, la hauteur à monter et le niveau où il prend pied (le sol à 20 ft d'un niveau 0-20 est le bas du suivant).
 * @returns {{dir: string, x: number, y: number, ground: number, rise: number, level: string}[]}
 */
export function ledgesOf(token) {
  if ( !isClimbing(token) || isOnCeiling(token) ) return [];
  const scene = token.parent;
  const grid = scene?.grid;
  if ( !grid?.size ) return [];
  const pos = committedPosition(token);
  const feet = pos.elevation ?? 0;
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * grid.distance;
  const out = [];
  // Le sol d'un niveau ne compte que ses Surfaces de `[bas, haut[` (adapter/altitude.mjs, `groundAt`) : un toit à 20 ft n'est pas le sol du
  // niveau 0-20 (c'en est le plafond), mais celui du niveau qui commence à 20. On regarde donc le niveau du grimpeur et celui de sa tête.
  const own = pos.level ?? token._source.level;
  const levels = [...new Set([own, levelAt(scene, feet + height, own)])];
  // §216 : la tête du grimpeur ne passe pas son propre plafond.
  const ownCeiling = boundsUnder(token, pos).ceiling + height;
  for ( const { di, dj, dir } of LEDGE_DIRS ) {
    let best = null;
    for ( const level of levels ) {
      const at = { ...pos, level, x: pos.x + (dj * grid.sizeX), y: pos.y + (di * grid.sizeY) };
      const { ground, ceiling } = boundsUnder(token, at);
      const rise = ledgeRise({ feet, height, ground, ceiling: ceiling + height });
      if ( (rise === null) || (best && (ground <= best.ground)) ) continue;
      // §216 : ni à travers son propre plafond (un couloir couvert : la tête ne monte pas au-dessus), ni à travers le mur d'une pièce
      // couverte au niveau d'arrivée. Un toit à ciel ouvert reste accessible malgré le mur qui borde souvent son bord (garde-fou).
      if ( ground >= ownCeiling - 1e-6 ) continue;
      const arrival = levelAt(scene, ground, level);
      if ( Number.isFinite(ceiling) && crossingBlocked(token, pos, at, arrival, ground + 1) ) continue;
      best = { dir, x: at.x, y: at.y, ground, rise, level: arrival };
    }
    if ( best ) out.push(best);
  }
  return out;
}

/**
 * §215 : le haut du mur que ce token regarde, pour la jauge de la fenêtre d'escalade — le rebord le plus bas où poser les pieds sur une
 * case voisine (plus haut que ses pieds, à portée de sa tête sous le plafond ; avec le nom de son niveau), sinon le plafond (la Surface
 * au-dessus de sa tête), sinon null ; et `ceilingFeet`, l'élévation la plus haute de ses pieds. Au sol comme au mur.
 * @returns {{top: {kind: "ledge"|"ceiling", at: number, name?: string|null}|null, ceilingFeet: number, height: number}}
 */
export function wallTopOf(token) {
  const scene = token?.parent;
  const grid = scene?.grid;
  const pos = committedPosition(token);
  const feet = pos.elevation ?? 0;
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * (grid?.distance ?? 5);
  const { ceiling } = boundsUnder(token, pos);
  const ceilingFeet = Number.isFinite(ceiling) ? ceiling : Infinity;
  if ( !grid?.size ) return { top: null, ceilingFeet, height };
  const own = pos.level ?? token._source.level;
  // Le niveau du grimpeur et tous ceux qui commencent au-dessus de ses pieds, sous son plafond (à ciel ouvert : tous) — le toit voisin
  // peut appartenir à n'importe lequel.
  const above = Array.from(scene.levels ?? []).filter(l => {
    const bottom = Number(l.elevation?.bottom);
    return Number.isFinite(bottom) && (bottom > feet + 1e-6) && (bottom < ceilingFeet + height - 1e-6);
  }).map(l => l.id);
  const levels = [...new Set([own, ...above])];
  let ledge = null;
  for ( const { di, dj } of LEDGE_DIRS ) {
    for ( const level of levels ) {
      const at = { ...pos, level, x: pos.x + (dj * grid.sizeX), y: pos.y + (di * grid.sizeY) };
      const { ground } = boundsUnder(token, at);
      if ( !Number.isFinite(ground) || (ground <= feet + 1e-6) || (ground >= ceilingFeet + height - 1e-6) ) continue;
      const arrival = levelAt(scene, ground, level);
      if ( Number.isFinite(boundsUnder(token, at).ceiling) && crossingBlocked(token, pos, at, arrival, ground + 1) ) continue;
      if ( !ledge || (ground < ledge.at) ) ledge = { kind: "ledge", at: ground, level: arrival };
    }
  }
  if ( ledge ) {
    ledge.name = scene.levels?.get?.(ledge.level)?.name ?? null;
    return { top: ledge, ceilingFeet, height };
  }
  return { top: Number.isFinite(ceiling) ? { kind: "ceiling", at: ceilingFeet + height } : null, ceilingFeet, height };
}

/**
 * §216 : les niveaux de la scène qui commencent au-dessus de ces pieds (repères de la jauge d'escalade) : nom et élévation du bas, du
 * plus bas au plus haut. Les joueurs les voient déjà dans le navigateur de niveaux du cœur.
 * @returns {Array<{at: number, name: string}>}
 */
export function levelMarksAbove(token, feet) {
  const out = [];
  for ( const level of token?.parent?.levels ?? [] ) {
    const bottom = Number(level.elevation?.bottom);
    if ( Number.isFinite(bottom) && (bottom > feet + 1e-6) ) out.push({ at: bottom, name: level.name });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * §216 : les bords d'où ce token peut se laisser pendre, pour descendre le long du mur — au sol (sur un toit, un chemin de ronde, un
 * étage), une case voisine dont le sol est plus bas d'au moins une case, sans mur sur son propre niveau entre les deux (un parapet se
 * franchit autrement), et un mur où s'agripper de l'autre côté. Il s'y retrouve accroché, la tête à hauteur du bord.
 * @returns {{dir: string, x: number, y: number, elevation: number, level: string, drop: number}[]}
 */
export function edgesBelowOf(token) {
  if ( !token?.parent?.grid || isClimbing(token) ) return [];
  const scene = token.parent;
  const grid = scene.grid;
  const pos = committedPosition(token);
  const feet = pos.elevation ?? 0;
  if ( feet > groundUnder(token, pos) + 1e-6 ) return [];   // en l'air : rien sous les pieds d'où partir
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * grid.distance;
  const own = pos.level ?? token._source.level;
  const out = [];
  for ( const { di, dj, dir } of LEDGE_DIRS ) {
    const at = { ...pos, x: pos.x + (dj * grid.sizeX), y: pos.y + (di * grid.sizeY) };
    // Le sol continue sur son propre niveau (le toit, le plancher se poursuit) : pas un bord.
    const beside = boundsUnder(token, { ...at, level: own, elevation: feet }).ground;
    if ( Number.isFinite(beside) && (beside > feet - grid.distance + 1e-6) ) continue;
    // Accroché : la tête au bord, les pieds une hauteur de créature plus bas, sur le niveau de cette hauteur.
    const hang = feet - height;
    const level = levelAt(scene, hang, own);
    const { ground } = boundsUnder(token, { ...at, level, elevation: hang });
    if ( !Number.isFinite(ground) || (ground > feet - grid.distance + 1e-6) ) continue;   // pas de vide d'au moins une case
    const elevation = Math.max(hang, ground);
    // Depuis une pièce couverte, pas à travers son mur ; depuis un toit à ciel ouvert, par-dessus le garde-fou de son bord.
    if ( Number.isFinite(boundsUnder(token, pos).ceiling) && crossingBlocked(token, pos, at, own, feet + 1) ) continue;
    if ( !wallsNear(token, { ...at, level, elevation }).length ) continue;   // rien où s'agripper
    out.push({ dir, x: at.x, y: at.y, elevation, level, drop: feet - ground });
  }
  return out;
}

