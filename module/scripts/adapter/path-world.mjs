/**
 * Le monde que voit l'A* du moteur (core/pathfind.mjs) : niveaux et escaliers (régions `changeLevel`), murs et portes, sol et
 * plafond, terrain difficile, régions à éviter. Extrait d'adapter/movement.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { cellDistance } from "../core/pathfind.mjs";
import { committedPosition, positionOf } from "./turn.mjs";
import { overlapsVertically } from "../core/space.mjs";
import { isIntangible } from "./pilot.mjs";
import { sharesSpaceWith } from "./space-sharing.mjs";
import { placementOf, coherentElevation, groundStepAllowed } from "../core/altitude.mjs";
import { groundAt, ceilingAt, clearanceOf, effectiveMode } from "./altitude.mjs";
import { isOnCeiling, isClimbing, wallsNear } from "./climb.mjs";
import { climbSystemOn } from "../core/climb-system.mjs";
import { cellOf, footprintOf, isDefeated, cellKey, sizeOf } from "./movement.mjs";

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
export function difficultRegionsFor(token) {
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
 * §103 : les régions qu'un module demande à l'A* d'éviter (`flags.dnd5e-combat.avoid`, Darsh Loot : un piège repéré) —
 * franchissables, mais à un coût tel que le chemin les contourne s'il le peut ; une destination dedans reste possible.
 */
const AVOID_COST = 20;
function avoidRegionsFor(token) {
  return token.parent.regions.filter(r => r.getFlag(MODULE_ID, "avoid") === true);
}

/**
 * Le monde tel que l'A* le voit, pour un token donné. Les réponses sont mises en cache : le monde
 * ne vit que le temps d'une recherche.
 */
const SEARCH_RADIUS = 80;   // cases : au-delà, on ne cherche pas
// §209 : au mur, le chemin reste près du départ — hors combat rien ne le bornait, et l'A* d'un grimpeur faisait le tour d'un bâtiment le
// long de ses murs (vu à Restored Keep : une cinquantaine de cases, porte comprise, pour une case voisine de l'autre côté du mur).
const CLIMB_RADIUS = 12;

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

