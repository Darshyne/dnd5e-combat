/**
 * Déplacement vu depuis Foundry V14 et dnd5e 6.0 : chemin sur la scène, aperçu, exécution.
 *
 * Vérifié :
 *  - le cœur n'a pas de pathfinder : `Token#findMovementPath` rend la ligne droite arrêtée au
 *    premier mur (client/canvas/placeables/token.mjs:3397). L'A* du moteur (core/pathfind.mjs)
 *    produit les points de passage ; le cœur garde le dernier mot à l'exécution
 *  - murs : `Token#checkCollision(centre d'arrivée, { origin: centre de départ })` (token.mjs:2761),
 *    insensible à l'animation — dans le niveau du token seulement ; pour une case d'un autre niveau,
 *    le lancer de rayon du polygone avec `level` (source-polygon.mjs:187, P2)
 *  - qui bloque, qui ralentit : `TokenLayer5e#isOccupiedGridSpaceBlocking` / `…Difficult`
 *    (dnd5e canvas/layers/tokens.mjs:10 et :62) — allié traversable, ennemi bloquant, tailles,
 *    Agilité halfeline ; jugé par la tranche d'élévation `k` de la case (tokens.mjs:112-133), donc
 *    par niveau si l'on passe le `k` de l'élévation de base du niveau. Le moteur ne refait pas ces règles
 *  - plafond de coût : l'option `maxCost` + `history` de `constrainMovementPath` coupe un chemin
 *    à ce que le tour permet encore, terrain compris (token.mjs:3345)
 *  - aperçu : la règle du token dessine `token._plannedMovement[userId]` (token.mjs:174, :2016),
 *    avec les couleurs de vitesse de dnd5e (canvas/ruler.mjs:82). Champ public mais peu documenté :
 *    risque noté dans SPEC §12
 *  - `TokenDocument#move` ne se résout qu'à la fin du déplacement (documents/token.mjs:667)
 *
 * Niveaux (P2, §14.2) : une case de l'A* porte son `level`. Un escalier ou une échelle est une région
 * à comportement `changeLevel` (client/data/region-behaviors/change-level.mjs) : ses `levels` disent
 * quels niveaux elle relie (vide = tous), sa tranche d'élévation doit contenir l'élévation de base des
 * deux, `movementActions` (`climb` pour une échelle) dit le multiplicateur de coût. On n'ENTRE jamais
 * dans un escalier en marchant : le comportement du cœur ouvre son dialogue à l'entrée de sa région
 * (événement émis en cours de déplacement, vu en jeu le 2026-09-23 : déplacement mis en pause). Le
 * tronçon s'arrête sur une case voisine, et un seul pas `displace` — avec `level` et `elevation` = base
 * du niveau d'arrivée — pose le token sur l'escalier de l'autre niveau : un `displace` ne déclenche pas
 * le dialogue (change-level.mjs:62) et un segment de téléportation n'est pas contraint par les murs
 * (placeables/token.mjs, constrainMovementPath : « unless teleporting »). Le cœur ne retient pas le
 * coût d'un `displace` : la case et la hauteur franchies sont comptées par le moteur (budget `climbed`,
 * adapter/turn.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { findPath, corners, cellDistance } from "../core/pathfind.mjs";
import { approach, pushDirection, footprintGap } from "../core/movement.mjs";
import { convertLength } from "../core/units.mjs";
import { committedPosition, combatantFor, readBudget, writeBudget } from "./turn.mjs";
import { isIntangible } from "./pilot.mjs";
import { hasLineOfSight } from "./vision.mjs";
import { placementOf, coherentElevation, groundStepAllowed } from "../core/altitude.mjs";
import { groundAt, ceilingAt, clearanceOf, effectiveMode } from "./altitude.mjs";

const key = c => `${c.i},${c.j}`;

/** Taille d'un token en cases entières. */
export function sizeOf(token) {
  return { w: Math.max(1, Math.ceil(token._source.width ?? 1)), h: Math.max(1, Math.ceil(token._source.height ?? 1)) };
}

/** Case du coin haut-gauche d'un token, à sa position validée (ou à `pos`). */
export function cellOf(token, pos=committedPosition(token)) {
  const grid = token.parent.grid;
  return grid.getOffset({ x: pos.x + (grid.sizeX / 2), y: pos.y + (grid.sizeY / 2) });
}

/** Emprise d'un token, en cases. */
export function footprintOf(token) {
  return { ...cellOf(token), ...sizeOf(token) };
}

/** La case sous un point de la scène, pour y poser le coin haut-gauche d'un token de cette taille. */
export function cellUnder(token, point) {
  const grid = token.parent.grid;
  const { w, h } = sizeOf(token);
  // Un grand token se centre sur le point visé.
  return grid.getOffset({ x: point.x - (((w - 1) * grid.sizeX) / 2), y: point.y - (((h - 1) * grid.sizeY) / 2) });
}

/**
 * §18.27 : la règle du cœur (cases colorées selon la vitesse, dnd5e canvas/ruler.mjs) ne s'affiche pendant un déplacement du
 * moteur qu'en combat ; hors combat, le token marche sans.
 */
export const rulerShown = () => game.combat?.started === true;

const isDefeated = token => token.actor?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) === true;

/* -------------------------------------------- */
/*  Niveaux                                     */
/* -------------------------------------------- */

/** Un niveau de la scène : élévation de base et rang `k` de sa case verticale. null si inconnu. */
function levelInfo(scene, id) {
  const level = scene.levels?.get?.(id);
  if ( !level ) return null;
  const base = level.elevation.base;
  return { id, level, base, k: Math.floor((base / scene.grid.distance) + 1e-8) };
}

/** Une tranche d'élévation de région (préparée, ±Infinity) contient-elle cette élévation ? */
const inRange = (region, elevation) => (elevation >= region.elevation.bottom) && (elevation <= region.elevation.top);

/** Les actions de déplacement qui coûtent le double sans la vitesse correspondante (règles 2024 : escalade, nage, ramper). */
const DOUBLED_ACTIONS = { climb: "climb", swim: "swim", crawl: null };

