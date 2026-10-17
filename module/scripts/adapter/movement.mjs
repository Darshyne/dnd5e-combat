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
import { findPath, turningPoints } from "../core/pathfind.mjs";
import { approach, pushDirection, footprintGap } from "../core/movement.mjs";
import { committedPosition, combatantFor, readBudget, writeBudget } from "./turn.mjs";
import { isIntangible } from "./pilot.mjs";
import { hasLineOfSight } from "./vision.mjs";
import { effectiveMode } from "./altitude.mjs";
import { lengthIn } from "./units.mjs";
import { worldFor } from "./path-world.mjs";
export { passableDoor, stairsDestinations, stairsEntry, stairsOf } from "./path-world.mjs";

export const cellKey = c => `${c.i},${c.j}`;

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

export const isDefeated = token => token.actor?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) === true;

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
    const kept = new Set(turningPoints(list));
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
      // Le cœur ajoute des points de terrain : on recompte NOS cases atteintes, par position. À quelques pixels près : quand le budget
      // tombe exactement sur une case (§192, vu le 2026-10-17 : 20 ft dépensés, un pas d'escalade à 10 ft, 30 de plafond), l'arrondi
      // flottant du cœur coupe le pas un pixel avant la case (y = 201 pour 200) — la case est atteinte, à 0,05 ft près.
      const tolerance = Math.max(2, token.parent.grid.size * 0.02);
      const reached = point => path.some(p => (Math.abs(p.x - point.x) <= tolerance) && (Math.abs(p.y - point.y) <= tolerance));
      kept = 1;
      while ( (kept < full.length) && reached(full[kept]) ) kept++;
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
 * `stoppable` faux : le chemin d'un seul tenant, sans point de contrôle — pour les pas du suivi (`follow`), qu'aucun clic
 * n'arrête. Un `Scene#view` qui change de niveau redessine tout le canevas (documents/scene.mjs:273-281) ; un déplacement que
 * le cœur enchaîne encore à ce moment rafraîchit un token détruit (« Cannot read properties of null (reading 'position') »,
 * `Token#_refreshPosition`). Le suiveur marche justement quand la vue du MJ suit son meneur à l'étage (scénario `suivre`).
 */
function checkpointed(move, stoppable=true) {
  if ( !stoppable ) return move.map(({ climb, stops, through, ...w }) => w);
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
    catch(err) { console.warn(`${MODULE_ID} | stopping the movement of ${token.name}`, err); }
  }
  return true;
}

export function stopAllWalks() {
  for ( const token of Array.from(walks.keys()) ) stopWalking(token);
}

/**
 * B12 : le canevas démonté (changement de scène), une marche en cours ne finira jamais — le `move` du cœur reste en attente.
 * On l'arrête et on l'oublie, pour que la prochaine marche de ce token ne tente pas d'arrêter un mouvement mort.
 */
export function forgetAllWalks() {
  stopAllWalks();
  walks.clear();
}

/**
 * B12 : les mouvements de ce client restés en attente quand le canevas est redessiné. Le cœur enchaîne un mouvement après
 * l'animation du précédent (`#continueMovement`, documents/token.mjs:998) ; une mise à jour déjà partie au démontage en
 * relance un, dont l'animation n'existe plus : il reste « pending » sans fin et coupe la marche suivante après une case
 * (vu le 2026-10-16). Le canevas tout neuf n'en anime aucun : on les arrête. `movingTokens` : documents/user.mjs:64.
 */
export function stopDeadMovements() {
  for ( const token of Array.from(game.user.movingTokens ?? []) ) {
    if ( token.movement?.state !== "pending" ) continue;
    try { token.stopMovement(); }
    catch(err) { console.warn(`${MODULE_ID} | stopping the movement of ${token.name}`, err); }
  }
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
    const done = await token.move(checkpointed(move, !options[MODULE_ID].follow), { showRuler: rulerShown(), ...(constrainOptions ? { constrainOptions } : {}), ...options });
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
  let value = lengthIn(distance, units, grid.units, factors);
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
