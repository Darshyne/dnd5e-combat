/**
 * Les actions qu'un joueur commande à la souris ou au clavier (SPEC §11, étape 6 bis) — se
 * déplacer, sauter, engager une cible — et ce qui borne tout déplacement, quelle qu'en soit la
 * source : le plafond du tour et les attaques d'opportunité réglées AVANT de bouger.
 *
 * `ui/pointer.mjs` traduit les clics en appels d'ici ; il ne décide rien. Ici, rien n'est lu du
 * DOM : ce qu'une intention a d'optionnel (mode « lancer », jet sans dialogue) arrive en argument.
 * Rien n'est patché : `preMoveToken` est un hook public du cœur.
 */

import { MODULE_ID } from "../constants.mjs";
import { movementAllowance } from "../core/turn.mjs";
import { footprintGap, chooseBasicAttack, dragMultiplier, dragAllowance } from "../core/movement.mjs";
import { combatantFor, readBudget, writeBudget, movementOf, speedOf, rangeOf, historyCosts, tokenCenter, positionOf, committedPosition, distanceBetween } from "../adapter/turn.mjs";
import { jumpCost, LANDING_DC } from "../core/jump.mjs";
import { jumpOptionsOf, landsOnDifficult } from "../adapter/jump.mjs";
import { groundUnder } from "../adapter/altitude.mjs";
import { overlapsVertically, verticalExtent, verticalGap } from "../core/space.mjs";
import { pilotOf, pilotOfActor, commandPlan, commandDistance, commandActivities, summonerToken, isIntangible } from "../adapter/pilot.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { sharesSpaceWith } from "../adapter/space-sharing.mjs";
import { planPath, previewPath, walk, stopAllWalks, cellUnder, footprintOf, sizeOf, cellOf, stairsEntry, rulerShown } from "../adapter/movement.mjs";
import { hasLineOfSight } from "../adapter/vision.mjs";
import { victimsOf, sizeRankOf } from "../adapter/grapple.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { cellsAtGap, footprintDistance } from "../core/orders.mjs";
import { fleeGaps } from "../core/flee.mjs";
import { opportunityThreats, resolveOpportunity } from "./reactions.mjs";
import { route } from "./router.mjs";
import { loc, notice, log } from "./shared.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { onTeleport } from "./teleport.mjs";
import { onDashTemplate, onDashUsed } from "./dash.mjs";
import { onPreMoveToken } from "./move-gate.mjs";
import { identifierOf } from "../adapter/content.mjs";
export { afterTeleport, currentTeleport, selfTeleportOf, teleportClick, teleportSelf, teleportTo } from "./teleport.mjs";
export { dashLimit, dashPreview, dashProblem, dashRefusal, dashStrike, dashTargets, lineDashOf, transpose } from "./dash.mjs";

/* -------------------------------------------- */
/*  Ce que le tour permet                       */
/* -------------------------------------------- */

/**
 * Plafond de coût du tour (historique compris), ou Infinity hors combat. Un agrippeur qui traîne sa victime
 * (Agrippé, « Déplaçable ») paie double ce qui lui reste, sauf victime TP ou de deux crans plus petite.
 */
export function movementCap(token) {
  const pilot = pilotOf(token);
  if ( pilot ) return pilotCap(token, pilot);
  const combatant = token.actor ? combatantFor(token.actor) : null;
  if ( !combatant ) return Infinity;
  const movement = movementOf(combatant, readUnitFactors());
  if ( !movement ) return Infinity;
  const budget = readBudget(combatant);
  // §16.59 : un tour achevé par un ordre (Injonction : Rampe, Halte…) — plus un pas.
  if ( budget.stopped ) return movement.spent + historyCosts(token).excluded;
  // §17.2 : le cœur ne connaît que son historique ; la hauteur des escaliers et le relevé s'en retirent ici.
  // §208 : un saut fixe (9 m pour 3 m) rend la différence au plafond, comparé à l'historique du cœur qui compte toute la distance.
  const cap = movementAllowance(budget, movement.speed) - (Number(budget.climbed) || 0) - (Number(budget.stood) || 0) + (Number(budget.jumped) || 0);
  // Le plafond se compare à l'historique du CŒUR, qui compte aussi les téléportations (§16.10) : on les y rajoute.
  const excluded = historyCosts(token).excluded;
  const victims = victimsOf(token);
  if ( !victims.length ) return cap + excluded;
  return dragAllowance(cap, movement.spent, dragMultiplier(sizeRankOf(token.actor), victims.map(v => sizeRankOf(v.actor)))) + excluded;
}

/**
 * §16.15 : un objet piloté se déplace de la distance d'une commande, pendant le tour de son lanceur, si une commande est
 * ouverte ou si le lanceur peut encore la payer. Sinon il ne bouge plus (plafond = ce qu'il a déjà parcouru).
 */
export function pilotMove(token, pilot) {
  const plan = commandPlan(pilot, "move");
  if ( !plan.combatant ) return { cap: Infinity, issue: null };
  const { spent, excluded } = historyCosts(token);
  const stuck = issue => ({ cap: spent + excluded, issue });
  if ( !plan.ownTurn ) return stuck("PasSonTour");
  if ( plan.pay && !((readBudget(plan.combatant)[plan.pay] ?? 0) > 0) ) return stuck("PasDeCommande");
  return { cap: commandDistance(pilot, readUnitFactors()) + excluded, issue: null };
}

const pilotCap = (token, pilot) => pilotMove(token, pilot).cap;