/**
 * Ce que coûte une action de déplacement, en multiple de la distance. dnd5e 6 remplace la table
 * du cœur (`CONFIG.Token.movement.actions`) par la sienne, sans `costMultiplier` mais avec un
 * `getCostFunction` : on ne l'appelle pas, on applique la règle — escalade, nage, ramper coûtent le
 * double, sauf avec la vitesse correspondante sur la fiche.
 */
function actionMultiplier(action, actor) {
  const config = CONFIG.Token.movement.actions[action];
  if ( Number.isFinite(config?.costMultiplier) ) return config.costMultiplier;
  if ( !(action in DOUBLED_ACTIONS) ) return 1;
  const speed = DOUBLED_ACTIONS[action];
  return (speed && ((actor?.system?.attributes?.movement?.speeds?.[speed] ?? actor?.system?.attributes?.movement?.[speed] ?? 0) > 0)) ? 1 : 2;
}

/**
 * Les escaliers et échelles de la scène : régions à comportement `changeLevel` actif, les niveaux
 * qu'elles relient et le multiplicateur de coût de leur action (échelle : `climb`, ×2 sans vitesse
 * d'escalade ; plusieurs actions permises : la moins chère).
 * @param {Scene} scene
 * @param {Actor|null} [actor]  Celui qui se déplace, pour ses vitesses.
 * @returns {{region: RegionDocument, levels: string[], multiplier: number}[]}
 */
export function stairsOf(scene, actor=null) {
  const out = [];
  for ( const region of scene.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( (behavior.type !== "changeLevel") || behavior.disabled ) continue;
      const levels = region.levels.size ? [...region.levels] : scene.levels.map(l => l.id);
      const actions = [...(behavior.system.movementActions ?? [])];
      out.push({ region, levels, multiplier: actions.length ? Math.min(...actions.map(a => actionMultiplier(a, actor))) : 1 });
    }
  }
  return out;
}

/**
 * §41.2 : où mène l'escalier (l'échelle, l'ascenseur) sous ce point, pour ce token — les niveaux que relie une région
 * `changeLevel` qui contient le point, autres que le sien, du plus bas au plus haut. Vide : pas un escalier pour lui (autre
 * niveau affiché, région hors de sa tranche d'élévation, grille sans cases). Même lecture que l'A* (`stairsAt`, `transitions`).
 * @param {TokenDocument} token
 * @param {{x: number, y: number}} point  Point de la scène (la souris).
 * @returns {{id: string, name: string, direction: "up"|"down"|"level"}[]}
 */
export function stairsDestinations(token, point) {
  const scene = token.parent;
  const from = token._source.level;
  const here = levelInfo(scene, from);
  if ( !here || scene.grid.isGridless || !scene.grid.isSquare || ((canvas.level?.id ?? from) !== from) ) return [];
  const found = new Map();
  for ( const s of stairsOf(scene, token.actor) ) {
    if ( !s.levels.includes(from) || !inRange(s.region, here.base) || !s.region.polygonTree.testPoint(point, 0) ) continue;
    for ( const id of s.levels ) {
      const info = (id === from) ? null : levelInfo(scene, id);
      if ( !info || !inRange(s.region, info.base) || found.has(id) ) continue;
      found.set(id, { id, name: info.level.name, base: info.base,
        direction: (info.base > here.base) ? "up" : (info.base < here.base) ? "down" : "level" });
    }
  }
  return [...found.values()].sort((a, b) => a.base - b.base).map(({ id, name, direction }) => ({ id, name, direction }));
}

/**
 * §17.2 : les régions de terrain difficile de dnd5e (`dnd5e.difficultTerrain`) qui ralentissent ce token — même tri que
 * le comportement (data/region-behavior/difficult-terrain.mjs, `_getTerrainEffects` : dispositions ignorées, terrain
 * ignoré par l'acteur, magique ou non). Le coût réel reste mesuré par le cœur ; ceci ne sert qu'à faire contourner.
 */
function difficultRegionsFor(token) {
  const ignored = token.actor?.system?.attributes?.movement?.ignoredDifficultTerrain ?? new Set();
  if ( ignored.has?.("all") ) return [];
  const out = [];
  for ( const region of token.parent.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( (behavior.type !== "dnd5e.difficultTerrain") || behavior.disabled ) continue;
      const s = behavior.system;
      if ( s.ignoredDispositions?.has?.(token.disposition) ) continue;
      if ( s.types?.size && ![...s.types].some(t => !ignored.has?.(t)) ) continue;
      if ( (ignored.has?.("magical") && s.magical) || (ignored.has?.("nonmagical") && !s.magical) ) continue;
      out.push(region);
      break;
    }
  }
  return out;
}

/**
 * Le monde tel que l'A* le voit, pour un token donné. Les réponses sont mises en cache : le monde
 * ne vit que le temps d'une recherche.
 */
const SEARCH_RADIUS = 80;   // cases : au-delà, on ne cherche pas

/**
 * §18.25 : une porte que le chemin peut franchir en l'ouvrant — fermée, non verrouillée, et pour un joueur ni secrète (il
 * ne la voit pas) ni hors de son droit « WALL_DOORS » ou en pause (door-control.mjs, `_onMouseDown`). Le mur (placeable) ou
 * son document : en V14 l'arête d'un mur porte le DOCUMENT (`Edge#object`, client/documents/wall.mjs:164-166).
 */
export function passableDoor(wall) {
  const doc = wall?.document ?? wall;
  if ( !doc?.isDoor || (doc.ds !== CONST.WALL_DOOR_STATES.CLOSED) ) return false;
  if ( game.user.isGM ) return true;
  return (doc.door !== CONST.WALL_DOOR_TYPES.SECRET) && game.user.can("WALL_DOORS") && !game.paused;
}