export function worldFor(token, { throughDoors=false }={}) {
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

  // Cases où l'on ne peut pas finir : celles de tout autre token visible et debout, sur son niveau, sauf celles qu'on peut
  // partager (§105 : Forme d'air, Nuée — adapter/space-sharing.mjs). Un objet qui n'occupe pas son espace (Main de
  // Bigby, §16.15) ne gêne personne et n'est gêné par personne. §192 : par case, les tranches verticales (pieds-tête) des
  // tokens qui l'occupent — un grimpeur au-dessus d'une case occupée peut s'y arrêter.
  const intangible = isIntangible(token);
  const taken = new Map();
  for ( const other of scene.tokens ) {
    if ( intangible ) break;
    if ( (other === token) || other.hidden || isDefeated(other) || isIntangible(other) || sharesSpaceWith(token, other) ) continue;
    if ( preview && other.object && !other.object.visible ) continue;   // ne pas révéler un token invisible
    const o = footprintOf(other);
    const slice = positionOf(other._source);
    for ( let di = 0; di < o.h; di++ ) for ( let dj = 0; dj < o.w; dj++ ) {
      const key = `${cellKey({ i: o.i + di, j: o.j + dj })}@${other._source.level}`;
      if ( !taken.has(key) ) taken.set(key, []);
      taken.get(key).push(slice);
    }
  }

  const layer = canvas.tokens;
  const backend = CONFIG.Canvas.polygonBackends.move;
  const blockedCache = new Map();
  const blocked = cell => {
    if ( intangible ) return false;
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
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
    const id = `${cellKey(from)}>${cellKey(to)}`;
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
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
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
  // §224 : système d'escalade et de chute coupé — le chemin garde l'élévation du token (ni sol suivi, ni marche limitée, ni mur à tenir).
  const free = !climbSystemOn();
  const mode = effectiveMode(token);
  const placement = free ? null : placementOf(mode);
  const clearance = clearanceOf(scene);
  const groundCache = new Map();
  const groundOf = cell => {
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !groundCache.has(id) ) groundCache.set(id, groundAt(scene, cell.level ?? ownLevel, center(cell)));
    return groundCache.get(id);
  };
  // En vol, les pieds sous le plafond du niveau, tête comprise.
  const pointsOf = cell => {
    try { return [center(cell), ...token.getContainmentTestPoints({ ...token._source, ...grid.getTopLeftPoint(cell) })]; }
    catch { return [center(cell)]; }
  };
  const ceilingOf = cell => ceilingAt(scene, pointsOf(cell), groundOf(cell)) - (depth * grid.distance);
  // §192 lot 2 : au plafond, on ne marche que sous un plafond à la même hauteur (sa tête contre lui) — plus besoin d'un mur.
  const onCeiling = !free && isOnCeiling(token);
  const ceilingHolds = cell => !onCeiling || (Math.abs(ceilingOf(cell) - ownElevation) < 1e-6);
  // §196 (lot 4) : au mur, on ne marche que le long d'un mur à grimper (ou là où le sol remonte jusqu'à soi) — sans quoi un grimpeur
  // à 10 ft s'éloignait du mur en l'air (clic, manette, `api.approach`). Mis en cache par case : `wallsNear` interroge les arêtes.
  const onWall = !free && !onCeiling && isClimbing(token) && (ownElevation > groundOf(start) + 1e-6);
  // §209 : une porte n'est pas ouverte à la hauteur d'un grimpeur (un mur de niveau est plein du sol au plafond, son ouverture non) — à
  // 5 ft ou plus au-dessus du sol, un pas qui la franchit est refusé, ouverte ou fermée.
  const doorAbove = onWall && ((ownElevation - groundOf(start)) >= grid.distance - 1e-6);
  const highDoorCache = new Map();
  const doorOnStep = (from, to) => {
    const id = `${cellKey(from)}>${cellKey(to)}`;
    if ( !highDoorCache.has(id) ) {
      const a = center(from);
      const b = center(to);
      const edges = scene.levels?.get?.(from.level ?? ownLevel)?.edges;
      let found = false;
      try {
        const rect = new PIXI.Rectangle(Math.min(a.x, b.x) - 1, Math.min(a.y, b.y) - 1, Math.abs(a.x - b.x) + 2, Math.abs(a.y - b.y) + 2);
        for ( const edge of edges?.getEdges?.(rect, { includeOuterBounds: false }) ?? [] ) {
          const wall = edge.object?.document ?? edge.object;
          if ( (edge.type !== "wall") || !wall || (wall.door === CONST.WALL_DOOR_TYPES.NONE) ) continue;
          if ( foundry.utils.lineSegmentIntersects(a, b, edge.a, edge.b) ) { found = true; break; }
        }
      } catch { found = false; }
      highDoorCache.set(id, found);
    }
    return highDoorCache.get(id);
  };
  const wallCache = new Map();
  const wallHolds = cell => {
    if ( !onWall || !isOwn(cell) ) return true;
    const key = cellKey(cell);
    if ( !wallCache.has(key) ) {
      const pos = { ...grid.getTopLeftPoint(cell), elevation: ownElevation, level: ownLevel };
      wallCache.set(key, (groundOf(cell) >= ownElevation - 1e-6) || (wallsNear(token, pos).length > 0));
    }
    return wallCache.get(key);
  };
  // §192 : en escalade, chaque point dit son élévation (celle du grimpeur) et son action — sans elles, la coupe au budget du tour
  // (`constrainMovementPath`) mesurait le premier pas depuis le sol, et un grimpeur ne pouvait plus marcher le long du mur en combat.
  const altitude = cell => placement
    ? { elevation: coherentElevation(mode, elevationOf(cell), groundOf(cell), clearance, (placement === "air") ? ceilingOf(cell) : Infinity), action: mode }
    : (((mode === "climb") || free) ? { elevation: elevationOf(cell), ...((mode === "climb") ? { action: mode } : {}) } : {});
  const difficult = difficultRegionsFor(token);
  const difficultCache = new Map();
  const difficultAt = cell => {
    if ( !difficult.length ) return false;
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !difficultCache.has(id) ) {
      const base = elevationOf(cell);
      const c = center(cell);
      difficultCache.set(id, difficult.some(r => inRange(r, base) && r.polygonTree.testPoint(c, 0.75)));
    }
    return difficultCache.get(id);
  };
  const avoid = avoidRegionsFor(token);
  const avoidCache = new Map();
  const avoidAt = cell => {
    if ( !avoid.length ) return false;
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !avoidCache.has(id) ) {
      const base = elevationOf(cell);
      const c = center(cell);
      avoidCache.set(id, avoid.some(r => inRange(r, base) && r.polygonTree.testPoint(c, 0.75)));
    }
    return avoidCache.get(id);
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
      if ( !ceilingHolds(to) || !wallHolds(to) ) return false;
      if ( onWall && (cellDistance(start, to) > CLIMB_RADIUS) ) return false;
      if ( doorAbove && doorOnStep(from, to) ) return false;
      return !wallBetween(from, to);
    },
    canEnd: cell => {
      if ( !taken.size ) return true;
      const level = cell.level ?? ownLevel;
      const occupants = cellsOf(cell).flatMap(c => taken.get(`${cellKey(c)}@${level}`) ?? []);
      if ( !occupants.length ) return true;
      const mine = { elevation: altitude(cell).elevation ?? elevationOf(cell), depth };
      return !occupants.some(o => overlapsVertically(mine, o, grid.distance));
    },
    // Terrain difficile : cases occupées (dnd5e) et régions ; les deux ne se cumulent pas (canvas/token.mjs:73).
    inStairs: cell => inStairs(cell),
    /** Un pas de `from` à sa voisine `to` sans mur entre les deux (dans le niveau de `to`). */
    wallFree: (from, to) => !wallBetween(from, to),
    doorBetween: (from, to) => (throughDoors && isOwn(to) && ownViewed ? doorBetween(from, to) : null),
    // Une porte à ouvrir coûte une case de plus à l'A* : on ne la préfère qu'au détour qu'elle évite.
    stepCost: (from, to) => (throughDoors && isOwn(to) && ownViewed && doorBetween(from, to) ? 1 : 0) + ((difficultAt(to) || cellsOf(to).some(c => layer.isOccupiedGridSpaceDifficult?.({ ...c, k: kOf(to) }, object, { preview }))) ? 2 : 1)
      + (avoidAt(to) ? AVOID_COST : 0),
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
  const stairs = new Map([[cellKey(cell), { i: cell.i, j: cell.j, level }]]);
  const queue = [stairs.get(cellKey(cell))];
  while ( queue.length && (stairs.size < MAX_STAIRS_CELLS) ) {
    const here = queue.shift();
    for ( const [di, dj] of steps ) {
      const next = { i: here.i + di, j: here.j + dj, level };
      if ( stairs.has(cellKey(next)) || !world.inStairs(next) ) continue;
      stairs.set(cellKey(next), next);
      queue.push(next);
    }
  }
  const around = [];
  const entries = new Map();
  for ( const inside of stairs.values() ) {
    for ( const [di, dj] of steps ) {
      const next = { i: inside.i + di, j: inside.j + dj, level };
      if ( stairs.has(cellKey(next)) || world.inStairs(next) || entries.has(cellKey(next)) || !world.wallFree(next, inside) ) continue;
      around.push(next);
      entries.set(cellKey(next), { i: inside.i, j: inside.j });
    }
  }
  return around.length ? { level, around, entries } : null;
}