/** Une autre créature (visible, non vaincue, dont on ne peut pas partager la case — §105) occupe-t-elle l'emprise du token à cette position ? */
export function occupiedAt(token, position) {
  // §16.15 : la Main de Bigby « n'occupe pas son espace » — ni elle ne gêne, ni elle n'est gênée.
  if ( isIntangible(token) ) return false;
  const mine = { ...cellOf(token, position), ...sizeOf(token) };
  // §192 : en trois dimensions — un grimpeur au-dessus d'une case occupée n'y est pas (tranche des pieds à la tête).
  const slice = positionOf({ ...token._source, ...position });
  const distance = token.parent.grid.distance;
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  // L'emprise d'abord (un calcul de cases), la tranche ensuite (une soustraction) : les tests qui lisent le contenu des objets
  // (intangible, espace partagé) ne visent que les tokens qui touchent la case. Dans l'ordre inverse, chaque pas d'une marche
  // coûtait ~16 ms sur l'Arène (mesuré le 2026-10-17).
  return token.parent.tokens.some(other => (other !== token) && !other.hidden
    && (footprintGap(mine, footprintOf(other)) === 0) && overlapsVertically(slice, positionOf(other._source), distance)
    && !other.actor?.statuses?.has(defeated) && (other.object?.visible !== false) && !isIntangible(other) && !sharesSpaceWith(token, other));
}

/** Agrippé : Vitesse 0 (dnd5e la pose déjà) — le moteur le dit au lieu de « déplacement épuisé ». */
export const isGrappled = token => token.actor?.statuses?.has("grappled") === true;

/** Portée d'une activité en cases, pour un mode d'attaque. null : pas de portée à tenir (soi-même, illimitée). */
export function reachCells(activity, mode=null) {
  const range = rangeOf(activity, mode ?? "melee");
  const grid = canvas.scene.grid;
  const toCells = value => {
    let v = lengthIn(value, range.units, grid.units);
    return Math.max(1, Math.floor((v / grid.distance) + 1e-6));
  };
  if ( ["self", "spec", "any"].includes(range.units) ) return null;
  if ( range.units === "touch" ) return { normal: 1, long: 1 };
  if ( !range.value ) return (activity.type === "attack") ? { normal: 1, long: 1 } : null;
  return { normal: toCells(range.value), long: toCells(range.long ?? range.value) };
}

/**
 * §192 (lot 2) : l'écart entre deux tokens en cases, en trois dimensions — la distance du moteur (`distanceBetween`, des pieds à la
 * tête, règle de diagonale de la scène) ramenée en cases : 0 superposés ou au contact vertical, 1 à une case (5 ft)… Le même compte
 * que `footprintGap` au sol, et une cible accrochée au plafond (pieds à 15 ft) compte ses 10 ft de vide. `positions` : `posA` / `posB`,
 * une position d'arrivée ou un point de passage.
 */
export function gapCells(a, b, positions={}) {
  const { value } = distanceBetween(a, b, positions);
  return Math.max(0, Math.round((value / a.parent.grid.distance) - 1e-6));
}

/** §192 : le vide vertical entre deux tokens (de la tête de l'un aux pieds de l'autre), en cases ; 0 quand leurs tranches se chevauchent. */
export function verticalGapCells(a, b, { posA, posB }={}) {
  const distance = a.parent.grid.distance;
  const pa = posA ? { ...committedPosition(a), ...posA } : committedPosition(a);
  const pb = posB ? { ...committedPosition(b), ...posB } : committedPosition(b);
  return verticalGap(verticalExtent(pa, distance), verticalExtent(pb, distance)) / distance;
}

/**
 * §192 : la cible est-elle hors d'atteinte par le seul vide vertical (au plafond, en vol) ? Alors aucune approche au sol n'y mène :
 * on ne marche pas pour se coller dessous. `reach` : l'allonge en cases (`reachCells`).
 */
export const tooHighFor = (token, target, reach) => !!reach && (verticalGapCells(token, target) > reach.normal + 1e-6);

/** Les attaques d'arme d'un acteur, et celle qu'un clic sur un ennemi déclenche. */
export function weaponAttacks(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    if ( item.type !== "weapon" ) continue;
    const activity = item.system.activities?.find(a => a.type === "attack");
    if ( !activity ) continue;
    const equipped = (actor.type === "npc") || (item.system.equipped === true);
    if ( !equipped ) continue;
    out.push({ id: activity.uuid, activity, melee: activity.attack?.type?.value !== "ranged", equipped, sort: item.sort ?? 0 });
  }
  return out;
}

/**
 * L'attaque que déclenche un clic sur un ennemi : l'arme de base, ou pour un objet piloté (§16.15) la première attaque
 * de ses commandes (« Move and Attack » de l'Arme spirituelle).
 */
export function basicAttack(actor) {
  const weapon = chooseBasicAttack(weaponAttacks(actor));
  if ( weapon ) return weapon;
  const pilot = pilotOfActor(actor);
  const activity = pilot ? commandActivities(pilot).find(a => a.type === "attack") : null;
  return activity ? { id: activity.uuid, activity, melee: activity.attack?.type?.value !== "ranged" } : null;
}