function worldFor(token, { throughDoors=false }={}) {
  const scene = token.parent;
  const grid = scene.grid;
  const object = token.object;
  const { w, h } = sizeOf(token);
  const rect = canvas.dimensions.sceneRect;
  const ownLevel = token._source.level;
  const ownElevation = token._source.elevation ?? 0;
  const ownK = Math.floor((ownElevation / grid.distance) + 1e-8);
  const depth = committedPosition(token).depth ?? 1;
  const preview = !game.user.isGM;
  const start = cellOf(token);
  const levels = new Map();
  const infoOf = id => {
    if ( !levels.has(id) ) levels.set(id, levelInfo(scene, id));
    return levels.get(id);
  };
  const isOwn = cell => (cell.level ?? ownLevel) === ownLevel;
  const kOf = cell => isOwn(cell) ? ownK : (infoOf(cell.level)?.k ?? ownK);
  const elevationOf = cell => isOwn(cell) ? ownElevation : (infoOf(cell.level)?.base ?? ownElevation);

  const center = cell => {
    const tl = grid.getTopLeftPoint(cell);
    return { x: tl.x + ((w * grid.sizeX) / 2), y: tl.y + ((h * grid.sizeY) / 2) };
  };
  const cellsOf = cell => {
    const out = [];
    for ( let di = 0; di < h; di++ ) for ( let dj = 0; dj < w; dj++ ) out.push({ i: cell.i + di, j: cell.j + dj });
    return out;
  };

  // Cases où l'on ne peut pas finir : celles de tout autre token visible et debout, sur son niveau. Un objet qui
  // n'occupe pas son espace (Main de Bigby, §16.15) ne gêne personne et n'est gêné par personne.
  const intangible = isIntangible(token);
  const taken = new Set();
  for ( const other of scene.tokens ) {
    if ( intangible ) break;
    if ( (other === token) || other.hidden || isDefeated(other) || isIntangible(other) ) continue;
    if ( preview && other.object && !other.object.visible ) continue;   // ne pas révéler un token invisible
    const o = footprintOf(other);
    for ( let di = 0; di < o.h; di++ ) for ( let dj = 0; dj < o.w; dj++ ) taken.add(`${key({ i: o.i + di, j: o.j + dj })}@${other._source.level}`);
  }

  const layer = canvas.tokens;
  const backend = CONFIG.Canvas.polygonBackends.move;
  const blockedCache = new Map();
  const blocked = cell => {
    if ( intangible ) return false;
    const id = `${key(cell)}@${cell.level ?? ownLevel}`;
    if ( !blockedCache.has(id) ) {
      const k = kOf(cell);
      blockedCache.set(id, cellsOf(cell).some(c => layer.isOccupiedGridSpaceBlocking?.({ ...c, k }, object, { preview }) === true));
    }
    return blockedCache.get(id);
  };
  // §41.3 : le test de collision d'un token lit les murs du niveau AFFICHÉ (`config.level ??= canvas.level`,
  // geometry/shapes/source-polygon.mjs:187). Un token qui marche sur un niveau que ce client ne regarde pas — le suiveur
  // resté en bas quand la vue du MJ a suivi le meneur à l'étage — est donc jugé sur les murs de son niveau à lui, par le
  // polygone de ce niveau, comme une case d'un autre niveau ; sans ouvrir de porte (le test de porte est celui du token).
  const ownViewed = (canvas.level?.id ?? ownLevel) === ownLevel;
  /** Un mur entre deux cases voisines ? Dans le niveau du token par le test du token ; ailleurs par le polygone du niveau. */
  const wallBetween = (from, to) => {
    const c = center(to);
    if ( isOwn(to) && ownViewed ) {
      if ( !object.checkCollision(c, { origin: center(from), type: "move", mode: "any" }) ) return false;
      return !(throughDoors && doorBetween(from, to));
    }
    const info = infoOf(to.level ?? ownLevel);
    if ( !info ) return true;
    const eye = elevationOf(to) + ((depth * grid.distance) / 2);
    const o = center(from);
    return backend.testCollision({ x: o.x, y: o.y, elevation: eye }, { x: c.x, y: c.y, elevation: eye }, { type: "move", mode: "any", level: info.level }) === true;
  };

  /**
   * §18.25 : la porte fermée qu'un pas franchit, si c'est tout ce qui l'arrête (dans le niveau du token), sinon null. Les
   * points de collision du cœur (mode « all », clockwise-sweep.mjs `_testCollision`) portent les arêtes qui les font, et
   * une arête de mur porte son mur (`Edge#object`).
   */
  const doorCache = new Map();
  const doorBetween = (from, to) => {
    const id = `${key(from)}>${key(to)}`;
    if ( !doorCache.has(id) ) {
      let door = null;
      const hits = object.checkCollision(center(to), { origin: center(from), type: "move", mode: "all" }) ?? [];
      for ( const hit of hits ) {
        for ( const edge of hit.edges ?? [] ) {
          if ( !passableDoor(edge.object) ) { door = null; break; }
          door = edge.object?.document ?? edge.object;   // le WallDocument
        }
        if ( !door ) break;
      }
      doorCache.set(id, door);
    }
    return doorCache.get(id);
  };

  // Escaliers et échelles. Le comportement `changeLevel` du cœur ouvre son dialogue dès qu'un token ENTRE
  // dans sa région en marchant (événement d'entrée, émis en cours de déplacement, change-level.mjs:57) :
  // on n'y entre donc jamais en marchant. Le tronçon s'arrête sur une case voisine, et un seul pas de
  // téléportation (`displace`, qui ne déclenche rien, change-level.mjs:62) pose le token sur l'escalier,
  // déjà sur l'autre niveau. Ce pas coûte la case franchie plus la hauteur (multipliée pour une échelle).
  const stairs = stairsOf(scene, token.actor);
  const stairsCache = new Map();
  /** Les escaliers qui contiennent cette case, sur son niveau. */
  const stairsAt = cell => {
    const id = `${key(cell)}@${cell.level ?? ownLevel}`;
    if ( !stairsCache.has(id) ) {
      const from = cell.level ?? ownLevel;
      const base = elevationOf(cell);
      const c = center(cell);
      stairsCache.set(id, stairs.filter(s => s.levels.includes(from) && inRange(s.region, base) && s.region.polygonTree.testPoint(c, 0.75)));
    }
    return stairsCache.get(id);
  };
  const inStairs = cell => stairsAt(cell).length > 0;

  // §17.4 : le mode dit l'élévation de chaque point — au sol, le sol de la case ; en vol, 5 ft au-dessus au moins ; en
  // fouissement, 5 ft dessous au moins. Au sol, une marche de 5 ft au plus : l'A* ne fait ni grimper ni sauter dans le vide.
  const mode = effectiveMode(token);
  const placement = placementOf(mode);
  const clearance = clearanceOf(scene);
  const groundCache = new Map();
  const groundOf = cell => {
    const id = `${key(cell)}@${cell.level ?? ownLevel}`;
    if ( !groundCache.has(id) ) groundCache.set(id, groundAt(scene, cell.level ?? ownLevel, center(cell)));
    return groundCache.get(id);
  };
  // En vol, les pieds sous le plafond du niveau, tête comprise.
  const pointsOf = cell => {
    try { return [center(cell), ...token.getContainmentTestPoints({ ...token._source, ...grid.getTopLeftPoint(cell) })]; }
    catch { return [center(cell)]; }
  };
  const ceilingOf = cell => ceilingAt(scene, pointsOf(cell), groundOf(cell)) - (depth * grid.distance);
  const altitude = cell => placement
    ? { elevation: coherentElevation(mode, elevationOf(cell), groundOf(cell), clearance, (placement === "air") ? ceilingOf(cell) : Infinity), action: mode } : {};
  const difficult = difficultRegionsFor(token);
  const difficultCache = new Map();
  const difficultAt = cell => {
    if ( !difficult.length ) return false;
    const id = `${key(cell)}@${cell.level ?? ownLevel}`;
    if ( !difficultCache.has(id) ) {
      const base = elevationOf(cell);
      const c = center(cell);
      difficultCache.set(id, difficult.some(r => inRange(r, base) && r.polygonTree.testPoint(c, 0.75)));
    }
    return difficultCache.get(id);
  };
  const transitions = cell => {
    if ( !stairs.length ) return [];
    const from = cell.level ?? ownLevel;
    const base = elevationOf(cell);
    const out = [];
    // Depuis la case elle-même (on se tient déjà sur l'escalier) ou depuis une voisine.
    const candidates = [{ cell, horizontal: 0 }];
    for ( const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] ) {
      candidates.push({ cell: { i: cell.i + di, j: cell.j + dj, level: from }, horizontal: (di && dj) ? 1.001 : 1 });
    }
    for ( const { cell: n, horizontal } of candidates ) {
      const here = stairsAt(n);
      if ( !here.length ) continue;
      if ( horizontal && (blocked(n) || wallBetween(cell, n)) ) continue;
      for ( const s of here ) for ( const id of s.levels ) {
        if ( id === from ) continue;
        const info = infoOf(id);
        if ( !info || !inRange(s.region, info.base) ) continue;
        const next = { i: n.i, j: n.j, level: id };
        if ( blocked(next) ) continue;
        out.push({ cell: next, cost: horizontal + ((Math.abs(info.base - base) / grid.distance) * s.multiplier) });
      }
    }
    return out;
  };

  return {
    ownLevel,
    intangible,
    canStep(from, to) {
      const c = center(to);
      if ( !rect.contains(c.x, c.y) || (cellDistance(start, to) > SEARCH_RADIUS) || blocked(to) ) return false;
      if ( inStairs(to) && !inStairs(from) ) return false;   // on n'entre pas dans un escalier en marchant (voir ci-dessus)
      if ( (placement === "ground") && ((from.level ?? ownLevel) === (to.level ?? ownLevel)) && !groundStepAllowed(groundOf(from), groundOf(to), clearance) ) return false;
      return !wallBetween(from, to);
    },
    canEnd: cell => !cellsOf(cell).some(c => taken.has(`${key(c)}@${cell.level ?? ownLevel}`)),
    // Terrain difficile : cases occupées (dnd5e) et régions ; les deux ne se cumulent pas (canvas/token.mjs:73).
    inStairs: cell => inStairs(cell),
    /** Un pas de `from` à sa voisine `to` sans mur entre les deux (dans le niveau de `to`). */
    wallFree: (from, to) => !wallBetween(from, to),
    doorBetween: (from, to) => (throughDoors && isOwn(to) && ownViewed ? doorBetween(from, to) : null),
    // Une porte à ouvrir coûte une case de plus à l'A* : on ne la préfère qu'au détour qu'elle évite.
    stepCost: (from, to) => (throughDoors && isOwn(to) && ownViewed && doorBetween(from, to) ? 1 : 0) + ((difficultAt(to) || cellsOf(to).some(c => layer.isOccupiedGridSpaceDifficult?.({ ...c, k: kOf(to) }, object, { preview }))) ? 2 : 1),
    transitions,
    waypoint: cell => ({ ...grid.getTopLeftPoint(cell), snapped: true, ...altitude(cell) }),
    /** Le pas qui change de niveau : `displace` sur la case d'escalier `cell` du niveau `cell.level`, à sa base. */
    change: (cell, cost) => {
      const info = infoOf(cell.level);
      // Sans le soupçon de la diagonale (0,001, core/pathfind.mjs) : un coût entier de cases, en unités de la grille.
      return { ...grid.getTopLeftPoint(cell), snapped: true, elevation: info.base, level: cell.level, action: "displace", climb: Math.round(cost) * grid.distance };
    },
    /** Coût (en cases) de la transition de `from` vers la case d'escalier `to` d'un autre niveau. */
    climbCost: (from, to) => (transitions(from).find(t => (t.cell.i === to.i) && (t.cell.j === to.j) && (t.cell.level === to.level))?.cost ?? 0)
  };
}

/** Cases d'un même escalier qu'on explore au plus, autour de la case cliquée. */
const MAX_STAIRS_CELLS = 64;

/**
 * §18.26 : la case cliquée est-elle un escalier ou une échelle du niveau du token (et du niveau affiché) ? Alors on y va
 * EN MARCHANT pour que le cœur ouvre son dialogue de changement de niveau : l'A* va jusqu'à une case voisine hors de
 * l'escalier (`around`), puis un dernier pas entre dans la case d'escalier qui la touche (`entries`, par case voisine).
 * L'escalier se prend par N'IMPORTE laquelle de ses cases (celles qui touchent la case cliquée, de proche en proche), et
 * seulement sans mur entre la voisine et lui (vu le 2026-09-27 par le scénario `escaliers` sur Restored Keep : l'escalier
 * Est est muré sauf d'un côté, et sa première case n'a aucune voisine ouverte). null : pas un escalier, le token s'y tient
 * déjà, ou aucune entrée.
 */
export function stairsEntry(token, cell) {
  const grid = token.parent.grid;
  if ( !token.object || grid.isGridless || !grid.isSquare ) return null;
  const world = worldFor(token);
  const level = world.ownLevel;
  if ( (canvas.level?.id ?? level) !== level ) return null;
  if ( !world.inStairs({ ...cell, level }) || world.inStairs({ ...cellOf(token), level }) ) return null;
  const steps = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  // Les cases de l'escalier, de proche en proche depuis la case cliquée.
  const stairs = new Map([[key(cell), { i: cell.i, j: cell.j, level }]]);
  const queue = [stairs.get(key(cell))];
  while ( queue.length && (stairs.size < MAX_STAIRS_CELLS) ) {
    const here = queue.shift();
    for ( const [di, dj] of steps ) {
      const next = { i: here.i + di, j: here.j + dj, level };
      if ( stairs.has(key(next)) || !world.inStairs(next) ) continue;
      stairs.set(key(next), next);
      queue.push(next);
    }
  }
  const around = [];
  const entries = new Map();
  for ( const inside of stairs.values() ) {
    for ( const [di, dj] of steps ) {
      const next = { i: inside.i + di, j: inside.j + dj, level };
      if ( stairs.has(key(next)) || world.inStairs(next) || entries.has(key(next)) || !world.wallFree(next, inside) ) continue;
      around.push(next);
      entries.set(key(next), { i: inside.i, j: inside.j });
    }
  }
  return around.length ? { level, around, entries } : null;
}