/** Hostilité : factions, sinon dispositions (§181). Un objet piloté (disposition « secrète ») prend le camp de son lanceur. */
export function hostileTo(me, other) {
  const pilot = pilotOf(me);
  return areEnemies(pilot ? (summonerToken(pilot) ?? me) : me, other);
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/**
 * Les attaques d'opportunité d'abord, le déplacement ensuite (déjà contrôlé : preMoveToken ne redemande pas). `flags` : ce
 * que l'opération de déplacement porte en plus sous la clé du module (`follow`, §41.3), lisible dans `updateToken`.
 */
async function walkSafely(token, plan, flags={}) {
  if ( plan.waypoints.length ) {
    previewPath(token, null);
    if ( !(await resolveOpportunity(token, opportunityThreats(token, plan.waypoints))) ) return false;
  }
  return walk(token, plan, { cleared: true, ...flags });
}

/**
 * Aller au point cliqué, sur le niveau affiché — ou sur `level` (niveau de la scène), que seuls les scénarios passent
 * (runtime/testing.mjs) : le MJ du scénario ne regarde pas forcément le niveau d'arrivée.
 */
export async function moveTo(token, point, { action=null, level=null }={}) {
  if ( isGrappled(token) ) return ui.notifications.warn(loc("Empoignade.Immobile", { name: token.name }));
  const cell = cellUnder(token, point);
  // §18.26 : un clic sur un escalier — aller à côté, puis y entrer en marchant : le cœur demande alors monter ou descendre.
  const stairs = (!level || (level === token._source.level)) ? stairsEntry(token, cell) : null;
  const to = stairs ? { cells: stairs.around, level: stairs.level } : { cell, ...(level ? { level } : {}) };
  // §18.25 : le chemin peut passer par une porte fermée — on marche jusqu'à elle, on l'ouvre, on repart (quelques portes au plus).
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, to, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return ui.notifications.warn(loc("Deplacement.AucunChemin"));
    if ( stairs && plan.arrives && !plan.door ) return enterStairs(token, plan, stairs, cell, action);
    if ( !plan.waypoints.length && !plan.door ) {
      if ( !plan.arrives ) ui.notifications.warn(loc("Deplacement.Epuise"));
      return;
    }
    if ( action ) plan.waypoints.forEach(w => { w.action = action; });
    if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return;
    // Pas de porte, ou le déplacement du tour s'épuise avant elle : on s'arrête là.
    if ( !plan.door || !plan.arrives ) return;
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
}

/**
 * §39.1 : marche publique (`api.approach`), pour les modules qui veulent faire aller un token quelque part par le chemin
 * du moteur — A*, portes ouvertes en chemin, attaques d'opportunité, budget du tour — sans qu'il connaisse le module :
 * ils donnent les cases d'arrivée admises (coin haut-gauche du token, sur le niveau `level` ou le sien), le moteur va à la
 * plus proche qu'il atteint. Même boucle que `moveTo`. Aucun effet si le client ne possède pas le token.
 * @param {TokenDocument} token
 * @param {{ cells: {i: number, j: number}[], level?: string|null }} to
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"noCells"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
export async function approach(token, { cells, level=null, target=null, reachCells=1, seeing=false }={}) {
  // §179 : s'approcher d'une cible jusqu'à une allonge ou une portée donnée (en cases), « en la voyant » si demandé — la zone
  // d'approche de `planPath` (celle d'une attaque), ouverte aux voisins.
  if ( target ) return approachTarget(token, target, { reachCells, seeing });
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( !Array.isArray(cells) || !cells.length ) return { arrived: false, reason: "noCells" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const wanted = cells.map(({ i, j }) => ({ i, j }));
  const to = { cells: wanted, ...(level ? { level } : {}) };
  // Arrivé : sur une des cases ET sur le bon niveau (§41.3 : la même case, un étage plus haut, n'est pas l'arrivée).
  const onGoal = () => {
    if ( level && ((token._source.level ?? null) !== level) ) return false;
    const here = cellOf(token);
    return wanted.some(c => (c.i === here.i) && (c.j === here.j));
  };
  if ( onGoal() ) return { arrived: true };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, to, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return onGoal() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return onGoal() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return onGoal() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §179 : marcher vers une cible jusqu'à `reachCells` cases d'elle (1 = au contact), sur son niveau ; `seeing` : seulement jusqu'à
 * une case d'où on la voit (un tireur). Portes, attaques d'opportunité et budget du tour comme toute marche du moteur.
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
async function approachTarget(token, target, { reachCells=1, seeing=false }={}) {
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const reach = Math.max(1, Math.round(reachCells) || 1);
  // §192 : en trois dimensions — une cible au plafond n'est pas « à portée » depuis la case sous elle.
  const there = () => ((token._source.level ?? null) === (target._source.level ?? null)) && (gapCells(token, target) <= reach);
  if ( there() ) return { arrived: true };
  // §192 : hors d'atteinte par le vide vertical seul (au plafond, en vol) : aucune marche au sol n'y mène, on ne bouge pas.
  if ( tooHighFor(token, target, { normal: reach }) ) return { arrived: false, reason: "tooHigh" };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, { target, reachCells: reach, seeing }, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return (there() || plan.arrives) ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return (there() || plan.arrives) ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return there() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §179 : un chemin sans le parcourir — vers des cases (`cells`, `level`) ou une cible (`target`, `reachCells`, `seeing`). `maxCost` :
 * le plafond de coût à tester (défaut : ce qui reste au token ce tour, Infinity hors combat), dans l'unité de la grille, cumulé avec
 * l'historique du tour ; `extra` : un supplément au plafond du tour (sa Vitesse : « arriverait-il en Sprintant ? »). Rend
 * `{ arrives, moves, door }` — `arrives` : le but est atteint dans le plafond —, ou null s'il n'y a pas de chemin.
 */
export function pathTo(token, { cells=null, level=null, target=null, reachCells=1, seeing=false }={}, { maxCost=null, extra=0 }={}) {
  const doc = token?.document ?? token;
  if ( !doc?.object ) return null;
  const to = target ? { target: target.document ?? target, reachCells: Math.max(1, Math.round(reachCells) || 1), seeing }
    : { cells: (cells ?? []).map(({ i, j }) => ({ i, j })), ...(level ? { level } : {}) };
  if ( !target && !to.cells.length ) return null;
  const plan = planPath(doc, to, { maxCost: maxCost ?? (movementCap(doc) + (Number(extra) || 0)), throughDoors: true });
  if ( !plan ) return null;
  return { arrives: !!plan.arrives && !plan.door, moves: plan.waypoints.length > 0, door: !!plan.door };
}

/**
 * §41.3 : rejoindre un autre token — aller au contact, où qu'il soit sur la scène (un autre niveau compris), par le chemin
 * du moteur : la zone d'approche d'une cible (`planPath` avec `target`, comme pour une attaque au contact — une estimation
 * juste, là où une liste de cases autour de lui épuisait la recherche d'un niveau à l'autre), portes ouvertes en chemin,
 * attaques d'opportunité, budget du tour. `flags` : ce que l'opération de déplacement porte (`follow`, voir `walkSafely`).
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
export async function joinToken(token, target, flags={}) {
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const there = () => ((token._source.level ?? null) === (target._source.level ?? null))
    && (footprintDistance(footprintOf(token), footprintOf(target)) <= 0);
  if ( there() ) return { arrived: true };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, { target, reachCells: 1 }, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return there() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan, flags)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return there() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return there() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §41.3 : refaire un trajet déjà fait par un autre token (la piste d'un meneur : ses étapes, changement de niveau compris),
 * sans recherche de chemin — attaques d'opportunité et budget du tour comme toute marche du moteur. Rend false si le
 * déplacement a été refusé ou interrompu.
 */
export async function followTrail(token, waypoints, flags={}) {
  if ( !token?.isOwner || !waypoints?.length || isGrappled(token) ) return false;
  return walkSafely(token, { waypoints: waypoints.map(w => ({ ...w })), beyond: [], arrives: true }, flags);
}

/**
 * §18.26 : marcher jusqu'à la case voisine de l'escalier, puis un pas de marche ordinaire dans la case d'escalier qui la
 * touche (`stairs.entries`, adapter/movement.mjs `stairsEntry`) — pas un `displace`, qui ne déclencherait pas le comportement
 * `changeLevel` du cœur (change-level.mjs:57-62). Le budget du tour et les attaques d'opportunité de ce dernier pas passent
 * par `preMoveToken` comme tout déplacement.
 */
async function enterStairs(token, plan, stairs, cell, action) {
  if ( action ) plan.waypoints.forEach(w => { w.action = action; });
  if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return;
  const here = cellOf(token);
  const entry = stairs.entries?.get(`${here.i},${here.j}`) ?? cell;
  const step = { ...token.parent.grid.getTopLeftPoint(entry), snapped: true, ...(action ? { action } : {}) };
  await token.move([step], { showRuler: rulerShown() });
}

/**
 * §41.2 : prendre l'escalier (l'échelle, l'ascenseur) sous ce point jusqu'au niveau `level`, d'un seul geste — l'A* marche
 * jusqu'à côté et pose le token sur l'escalier de l'autre niveau par un pas `displace` (adapter/movement.mjs), sans le
 * dialogue du cœur ; la hauteur est comptée au budget du tour, les attaques d'opportunité jouées. Le cœur ne change pas
 * la vue d'un MJ avec son token (change-level.mjs:109) : on le fait ici, comme lui.
 */
export async function takeStairs(token, point, level) {
  const origin = token._source.level;
  await moveTo(token, point, { level });
  if ( (token._source.level === level) && (origin !== level) && game.user.isGM && token.parent.isView && (canvas.level?.id === origin) ) {
    await token.parent.view({ level, controlledTokens: [token.id] });
  }
}

/** §18.25 : portes qu'un seul clic de déplacement ouvre en chemin. */
const MAX_DOORS_PER_MOVE = 3;

/**
 * §208 : sauter jusqu'à la case visée, en longueur (`high` faux) ou en hauteur (`high` vrai : monter sur une surface plus haute — estrade,
 * rebord —, dans la limite du saut en hauteur). Distances des règles 2024 (core/jump.mjs) : élan lu dans l'historique en combat, Athlète,
 * Monte-en-l'air, Pas du vent, et le saut fixe une fois par tour (sort Saut, Bottes : 9 m pour 3 m, la différence rendue au budget).
 * Chaque pied coûte un pied (dnd5e : le mode « jump » sans multiplicateur ni terrain difficile). Arrivée en terrain difficile : test de
 * Dextérité (Acrobaties) DD 10, sinon À terre. Un saut en longueur garde sa hauteur : s'il arrive au-dessus d'un sol plus bas, dnd5e pose
 * « En chute » et la chute suit (runtime/falls.mjs). Sur le client de celui qui saute.
 */
export async function jumpTo(token, point, { high=false, configure=true }={}) {
  const grid = canvas.scene.grid;
  const units = grid.units;
  const cell = cellUnder(token, point);
  const top = grid.getTopLeftPoint(cell);
  const from = committedPosition(token);
  const ft = v => lengthIn(v, units, "ft");
  const toGrid = v => lengthIn(v, "ft", units);
  const horizontal = ft(grid.measurePath([grid.getCenterPoint(grid.getTopLeftPoint(cellOf(token))), grid.getCenterPoint(top)]).distance);
  const here = from.elevation ?? 0;
  const ground = groundUnder(token, { ...from, x: top.x, y: top.y });
  const rise = ft(ground - here);
  const options = jumpOptionsOf(token);
  const info = { rise, ground, horizontal, high: options.high, long: options.long, runningStart: options.runningStart };
  // Un refus : le message, et ce que l'appelant peut lire (raison, mesures).
  const refuse = (key, data) => { ui.notifications.warn(loc(key, data)); return { done: false, reason: key, ...info }; };
  const fmt = n => `${Math.floor(toGrid(n) * 10) / 10} ${units}`;
  let elevation = here;
  let jump;
  if ( high ) {
    if ( rise <= 1e-6 ) return refuse("Saut.RienAMonter");
    // La hauteur se saute ; le déplacement horizontal, lui, se paie à part.
    const up = jumpCost(rise, options.high, options.fixed);
    if ( !up.ok ) return refuse("Saut.TropHaut", { max: fmt(up.limit), elan: loc(options.runningStart ? "Saut.AvecElan" : "Saut.SansElan") });
    jump = { ...up, cost: up.cost + horizontal, distance: rise + horizontal };
    elevation = ground;
  } else {
    if ( rise > 1e-6 ) return refuse("Saut.PlusHaut");
    jump = { ...jumpCost(horizontal, options.long, options.fixed), distance: horizontal };
    if ( !jump.ok ) return refuse("Saut.TropLong", { max: fmt(jump.limit), elan: loc(options.runningStart ? "Saut.AvecElan" : "Saut.SansElan") });
  }
  // Le déplacement qu'il reste ce tour (le même compte que l'anneau de l'interface : plafond du moteur moins l'historique du cœur).
  if ( options.combatant ) {
    const { spent, excluded } = historyCosts(token);
    const left = movementCap(token) - spent - excluded;
    if ( toGrid(jump.cost) > left + 1e-6 ) return refuse("Saut.PasAssez", { cost: fmt(jump.cost), left: `${Math.floor(left * 10) / 10} ${units}` });
  }
  // Saut fixe : le cœur comptera toute la distance ; la différence est rendue, et le saut fixe est pris pour le tour.
  const refund = (jump.fixed && options.combatant) ? Math.max(0, toGrid(jump.distance - jump.cost)) : 0;
  if ( jump.fixed && options.combatant ) {
    const b = readBudget(options.combatant);
    await writeBudget(options.combatant, { ...b, fixedJump: true, jumped: (Number(b.jumped) || 0) + refund });
  }
  const dest = { ...top, elevation, snapped: true, action: "jump" };
  // Saut en hauteur : s'élever d'abord sur place, puis avancer à cette hauteur — en ligne droite depuis le sol, la trajectoire passait
  // sous le bord de la surface visée, que le cœur tient pour pleine par en dessous (le déplacement était refusé).
  const rising = high ? [{ x: from.x, y: from.y, elevation, snapped: true, action: "jump" }] : [];
  const moved = await walkSafely(token, { waypoints: [...rising, dest], beyond: [], arrives: true });
  if ( (moved === false) && jump.fixed && options.combatant ) {
    const b = readBudget(options.combatant);
    await writeBudget(options.combatant, { ...b, fixedJump: false, jumped: Math.max(0, (Number(b.jumped) || 0) - refund) });
    return { done: false, reason: "moveRefused", ...info };
  }
  log(`${token.name}: ${high ? "high" : "long"} jump, ${Math.round(jump.distance)} ft for ${Math.round(jump.cost)} ft${jump.fixed ? " (fixed jump)" : ""}${options.runningStart ? "" : ", standing"}`);
  // Arrivée en terrain difficile : Dextérité (Acrobaties) DD 10, sinon À terre.
  const center = { x: top.x + ((token.width ?? 1) * grid.sizeX / 2), y: top.y + ((token.height ?? 1) * grid.sizeY / 2) };
  if ( landsOnDifficult(token, center, elevation) ) {
    ui.notifications.info(loc("Saut.Atterrissage", { name: token.name, dc: LANDING_DC }));
    const rolls = await token.actor.rollSkill({ skill: "acr", ability: "dex", target: LANDING_DC }, { configure });
    const total = rolls?.[0]?.total;
    if ( Number.isFinite(total) && (total < LANDING_DC) ) {
      await token.actor.toggleStatusEffect("prone", { active: true });
      notice(token, loc("Saut.ATerre"));
    }
  }
  return { done: moved !== false, reason: null, fixed: jump.fixed, cost: jump.cost, ...info };
}

/**
 * §18.24 : les cases d'où un token touche une porte, de son côté du mur (le côté opposé s'il est exactement dessus : les deux).
 * Le long du mur, une case par pas de grille, décalée d'une demi-emprise perpendiculairement.
 */
function doorSideCells(token, wall) {
  const grid = token.parent.grid;
  const [x1, y1, x2, y2] = wall.document.c;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if ( !length ) return [];
  const dir = { x: (x2 - x1) / length, y: (y2 - y1) / length };
  const normal = { x: -dir.y, y: dir.x };
  const center = tokenCenter(token);
  const side = Math.sign((normal.x * (center.x - x1)) + (normal.y * (center.y - y1)));
  const { w, h } = sizeOf(token);
  const offset = (Math.max(w, h) * grid.size) / 2;
  const steps = [];
  for ( let t = grid.size / 2; t < length; t += grid.size ) steps.push(t);
  if ( !steps.length ) steps.push(length / 2);
  const cells = new Map();
  for ( const s of side ? [side] : [1, -1] ) {
    for ( const t of steps ) {
      const point = { x: x1 + (dir.x * t) + (normal.x * s * offset), y: y1 + (dir.y * t) + (normal.y * s * offset) };
      const cell = cellUnder(token, point);
      cells.set(`${cell.i},${cell.j}`, cell);
    }
  }
  return Array.from(cells.values());
}

/**
 * §18.24 : s'avancer au contact d'une porte avant d'y agir (ouvrir, fermer, crocheter, forcer). Comme un geste de contact
 * (§18.22), on ne bouge que si l'on y arrive ce tour-ci. true : au contact (ou grille sans cases, où l'on agit sur place).
 */
export async function approachDoor(token, wall) {
  const grid = token.parent.grid;
  if ( grid.isGridless || !grid.isSquare ) return true;
  const cells = doorSideCells(token, wall);
  if ( !cells.length ) return true;
  const here = cellOf(token);
  if ( cells.some(c => (c.i === here.i) && (c.j === here.j)) ) return true;
  if ( isGrappled(token) ) { ui.notifications.warn(loc("Empoignade.Immobile", { name: token.name })); return false; }
  const plan = planPath(token, { cells, level: token._source.level ?? undefined }, { maxCost: movementCap(token) });
  if ( !plan ) { ui.notifications.warn(loc("Deplacement.AucunChemin")); return false; }
  if ( !plan.arrives ) { ui.notifications.warn(loc("Porte.HorsDatteinte")); return false; }
  if ( !plan.waypoints.length ) return true;
  if ( !(await walkSafely(token, plan)) ) return false;
  // Arrêté en route (attaque d'opportunité qui renverse, contrainte du cœur) : on n'agit pas à distance.
  const at = cellOf(token);
  return cells.some(c => (c.i === at.i) && (c.j === at.j));
}

/**
 * §16.59 : marcher jusqu'à être à `gap` cases de `anchor` (0 : au contact — Approche ; plus : Fuis), par l'A* du moteur,
 * dans le budget du tour, pas à pas (attaques d'opportunité comprises). Hors d'atteinte : aussi près que possible.
 * Rend true si le token est arrivé à cet écart.
 */
export async function walkToGap(token, anchor, gap, { maxCost=null }={}) {
  const grid = token.parent.grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = token.parent.dimensions;
  const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
  const bounds = { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j };
  const cells = cellsAtGap(footprintOf(anchor), sizeOf(token), gap, bounds);
  if ( !cells.length || isGrappled(token) ) return false;
  // §147 : `maxCost` — un déplacement hors du budget du tour (la Réaction de Murmures dissonants : la Vitesse entière).
  const plan = planPath(token, { cells, level: token._source.level ?? undefined }, { maxCost: maxCost ?? movementCap(token) });
  if ( plan?.waypoints?.length ) await walkSafely(token, plan);
  return footprintDistance(footprintOf(token), footprintOf(anchor)) === gap;
}

/** Écart actuel au sol, en cases, entre deux tokens (0 : au contact) — en deux dimensions : la fuite (§180) se mesure sur la carte. */
export const gapBetween = (a, b) => Math.max(0, footprintDistance(footprintOf(a), footprintOf(b)));

/**
 * §180 : s'éloigner d'une menace (un voisin : la fuite d'un PNJ). « Aussi loin que le déplacement du tour le permet » — plus `extra`
 * (la Vitesse : un Sprint pris d'abord) —, par l'A* du moteur et sa marche (attaques d'opportunité, budget). Les écarts sont essayés
 * du plus loin au plus près (`fleeGaps`, comme Murmures dissonants §147). `dryRun` : seulement dire si un écart plus grand est
 * joignable, sans bouger. Rend `{ moved, from, to, reason? }` (`reason` : `notOwner` | `grappled` | `noMovement` | `cornered`).
 */
export async function fleeFrom(token, anchor, { extra=0, dryRun=false }={}) {
  token = token?.document ?? token;
  anchor = anchor?.document ?? anchor;
  if ( !token?.isOwner ) return { moved: false, reason: "notOwner" };
  const from = gapBetween(token, anchor);
  if ( isGrappled(token) ) return { moved: false, from, to: from, reason: "grappled" };
  const distance = token.parent.grid.distance || 5;
  const cap = movementCap(token);
  const history = historyCosts(token);
  const speed = speedOf(token.actor, readUnitFactors())?.speed ?? 0;
  const left = Number.isFinite(cap) ? (cap - history.spent - history.excluded) : speed;
  const maxCost = (Number.isFinite(cap) ? cap : (history.spent + history.excluded + speed)) + (Number(extra) || 0);
  const cells = Math.floor((Math.max(0, left) + (Number(extra) || 0)) / distance);
  if ( cells <= 0 ) return { moved: false, from, to: from, reason: "noMovement" };
  const grid = token.parent.grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = token.parent.dimensions;
  const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
  const bounds = { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j };
  for ( const gap of fleeGaps(from, cells) ) {
    const goal = cellsAtGap(footprintOf(anchor), sizeOf(token), gap, bounds);
    if ( !goal.length ) continue;
    const plan = planPath(token, { cells: goal, level: token._source.level ?? undefined }, { maxCost });
    if ( !plan?.arrives || !plan.waypoints?.length ) continue;
    if ( dryRun ) return { moved: false, from, to: gap, possible: true };
    await walkSafely(token, plan);
    const to = gapBetween(token, anchor);
    return { moved: to !== from, from, to };
  }
  return { moved: false, from, to: from, reason: "cornered" };
}

/** Mode d'attaque imposé par un clic (« lancer »), lu au jet d'attaque (runtime/turn.mjs). Vie courte. */
const pendingAttacks = new Map();

/**
 * Une utilisation relancée par une porte (runtime/gates.mjs) garde ce qu'on avait décidé : jet sans dialogue, mode,
 * et la confirmation déjà donnée (« Attaquer quand même » à l'utilisation) — sinon le contrôle de portée du jet
 * redemanderait, sans minuteur (vu le 2026-09-24 : « Magicien est hors de portée » après une porte de Sanctuaire).
 */
export function keepPendingAttack(activity, { mode=null, fast=false, confirmed=false }={}) {
  pendingAttacks.set(activity.uuid, { mode, fast, confirmed, at: Date.now() });
}

export function takePendingAttack(activity) {
  const entry = pendingAttacks.get(activity.uuid);
  pendingAttacks.delete(activity.uuid);
  return (entry && ((Date.now() - entry.at) < 30000)) ? entry : null;
}

/**
 * Désigne la cible, s'approche s'il le faut, puis utilise l'activité : les jets viennent après
 * le déplacement. Si le tour ne permet pas d'arriver à portée, on avance et on s'arrête là.
 * @param {TokenDocument} token
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {string|null} [options.mode]   Mode d'attaque imposé (« thrown »).
 * @param {boolean} [options.fast]       Jet d'attaque sans dialogue.
 * @param {Array} [options.usage]        [usageConfig, dialogConfig, messageConfig] d'une utilisation suspendue (visée).
 * @param {string} [options.choice]      Effet exclusif choisi d'avance (id d'effet de l'activité) : la question
 *                                       de l'effet ne sera pas posée (§15.2, « Lutte », « Bousculade : à terre »).
 * @param {Event} [options.event]        Le clic qui a lancé l'action : dnd5e y lit les touches d'avantage et de
 *                                       désavantage (Alt / Ctrl, dice/d20-roll.mjs:83-84) ; il passe au jet par
 *                                       `usageConfig.event` (activity/attack.mjs:69). Sans effet si l'utilisation
 *                                       suspendue porte déjà le sien.
 */
/**
 * §16.29 (décision de l'utilisateur, 2026-09-25) : seule une attaque au corps à corps s'approche de sa cible (clic sur un
 * ennemi : s'avancer puis frapper) — et un objet piloté, qui agit au contact. Un sort, une arme à distance ou lancée ne
 * déplacent jamais la créature : hors de portée, le clic est refusé.
 */
export function approaches(activity, mode=null) {
  if ( pilotOfActor(activity?.actor) ) return true;
  if ( contactAction(activity) ) return true;
  const thrown = String(mode ?? "").includes("thrown");
  return (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !thrown;
}

/**
 * §18.22 : les gestes de contact des actions de base — attaque à mains nues, Lutte / Bousculade, Soutien. Ils s'approchent
 * de leur cible comme une attaque au corps à corps, mais seulement si elle est valide et atteignable ce tour-ci : sinon,
 * on ne bouge pas.
 */
export function contactAction(activity) {
  const item = activity?.item;
  return (!!item && (identifierOf(item).id === "unarmed-strike")) || (basicActionOf(item) === "help");
}

/**
 * Pourquoi un geste de contact ne vaut pas contre cette cible (texte court), ou null. Soutien : un ennemi ; Lutte /
 * Bousculade : une créature d'au plus une taille de plus que soi (Manuel des joueurs 2024, attaque à mains nues).
 */
export function contactRefusal(token, target, activity) {
  if ( !contactAction(activity) ) return null;
  if ( target === token ) return loc("Retour.PasSoi");
  if ( (basicActionOf(activity.item) === "help") && !hostileTo(token, target) ) return loc("Retour.PasEnnemi");
  if ( (activity.type === "save") && (sizeRankOf(target.actor) > sizeRankOf(token.actor) + 1) ) return loc("Retour.TropGrand");
  return null;
}

/**
 * Où en est une cible pour une activité qui ne s'approche pas : `out` au-delà de la portée longue, `blind` à portée d'une
 * arme à distance ou d'un sort mais sans ligne de vue. null : pas de portée à tenir.
 */
export function rangeStatus(token, target, activity, mode=null) {
  const reach = reachCells(activity, mode);
  if ( !reach ) return null;
  const gap = gapCells(token, target);   // §192 : en trois dimensions (une cible au plafond est hors d'allonge)
  const out = gap > reach.long;
  const blind = !out && (reach.normal > 1) && !hasLineOfSight(tokenCenter(token), target);
  return { out, blind, gap, reach };
}

/**
 * §67 : une réaction qui rejoint d'abord la source (« se déplacer jusqu'à sa vitesse vers l'attaquant et l'attaquer »).
 * Hors d'allonge de l'activité, le réacteur s'approche — sa Vitesse entière, quoi qu'il ait dépensé à son tour (c'est
 * la réaction qui donne ce déplacement), sans attaque d'opportunité (`cleared`, comme un déplacement forcé). Hors combat, pas
 * de budget à lire : la Vitesse seule. Rend true si la cible est à portée ensuite.
 * @param {Actor5e} actor            Celui qui réagit.
 * @param {TokenDocument} target     La source de la fenêtre.
 * @param {Activity} activity        L'activité de réaction.
 */
export async function reactionApproach(actor, target, activity) {
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  const reach = reachCells(activity);
  if ( !token?.isOwner || !target || !reach ) return false;
  if ( gapCells(token, target) <= reach.normal ) return true;
  if ( tooHighFor(token, target, reach) ) return false;   // §192 : au plafond, hors d'atteinte — on ne se déplace pas pour rien
  // Hors combat (pas de budget de tour), la Vitesse seule, comptée depuis l'historique du cœur tel qu'il est.
  const combatant = combatantFor(actor);
  const movement = combatant ? movementOf(combatant, readUnitFactors())
    : { spent: historyCosts(token).spent, ...(speedOf(actor, readUnitFactors()) ?? { speed: 0 }) };
  if ( !(movement?.speed > 0) || isGrappled(token) ) return false;
  // Le plafond se compare à l'historique du cœur (ce tour-ci) : ce qui est déjà fait, plus la Vitesse que donne la réaction.
  const maxCost = movement.spent + movement.speed + historyCosts(token).excluded;
  const plan = planPath(token, { target, reachCells: reach.normal }, { maxCost });
  if ( !plan?.waypoints.length ) return false;
  await walk(token, plan, { cleared: true });
  log(`${token.name}: moves to ${target.name} for its reaction (${activity.item?.name ?? ""})${plan.arrives ? "" : ", without reaching it"}`);
  return !!plan.arrives;
}

export async function engage(token, target, activity, { mode=null, fast=false, usage=null, event=null, choice=null }={}) {
  // §150 : le mode qu'un voisin a mis dans la configuration d'utilisation (`{ "dnd5e-combat": { attackMode } }` : la main secondaire de la
  // Barre) — sans lui, il se perdait entre la visée et le jet.
  mode ??= usage?.[0]?.[MODULE_ID]?.attackMode ?? null;
  // §18.22 : un geste de contact sur une cible qui ne s'y prête pas est refusé avant tout déplacement.
  const refusal = contactRefusal(token, target, activity);
  if ( refusal ) {
    ui.notifications.warn(loc("LabelValue", { label: target.name, value: refusal }));
    notice(target, refusal);
    return;
  }
  // Hors du corps à corps, on ne bouge pas : hors de portée ou hors de vue, le geste est refusé.
  if ( !approaches(activity, mode) ) {
    const status = rangeStatus(token, target, activity, mode);
    if ( status?.out ) {
      ui.notifications.warn(loc("Deplacement.HorsDePortee", { name: target.name }));
      notice(target, loc("Retour.HorsDePortee"));
      return;
    }
    if ( status?.blind ) {
      ui.notifications.warn(loc("Deplacement.CibleHorsDeVue", { name: target.name }));
      notice(target, loc("Retour.NonVue"));
      return;
    }
  }
  // §16.15 : un objet piloté agit au contact — la portée de « Roll » (9 m) est celle de son déplacement, pas de son effet.
  const reach = pilotOfActor(activity.actor) ? { normal: 1, long: 1 } : reachCells(activity, mode);
  // §192 : une cible que le vide vertical seul met hors d'allonge (au plafond, en vol) — l'approche au sol n'y mène pas : refusé net.
  if ( reach && approaches(activity, mode) && tooHighFor(token, target, reach) ) {
    ui.notifications.warn(loc("Escalade.HorsDallonge", { name: target.name }));
    notice(target, loc("Retour.HorsDePortee"));
    return;
  }
  target.object?.setTarget(true, { releaseOthers: true });
  if ( reach && approaches(activity, mode) ) {
    const gap = gapCells(token, target);
    // P1 : à distance, on ne s'approche que jusqu'à une case d'où l'on VOIT la cible — et si l'on est
    // déjà à portée sans la voir, on cherche une telle case.
    const ranged = reach.normal > 1;
    const seeing = ranged;
    const blind = ranged && (gap <= reach.normal) && !hasLineOfSight(tokenCenter(token), target);
    if ( (gap > reach.normal) || blind ) {
      const plan = planPath(token, { target, reachCells: reach.normal, seeing }, { maxCost: movementCap(token) });
      const withinLong = !blind && (gap <= reach.long);
      if ( !plan && blind ) return ui.notifications.warn(loc("Deplacement.CibleHorsDeVue", { name: target.name }));
      if ( !plan && !withinLong ) return ui.notifications.warn(loc("Deplacement.AucunChemin"));
      // §18.22 : un geste de contact ne s'avance pas pour rien — hors d'atteinte ce tour-ci, on reste sur place.
      if ( contactAction(activity) && !plan?.arrives && !withinLong ) {
        notice(target, loc("Retour.HorsDePortee"));
        return ui.notifications.warn(loc("Deplacement.CibleHorsDatteinte", { name: target.name }));
      }
      if ( plan?.arrives || !withinLong ) {
        if ( plan && !(await walkSafely(token, plan)) ) return;
        if ( !plan?.arrives ) return ui.notifications.warn(loc("Deplacement.CibleHorsDatteinte", { name: target.name }));
      }
    }
  }
  pendingAttacks.set(activity.uuid, { mode, fast, at: Date.now() });
  const [usageConfig, dialogConfig, original] = usage ?? [{}, {}, {}];
  // dnd5e fige les cibles dans la configuration du message dès la première utilisation
  // (activity/mixin.mjs:239-242) : à ce moment-là il n'y en avait pas. On les laisse se relire.
  const messageConfig = foundry.utils.deepClone(original ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  // Le mode choisi par le clic (« lancer », « main secondaire ») : la légalité le lit à l'utilisation, le
  // budget sur la carte (runtime/turn.mjs) — la main secondaire coûte l'action Bonus, pas l'action.
  if ( mode ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.attackMode`, mode);
  if ( choice ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.choice`, choice);
  const config = { ...usageConfig, [MODULE_ID]: { ...usageConfig?.[MODULE_ID], engaged: true, ...(mode ? { attackMode: mode } : {}), ...(choice ? { choice } : {}) } };
  if ( event && !config.event ) config.event = event;
  await activity.use(config, dialogConfig, messageConfig);
}

/**
 * §16.33 : intention « lancer sur ces créatures » (visée de groupe, ui/pointer.mjs) — l'utilisation suspendue repart, le
 * niveau déjà choisi, avec les créatures désignées pour cibles. dnd5e fige les cibles de la carte dès la première utilisation
 * (activity/mixin.mjs:239-242) : on les laisse se relire.
 * @param {Activity} activity
 * @param {[object, object, object]} usage  Configurations d'utilisation, de fenêtre et de message.
 * @param {string[]} picks                  Uuids des tokens.
 */
export async function castOnTargets(activity, [config, dialog, message], picks) {
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  for ( const uuid of picks ) fromUuidSync(uuid, { strict: false })?.object?.setTarget(true, { releaseOthers: false, groupSelection: true });
  const messageConfig = foundry.utils.deepClone(message ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  await activity.use({ ...config, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), engaged: true } }, dialog, messageConfig);
}

/* -------------------------------------------- */

export function registerActions() {
  route("dnd5e.teleport", onTeleport, { cancellable: true, label: "teleport: destination" });
  route("dnd5e.postUseActivity", onDashUsed, { label: "straight-line dash: movement" });
  route("dnd5e.preCreateMeasuredTemplate", onDashTemplate, { cancellable: true, label: "straight-line dash: no area" });
  route("preMoveToken", onPreMoveToken, { cancellable: true, label: "movement: cap and opportunity attacks" });
  // §99 : la pause arrête les marches du moteur lancées depuis ce client (chacun arrête les siennes, Hooks.callAll partout).
  route("pauseGame", paused => { if ( paused ) stopAllWalks(); }, { label: "pause: walks stopped" });
}