/* -------------------------------------------- */
/*  Chemin                                      */
/* -------------------------------------------- */

/** Coût d'un chemin mesuré par le cœur (terrain, diagonales), départ compris dans la liste. */
function costOf(object, path, preview) {
  const measurement = object.measureMovementPath(path, { preview });
  let total = 0;
  for ( let n = 1; n < measurement.waypoints.length; n++ ) total += measurement.waypoints[n].backward?.cost ?? 0;
  return total;
}

/**
 * Découpe un chemin de cases (avec niveau) en tronçons d'un seul niveau : `[{ cells, change }]`,
 * `change` = niveau d'arrivée du changement qui clôt le tronçon, ou null pour le dernier.
 */
export function legsOf(cells) {
  const legs = [];
  let current = [cells[0]];
  for ( let n = 1; n < cells.length; n++ ) {
    if ( cells[n].level !== cells[n - 1].level ) {
      legs.push({ cells: current, change: cells[n].level });
      current = [cells[n]];
    }
    else current.push(cells[n]);
  }
  legs.push({ cells: current, change: null });
  return legs;
}

/**
 * Cherche un chemin. `to` : soit une case d'arrivée (sur le niveau affiché, ou `to.level`), soit une
 * cible à approcher (sur son niveau). Les escaliers relient les niveaux (voir en tête de fichier).
 * @param {TokenDocument} token
 * @param {{cell?: {i,j}, cells?: {i,j}[], level?: string, target?: TokenDocument, reachCells?: number, seeing?: boolean}} to
 * @param {{maxCost?: number, throughDoors?: boolean}} [options]  Plafond de coût du tour (historique compris), unité de la
 *   grille ; §18.25 : `throughDoors`, le chemin peut franchir une porte fermée (`passableDoor`) — il s'arrête alors devant
 *   la première, et `door` dit laquelle ouvrir avant de replanifier.
 * @returns {{waypoints: object[], beyond: object[], arrives: boolean, door?: WallDocument}|null}
 *   `waypoints` : ce qu'on peut parcourir (les changements de niveau sont des points `displace` avec
 *   `level`) ; `beyond` : la suite du chemin, hors budget ; null : aucun chemin.
 */
export function planPath(token, to, { maxCost=Infinity, throughDoors=false }={}) {
  if ( !token.object || token.parent.grid.isGridless || !token.parent.grid.isSquare ) return null;
  const world = worldFor(token, { throughDoors });
  const start = { ...cellOf(token), level: world.ownLevel };
  let goal;
  if ( to.target ) {
    const targetLevel = to.target._source.level;
    const near = approach(footprintOf(to.target), sizeOf(token), Math.max(1, to.reachCells ?? 1));
    goal = { isGoal: cell => ((cell.level ?? world.ownLevel) === targetLevel) && near.isGoal(cell), heuristic: near.heuristic };
    // P1 : ne s'approcher à distance que jusqu'à une case d'où l'on VOIT la cible (ligne de vue, murs `sight`, surfaces).
    if ( to.seeing ) {
      const grid = token.parent.grid;
      const { w, h } = sizeOf(token);
      const elevation = committedPosition(token).elevation;
      const within = goal.isGoal;
      goal.isGoal = cell => {
        if ( !within(cell) ) return false;
        const topLeft = grid.getTopLeftPoint(cell);
        const level = token.parent.levels?.get?.(cell.level ?? world.ownLevel);   // P2 : les murs de ce niveau-là
        return hasLineOfSight({ x: topLeft.x + (w * grid.sizeX) / 2, y: topLeft.y + (h * grid.sizeY) / 2, elevation }, to.target, level);
      };
    }
  }
  else {
    // §18.24 : plusieurs cases d'arrivée acceptables (`to.cells`, les cases au contact d'une porte), la plus proche gagne.
    const level = to.level ?? canvas.level?.id ?? world.ownLevel;
    goal = { goals: (to.cells ?? [to.cell]).map(({ i, j }) => ({ i, j, level })) };
  }
  const found = findPath({ start, ...goal, canStep: world.canStep, canEnd: world.canEnd, stepCost: world.stepCost, transitions: world.transitions });
  if ( !found ) return null;
  let cells = found.path;
  // §18.25 : le chemin passe une porte fermée — on s'arrête devant la première.
  let door = null;
  for ( let n = 1; n < cells.length; n++ ) {
    door = world.doorBetween(cells[n - 1], cells[n]);
    if ( door ) { cells = cells.slice(0, n); break; }
  }
  const withDoor = plan => (door ? { ...plan, door } : plan);
  if ( cells.length === 1 ) return withDoor({ waypoints: [], beyond: [], arrives: true });

  // Tronçon par tronçon : le cœur mesure le vrai coût (diagonales, terrain des régions) et coupe au
  // budget ; la hauteur d'un escalier se paie entre deux tronçons.
  const object = token.object;
  const preview = !game.user.isGM;
  // Les virages seuls, mais chacun porte les cases alignées avant lui où l'on peut s'arrêter (`stops`), et `through` s'il
  // est lui-même sur une case prise : la marche s'interrompt case par case (`walk`), jamais chez un autre.
  const toWaypoints = list => {
    const kept = new Set(corners(list));
    const out = [];
    let stops = [];
    for ( const cell of list.slice(1) ) {
      const free = world.canEnd(cell);
      if ( !kept.has(cell) ) { if ( free ) stops.push(world.waypoint(cell)); continue; }
      out.push({ ...world.waypoint(cell), ...(stops.length ? { stops } : {}), ...(free ? {} : { through: true }) });
      stops = [];
    }
    return out;
  };
  const waypoints = [];
  const beyond = [];
  let remaining = maxCost;
  let origin = { ...committedPosition(token) };
  let cut = false;
  const legs = legsOf(cells);
  for ( const [index, leg] of legs.entries() ) {
    const full = [origin, ...leg.cells.slice(1).map(world.waypoint)];
    let kept = cut ? 1 : full.length;   // après la coupe, tout le reste est hors budget
    if ( !cut && Number.isFinite(remaining) && (full.length > 1) ) {
      const terrain = object.createTerrainMovementPath(full, { preview });
      const [path] = object.constrainMovementPath(terrain, { maxCost: remaining, history: true, preview, ...(world.intangible ? { ignoreTokens: true } : {}) });
      // Le cœur ajoute des points de terrain : on recompte NOS cases atteintes, par position.
      const reached = new Set(path.map(p => `${Math.round(p.x)},${Math.round(p.y)}`));
      kept = 1;
      while ( (kept < full.length) && reached.has(`${Math.round(full[kept].x)},${Math.round(full[kept].y)}`) ) kept++;
      // On ne s'arrête pas sur une case prise : reculer jusqu'à une case libre.
      while ( (kept > 1) && (kept < full.length) && !world.canEnd(leg.cells[kept - 1]) ) kept--;
      if ( kept < full.length ) cut = true;
      else remaining -= costOf(object, full, preview);
    }
    if ( cut ) {
      if ( kept > 1 ) waypoints.push(...toWaypoints(leg.cells.slice(0, kept)));
      beyond.push(...leg.cells.slice(kept).map(world.waypoint));
    }
    else waypoints.push(...toWaypoints(leg.cells));
    if ( leg.change ) {
      // Le pas de téléportation : de la dernière case du tronçon (à côté de l'escalier) à la première du
      // suivant (l'escalier, sur l'autre niveau).
      const last = leg.cells.at(-1);
      const next = legs[index + 1].cells[0];
      // `climbCost` est en cases, le budget en unités de la grille : on compare la hauteur du pas, déjà convertie (vu le
      // 2026-09-27 par le scénario `escaliers` : un escalier de 25 ft passait avec 24 ft de budget, et n'en retirait que 5).
      const change = world.change(next, world.climbCost(last, next));
      const climb = change.climb;
      if ( !cut && Number.isFinite(remaining) && (remaining - climb < -1e-6) ) cut = true;   // l'escalier n'est plus dans le budget
      if ( cut ) beyond.push(change);
      else { waypoints.push(change); remaining -= climb; }
      origin = { ...committedPosition(token), x: change.x, y: change.y, elevation: change.elevation, level: change.level };
    }
  }
  return withDoor({ waypoints, beyond, arrives: !cut });
}

/* -------------------------------------------- */
/*  Aperçu                                      */
/* -------------------------------------------- */

/** Dessine le chemin prévu avec la règle native du token. `plan` null : efface. */
export function previewPath(token, plan) {
  const object = token.object;
  if ( !object ) return;
  const mine = game.user.id;
  if ( !plan || !(plan.waypoints.length || plan.beyond.length) ) {
    if ( !(mine in object._plannedMovement) ) return;
    delete object._plannedMovement[mine];
    object.renderFlags.set({ refreshRuler: true, refreshState: true });
    return;
  }
  const preview = true;
  const origin = { ...committedPosition(token) };
  const clean = list => list.map(({ climb, stops, through, ...w }) => w);
  const complete = list => token.getCompleteMovementPath(object.createTerrainMovementPath(list, { preview }));
  const foundPath = complete([origin, ...clean(plan.waypoints)]);
  const unreachableWaypoints = plan.beyond.length ? complete([foundPath.at(-1), ...clean(plan.beyond)]).slice(1) : [];
  const history = token.movementHistory;
  const combined = [...history, ...foundPath, ...unreachableWaypoints];
  const measurement = object.measureMovementPath(combined, { preview });
  for ( let n = history.length; n < combined.length; n++ ) combined[n].cost = measurement.waypoints[n].backward?.cost ?? 0;
  Object.assign(foundPath[0], { terrain: null, snapped: false, explicit: false, checkpoint: true, cost: 0,
    action: history.at(-1)?.action ?? foundPath[0].action });
  object._plannedMovement[mine] = { foundPath, unreachableWaypoints, history, hidden: true, searching: false };
  object.renderFlags.set({ refreshRuler: true, refreshState: true });
}

/* -------------------------------------------- */
/*  Exécution                                   */
/* -------------------------------------------- */

/** Les tronçons d'un plan : chaque changement de niveau (`displace` avec `level`) clôt un `move`. */
function movesOf(waypoints) {
  const moves = [];
  let current = [];
  for ( const w of waypoints ) {
    current.push(w);
    if ( (w.action === "displace") && w.level ) { moves.push(current); current = []; }
  }
  if ( current.length ) moves.push(current);
  return moves;
}

/** Note la hauteur franchie dans le budget du tour (le cœur ne retient pas le coût d'un `displace`). */
async function chargeClimb(token, climb) {
  if ( !(climb > 0) ) return;
  const combatant = combatantFor(token.actor);
  if ( !combatant ) return;
  const budget = readBudget(combatant);
  await writeBudget(combatant, { ...budget, climbed: (Number(budget.climbed) || 0) + climb });
}

/**
 * Les points d'un tronçon pour le cœur : chaque case où l'on peut s'arrêter (`stops`, et les virages qui ne sont pas `through`,
 * voir `planPath`) devient un point de contrôle (`checkpoint`). Le cœur coupe le déplacement au premier (`#splitMovementPath`,
 * documents/token.mjs:2566), anime ce morceau et enchaîne seul le suivant un peu avant la fin de l'animation (déplacement
 * « pending », canvas/placeables/token.mjs:4331) ; `stopMovement` coupe ce qui reste. Les cases intermédiaires ne sont pas
 * explicites : la règle ne les marque pas comme des étapes.
 */
function checkpointed(move) {
  const out = [];
  for ( const [index, { climb, stops, through, ...w }] of move.entries() ) {
    for ( const stop of stops ?? [] ) out.push({ ...stop, ...(w.action ? { action: w.action } : {}), explicit: false, checkpoint: true });
    out.push((through || (index === move.length - 1)) ? w : { ...w, checkpoint: true });
  }
  return out;
}

/**
 * Les marches en cours sur ce client, par token (SPEC §99) : un nouveau clic ailleurs ou la pause les arrêtent, et les
 * morceaux que le cœur enchaîne gardent les options du moteur (`continuedFlags`).
 * @type {Map<TokenDocument, {stopped: boolean, flags: object}>}
 */
const walks = new Map();

export const isWalking = token => walks.has(token);

/**
 * Arrête la marche de ce token au prochain point de contrôle (la case libre où l'animation en cours le mène). Rend vrai
 * s'il marchait. Seul le client qui a lancé un déplacement peut l'arrêter (`stopMovement`, documents/token.mjs:762) :
 * c'est celui de la marche.
 */
export function stopWalking(token) {
  const state = walks.get(token);
  if ( !state ) return false;
  state.stopped = true;
  if ( token.movement?.user?.isSelf && ["pending", "paused"].includes(token.movement.state) ) {
    try { token.stopMovement(); }
    catch(err) { console.warn(`${MODULE_ID} | arrêt de la marche de ${token.name}`, err); }
  }
  return true;
}

export function stopAllWalks() {
  for ( const token of Array.from(walks.keys()) ) stopWalking(token);
}

/**
 * Les options du moteur d'un morceau de marche que le cœur enchaîne lui-même : sa mise à jour ne reprend que les options
 * standard (`updateOptions`, documents/token.mjs:1036), pas `[MODULE_ID]` (`cleared`, `follow`…). On les retrouve par la
 * marche en cours quand le déplacement en suit un autre (`chain` non vide). `movement` : celui de `preMoveToken`, ou
 * `options._movement[token.id]` d'un `updateToken`. null hors d'une marche du moteur.
 */
export function continuedFlags(token, movement) {
  if ( !movement?.chain?.length ) return null;
  return walks.get(token)?.flags ?? null;
}

/**
 * Parcourt le chemin et n'aboutit qu'une fois le token arrivé (animation comprise) : les jets
 * viennent après le déplacement. Un changement de niveau clôt un `move` et en ouvre un autre.
 * @returns {Promise<boolean>}  false si le déplacement a été refusé ou interrompu.
 */
export async function walk(token, plan, flags={}) {
  previewPath(token, null);
  if ( !plan.waypoints.length ) return true;
  // Comme le glisser du cœur (canvas/placeables/token.mjs:1106) : un joueur ne bouge pas pendant la pause.
  if ( game.paused && !game.user.isGM ) {
    ui.notifications.warn("GAME.PausedWarning", { localize: true });
    return false;
  }
  stopWalking(token);
  const options = { [MODULE_ID]: { planned: true, ...flags } };
  const state = { stopped: false, flags: options[MODULE_ID] };
  walks.set(token, state);
  try { return await walkMoves(token, plan, options, state); }
  finally { if ( walks.get(token) === state ) walks.delete(token); }
}

async function walkMoves(token, plan, options, state) {
  // §17.4 : le chemin a été planifié dans le mode réel du token (une créature qui vole restée en mode marche) : on le lui donne.
  const mode = effectiveMode(token);
  if ( mode !== token.movementAction ) await token.update({ movementAction: mode }, { [MODULE_ID]: { altitude: true } });
  for ( const move of movesOf(plan.waypoints) ) {
    if ( state.stopped ) return false;
    const change = (move.at(-1).action === "displace") && move.at(-1).level ? move.at(-1) : null;
    const from = token._source.level;
    // §16.15 : un objet qui n'occupe pas son espace (Main de Bigby) traverse les créatures — option `ignoreTokens` que
    // dnd5e lit dans les options de contrainte (canvas/token.mjs:88), passées par le cœur (documents/token.mjs:1723).
    const constrainOptions = isIntangible(token) ? { ignoreTokens: true } : undefined;
    const done = await token.move(checkpointed(move), { showRuler: rulerShown(), ...(constrainOptions ? { constrainOptions } : {}), ...options });
    // Dans un onglet masqué l'animation ne se termine jamais : on n'attend pas indéfiniment. Un pas `displace` qui change de niveau
    // (escalier) n'a rien à attendre : téléporté sur un niveau que la vue n'affiche pas encore, le token ne finit jamais son animation
    // et chaque escalier coûtait les 10 s du filet (vu le 2026-09-29 : 22 à 24 s l'aller-retour du scénario `escaliers`, §38.8).
    // Une marche arrêtée aussi : on attend que le token ait fini d'aller au point de contrôle où le cœur l'a laissé.
    const animation = change && !state.stopped ? null : token.object?.movementAnimationPromise;
    if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, 10000))]);
    if ( state.stopped || (done === false) ) return false;
    if ( change ) {
      if ( token._source.level !== change.level ) return false;   // le cœur n'a pas changé de niveau : on n'insiste pas
      await chargeClimb(token, change.climb);
      // Comme le comportement du cœur (change-level.mjs:110) : la vue d'un MJ suit son token à l'étage.
      if ( game.user.isGM && token.parent.isView && (canvas.level?.id === from) ) {
        await token.parent.view({ level: change.level, controlledTokens: [token.id] });
      }
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  Poussée                                     */
/* -------------------------------------------- */

/**
 * Pousse `target` loin de `source` (Bousculade, SPEC §15.2) : en ligne droite, case par case, tant que
 * rien ne l'arrête — un mur (`canStep`, vu du poussé, dans son niveau), une créature, un escalier ; on ne
 * s'arrête pas sur une case prise (`canEnd`). Un seul pas `displace` : une poussée est subie, elle ne
 * provoque pas d'attaque d'opportunité et ne coûte rien au poussé ; `cleared` la fait passer sans
 * contrôle du moteur (runtime/actions.mjs). MJ actif uniquement.
 * `towards` (Fouet d'épines, « vous l'attirez de 3 m vers vous ») : même chose vers la source, en s'arrêtant
 * devant elle — sa case est prise, `canEnd` le sait.
 * @param {TokenDocument} source
 * @param {TokenDocument} target
 * @param {{distance: number, units: string}} push
 * @param {object} factors  Facteurs de conversion des unités (adapter/units.mjs).
 * @param {{towards?: boolean}} [options]
 * @returns {Promise<{cells: number, wanted: number}>}  Cases parcourues, cases voulues.
 */
export async function pushAway(source, target, { distance, units }, factors, { towards=false, follow=false }={}) {
  const grid = target.parent.grid;
  let value = distance;
  try { value = convertLength(distance, units, grid.units, factors); } catch { /* unité de la grille */ }
  const wanted = Math.max(1, Math.round((value / grid.distance) + 1e-6));
  if ( !target.object || grid.isGridless || !grid.isSquare ) return { cells: 0, wanted };

  const centerOf = doc => {
    const pos = committedPosition(doc);
    const { w, h } = sizeOf(doc);
    return { x: pos.x + ((w * grid.sizeX) / 2), y: pos.y + ((h * grid.sizeY) / 2) };
  };
  const away = pushDirection(centerOf(source), centerOf(target));
  const dir = away && towards ? { di: -away.di, dj: -away.dj } : away;
  if ( !dir ) return { cells: 0, wanted };
  const world = worldFor(target);
  let cell = { ...cellOf(target), level: world.ownLevel };
  let cells = 0;
  for ( ; cells < wanted; cells++ ) {
    const next = { i: cell.i + dir.di, j: cell.j + dir.dj, level: cell.level };
    if ( !world.canStep(cell, next) || !world.canEnd(next) ) break;
    cell = next;
  }
  if ( !cells ) return { cells, wanted };
  const point = grid.getTopLeftPoint(cell);
  await target.move([{ x: point.x, y: point.y, snapped: true, action: "displace" }], { [MODULE_ID]: { cleared: true } });
  // « La main se déplace avec la cible, en restant à 1,50 m d'elle » (Main puissante, §16.15) : même décalage.
  if ( follow && source.object ) {
    const from = committedPosition(source);
    await source.move([{ x: from.x + (cells * dir.dj * grid.sizeX), y: from.y + (cells * dir.di * grid.sizeY), snapped: true, action: "displace" }],
      { ...(isIntangible(source) ? { constrainOptions: { ignoreTokens: true } } : {}), [MODULE_ID]: { cleared: true } });
  }
  return { cells, wanted };
}

/* -------------------------------------------- */
/*  Traîné par un agrippeur                     */
/* -------------------------------------------- */

/**
 * Où poser une victime traînée par son agrippeur (Agrippé, « Déplaçable ») : là où la place relative le
 * voudrait (`desired`, coin haut-gauche) si la case est libre ; sinon la case libre au contact de
 * l'agrippeur la plus proche de ce souhait. Jamais dans une autre créature (`canEnd`). null : nulle part.
 * @param {TokenDocument} victim
 * @param {TokenDocument} grappler   À sa position d'arrivée.
 * @param {{x: number, y: number}} desired
 * @returns {{x: number, y: number}|null}
 */
export function dragDestination(victim, grappler, desired) {
  const grid = victim.parent.grid;
  if ( grid.isGridless || !grid.isSquare ) return null;
  const world = worldFor(victim);
  const level = committedPosition(grappler).level ?? world.ownLevel;
  const want = { ...grid.getOffset({ x: desired.x + (grid.sizeX / 2), y: desired.y + (grid.sizeY / 2) }), level };
  if ( world.canEnd(want) ) return grid.getTopLeftPoint(want);
  const g = footprintOf(grappler);
  const { w, h } = sizeOf(victim);
  const candidates = [];
  for ( let i = g.i - h; i <= g.i + g.h; i++ ) {
    for ( let j = g.j - w; j <= g.j + g.w; j++ ) {
      const cell = { i, j, level };
      if ( footprintGap({ i, j, w, h }, g) !== 1 ) continue;   // au contact (1) : ni dessus (0), ni plus loin
      candidates.push({ cell, d: Math.hypot(i - want.i, j - want.j) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  const free = candidates.find(c => world.canEnd(c.cell));
  return free ? grid.getTopLeftPoint(free.cell) : null;
}
