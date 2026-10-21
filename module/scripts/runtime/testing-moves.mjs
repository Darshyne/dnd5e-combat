/**
 * Fonctions de test (api.mcp) : déplacements par le chemin du moteur — A*, escaliers, suivre, familier, vue, téléportation,
 * ruée, portes, menaces d'opportunité. Extrait de runtime/testing.mjs.
 */

import { strike } from "./storm.mjs";
import { MODULE_ID } from "../constants.mjs";
import { afterTeleportOptions } from "./teleport-options.mjs";
import { planPath, stairsOf, stairsDestinations, stopWalking } from "../adapter/movement.mjs";
import { combatantFor, readBudget, movementOf } from "../adapter/turn.mjs";
import { setDoorOpen, doorState } from "./doors.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { jumpOptionsOf } from "../adapter/jump.mjs";
import { jumpTo, moveTo, movementCap, selfTeleportOf, teleportTo, afterTeleport, teleportClick, dashStrike, dashTargets, dashProblem, dashLimit, lineDashOf, transpose as transposeIntent, takeStairs as takeStairsIntent, gapCells, verticalGapCells, tooHighFor, reachCells, basicAttack, rangeStatus, engage, approach } from "./actions.mjs";
import { dismissFamiliar, recallFamiliar, recallRefusal, canPocket, canRecall } from "./familiar.mjs";
import { pocketOf, isFamiliarToken, emptyPocket } from "../adapter/familiar.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { leaderOf, followersOf, follow as followIntent, unfollow as unfollowIntent } from "./follow.mjs";
import { opportunityThreats } from "./reactions.mjs";
import { sleep } from "./shared.mjs";
import { cellArg, finite, gmOnly, positionJson, viewedToken, waypointOf, windows } from "./testing-shared.mjs";
import { budget } from "./testing-rules.mjs";
import { wall } from "./testing-areas.mjs";
import { hoistOnto, grabEdge, startClimb, dropDown as dropDownIntent, canClimb, climbRoom, canClimbCeiling, climbToCeiling, ceilingRoom, canClimbDown, climbDown as climbDownIntent, descentRoom, climbStateOf, climbHoldsAt, climbToward as climbTowardIntent } from "./climb.mjs";
import { wallsNear, isClimbing, isOnCeiling, climbingOf, climbRules, canWalkCeilings, ceilingPerchFor, FLIP_FLAG, inSlipperyZone, canWalkCeilingsAt, acrobaticFor, ledgesOf, edgesBelowOf } from "../adapter/climb.mjs";
import { speedGrantEffects } from "./speed-grants.mjs";
import { MODE_STATUSES } from "../adapter/conditions.mjs";

/** Les escaliers et échelles de la scène, avec les cases qu'ils couvrent (centre dans la région). */
export function stairs({ tokenId }) {
  const token = viewedToken({ tokenId });
  const grid = token.parent.grid;
  return stairsOf(token.parent, token.actor).map(({ region, levels, multiplier }) => {
    const b = region.bounds;   // client/documents/region.mjs:129
    const from = grid.getOffset({ x: b.x, y: b.y });
    const to = grid.getOffset({ x: b.right - 1, y: b.bottom - 1 });
    const cells = [];
    for ( let i = from.i; i <= to.i; i++ ) for ( let j = from.j; j <= to.j; j++ ) {
      if ( region.polygonTree.testPoint(grid.getCenterPoint({ i, j }), 0.75) ) cells.push({ i, j });
    }
    return { regionId: region.id, name: region.name, levels, multiplier, elevation: { bottom: finite(region.elevation.bottom), top: finite(region.elevation.top) }, cells };
  });
}

/** Le chemin que prendrait le moteur, sans bouger. `maxCost` : plafond de coût (unité de la grille), sinon celui du tour. */
export function plan({ tokenId, cell, point, levelId, maxCost }) {
  const token = viewedToken({ tokenId });
  const target = cellArg(token, { cell, point });
  const cap = Number.isFinite(maxCost) ? maxCost : movementCap(token);
  const found = planPath(token, { cell: target, level: levelId ?? token._source.level }, { maxCost: cap, throughDoors: true });
  if ( !found ) return { found: false };
  return {
    found: true,
    arrives: found.arrives,
    door: found.door?.id ?? null,
    maxCost: finite(cap),
    waypoints: found.waypoints.map(waypointOf),
    beyond: found.beyond.map(waypointOf)
  };
}

/** Le budget de déplacement du token dans le combat en cours (null hors combat). */
export function movement({ tokenId }) {
  const token = viewedToken({ tokenId });
  const combatant = token.actor ? combatantFor(token.actor) : null;
  const out = { position: positionJson(token), viewedLevel: canvas.level?.id ?? null, cap: finite(movementCap(token)), combat: null };
  if ( !combatant ) return out;
  const m = movementOf(combatant, readUnitFactors());
  const budget = readBudget(combatant);
  out.combat = { combatantId: combatant.id, spent: m?.spent ?? null, speed: m?.speed ?? null, units: m?.units ?? null, climbed: Number(budget.climbed) || 0 };
  return out;
}

/**
 * Déplace le token comme un clic de déplacement (`moveTo` : A*, portes, escaliers, attaques d'opportunité, budget), et
 * attend qu'il soit arrivé. Rend les positions avant / après et les fenêtres ouvertes pendant le déplacement (le
 * dialogue « Change Level » du cœur s'il s'est ouvert). §99 : `stopAfterMs` arrête la marche en route (comme un clic ailleurs),
 * `pauseAfterMs` met le jeu en pause en route (et l'en sort à l'arrivée).
 */
export async function move({ tokenId, cell, point, levelId, action, stopAfterMs, pauseAfterMs }) {
  const token = viewedToken({ tokenId });
  const target = cellArg(token, { cell, point });
  const opened = new Set(foundry.applications.instances.keys());
  const before = positionJson(token);
  const started = Date.now();
  const timers = [];
  if ( Number.isFinite(stopAfterMs) ) timers.push(setTimeout(() => stopWalking(token), stopAfterMs));
  if ( Number.isFinite(pauseAfterMs) ) timers.push(setTimeout(() => game.togglePause(true, { broadcast: true }), pauseAfterMs));
  try { await moveTo(token, token.parent.grid.getCenterPoint(target), { action: action ?? null, level: levelId ?? null }); }
  finally {
    timers.forEach(clearTimeout);
    if ( Number.isFinite(pauseAfterMs) && game.paused ) game.togglePause(false, { broadcast: true });
  }
  const after = positionJson(token);
  const newWindows = windows().filter(w => !opened.has(w.id));
  return { before, after, elapsedMs: Date.now() - started, viewedLevel: canvas.level?.id ?? null, newWindows };
}

/**
 * §224 : un déplacement « à la main », comme le glisser ou le champ d'élévation du HUD — `token.move` d'un seul point (case `cell`, sinon
 * sur place) à `elevation` (sinon la sienne), dans le mode `action` (sinon le sien), sans l'A* du moteur ; rend les positions et les
 * états « En chute » / À terre après coup (on attend un peu : la chute de dnd5e se pose après le déplacement).
 */
export async function rawMove({ tokenId, cell=null, elevation=null, action=null, settleMs=1500 }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const at = cell ? token.parent.grid.getTopLeftPoint(cell) : { x: token._source.x, y: token._source.y };
  const waypoint = { ...at, elevation: Number.isFinite(elevation) ? elevation : (token._source.elevation ?? 0), action: action ?? token._source.movementAction };
  const result = await token.move([waypoint]).catch(err => ({ error: err.message }));
  await new Promise(resolve => setTimeout(resolve, settleMs));
  return { result, before, after: positionJson(token),
    falling: token.actor?.statuses?.has("falling") === true, prone: token.actor?.statuses?.has("prone") === true };
}

/** §41.2 : où mène l'escalier sous ce point pour ce token (ce que lit le curseur et le menu). */
export function stairsAt({ tokenId, point }) {
  return stairsDestinations(viewedToken({ tokenId }), point);
}

/** §41.2 : prendre l'escalier sous ce point jusqu'à `levelId`, comme un clic dessus (sans le dialogue du cœur). */
export async function takeStairs({ tokenId, point, levelId }) {
  const token = viewedToken({ tokenId });
  const opened = new Set(foundry.applications.instances.keys());
  const before = positionJson(token);
  await takeStairsIntent(token, point, levelId);
  return { before, after: positionJson(token), viewedLevel: canvas.level?.id ?? null, newWindows: windows().filter(w => !opened.has(w.id)) };
}

/** §41.3 : l'ordre de suivre, de ne plus suivre, et qui suit qui. */
export async function follow({ followerId, leaderId }) {
  return { following: await followIntent(viewedToken({ tokenId: followerId }), viewedToken({ tokenId: leaderId })) };
}

export async function unfollow({ tokenId }) {
  return { stopped: await unfollowIntent(viewedToken({ tokenId })) };
}

export function followState({ tokenId }) {
  const token = viewedToken({ tokenId });
  return { leader: leaderOf(token)?.id ?? null, followers: followersOf(token).map(t => t.id), position: positionJson(token) };
}

/**
 * §107 : l'état d'un familier ou d'un maître — familier reconnu, vision, actions de base, poche dimensionnelle (le familier
 * gardé et ses PV ; `clear` la vide) ; et les gestes : congé (`tokenId` du familier), rappel (`tokenId` du maître, `point`).
 */
export async function familiar({ tokenId, clear=false }) {
  const token = canvas.scene?.tokens.get(tokenId);
  if ( !token ) return { present: false };
  if ( clear && game.user.isGM ) await emptyPocket(token.actor);   // remise en état d'un scénario
  const pocket = pocketOf(token.actor);
  return { present: true, familiar: isFamiliarToken(token), sight: token._source.sight?.enabled === true,
    basics: (token.actor?.items ?? []).map(basicActionOf).filter(Boolean).sort(), canPocket: canPocket(token), canRecall: canRecall(token),
    pocket: pocket ? { name: pocket.name, hp: pocket.token.delta?.system?.attributes?.hp?.value ?? null,
      items: (pocket.token.delta?.items ?? []).map(i => i.name) } : null };
}

export async function familiarPocket({ tokenId }) {
  return { done: await dismissFamiliar(viewedToken({ tokenId })) };
}

export async function familiarRecall({ tokenId, point }) {
  const token = viewedToken({ tokenId });
  const refusal = recallRefusal(token, point);
  const done = refusal ? false : await recallFamiliar(token, point);
  return { done, refusal, tokens: token.parent.tokens.filter(t => isFamiliarToken(t)).map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y,
    hp: t.actor?.system?.attributes?.hp?.value ?? null })) };
}

/** Affiche un niveau de la scène chez le MJ (un déplacement du moteur fait suivre la vue : le scénario la rend). */
export async function view({ levelId }) {
  gmOnly();
  if ( !canvas.scene?.levels?.get?.(levelId) ) throw new Error(`level ${levelId} missing from the viewed scene`);
  if ( canvas.level?.id !== levelId ) await canvas.scene.view({ level: levelId });
  return { viewedLevel: canvas.level?.id ?? null };
}

/** §67 ter : le clic du moteur pendant la visée d'une téléportation (un point de la scène), sans la souris. */
export function teleportPick({ x, y }) {
  return { picked: teleportClick({ x, y }) };
}

/**
 * Une destination de téléportation de soi (Foulée brumeuse), comme la rendrait le clic de la planification du cœur : le
 * plan passe par le même point de contrôle (`dnd5e.teleport`, que le moteur tient : portée, case occupée, vue —
 * runtime/actions.mjs, `onTeleport`) ; accepté, le token se téléporte (action « blink »). Seul le clic lui-même (la
 * planification interactive du cœur) n'est pas joué.
 */
export async function teleport({ tokenId, itemId, x, y }) {
  const token = viewedToken({ tokenId });
  const activity = token.actor?.items.get(itemId)?.system.activities?.find(a => selfTeleportOf(a)) ?? null;
  if ( !activity ) throw new Error("no self-teleport on this item");
  const from = { x: token._source.x, y: token._source.y, elevation: token._source.elevation ?? 0, level: token._source.level ?? null };
  // Le même chemin que le clic du joueur (`teleportSelf`) : validation, `blink`, puis l'activité d'arrivée (`teleport.then`).
  const accepted = await teleportTo(activity, token, { x, y });
  if ( accepted ) await afterTeleport(activity, selfTeleportOf(activity));
  // §92 : les options de la Foulée des fées, comme après le vrai geste — sans les attendre (le scénario répond à la question).
  if ( accepted ) afterTeleportOptions(activity, token, from).catch(err => console.error(err));
  return { accepted, position: positionJson(token) };
}

/** §23 : qui menacerait d'une attaque d'opportunité un déplacement en ligne droite jusqu'à ce point (noms). */
export function threats({ tokenId, point }) {
  const token = viewedToken({ tokenId });
  const at = token.parent.grid.getTopLeftPoint(token.parent.grid.getOffset(point));
  const waypoints = [{ x: at.x, y: at.y, elevation: token._source.elevation, action: "walk" }];
  return opportunityThreats(token, waypoints).map(e => (typeof e === "string")
    ? (fromUuidSync(e, { strict: false })?.name ?? e) : `${fromUuidSync(e.token, { strict: false })?.name ?? e.token} (reactive strike)`);
}

/** §38.2 : l'échange de place du Troc du filou, comme l'entrée du menu (depuis l'illusion ou son lanceur) ; positions avant / après. */
export async function transpose({ tokenId }) {
  const token = viewedToken({ tokenId });
  const at = t => ({ x: t._source.x, y: t._source.y });
  const before = at(token);
  const done = await transposeIntent(token);
  return { done, before, after: at(token) };
}

/**
 * §57 : une ruée en ligne droite (Frappe du vent) vers une case donnée (coin haut-gauche), sans la visée : le même contrôle de la
 * case, les mêmes cibles, la même utilisation sans gabarit. `preview: true` : seulement les cibles et ce qui refuserait la case
 * (`problem`, clé de traduction ou null), rien de lancé.
 */
export async function dash({ tokenId, itemId, x, y, preview=false }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const activity = token.actor?.items.get(itemId)?.system.activities?.find(a => lineDashOf(a)) ?? null;
  if ( !activity ) throw new Error("no straight-line charge on this item");
  if ( preview ) {
    const to = { x, y, elevation: token._source.elevation ?? 0 };
    // La limite de la visée (`dashRefusal`) : la Vitesse convertie dans l'unité de la scène.
    return { targets: dashTargets(token, to, lineDashOf(activity)).map(t => t.name),
      problem: dashProblem(token, to, dashLimit(token))?.[0] ?? null };
  }
  const before = game.messages.contents.at(-1)?.id ?? null;
  const used = await dashStrike(activity, [{ consume: false, [MODULE_ID]: { confirmed: true, autoReact: "none" } }, {}, {}], { x, y });
  for ( let i = 0; (i < 30) && ((token._source.x !== x) || (token._source.y !== y)); i++ ) await sleep(100);
  const message = game.messages.contents.findLast(m => (m.type === "usage") && m.getFlag(MODULE_ID, "dash"));
  return { used, position: positionJson(token), messageId: (message && (message.id !== before)) ? message.id : null,
    targets: (message?.system.targets ?? []).map(t => t.name), regions: canvas.scene.regions.filter(r => r.getFlag("dnd5e", "activity") === activity.uuid).length };
}

/**
 * §152 : ouvrir ou fermer une porte comme l'entrée « Ouvrir / Fermer » du menu (`setDoorOpen` : s'avancer au contact par
 * `approachDoor`, puis agir). Rend l'état de la porte et la position du token après coup.
 */
export async function door({ tokenId, wallId, open=true }) {
  const token = viewedToken({ tokenId });
  const wall = canvas.walls.get(wallId);
  if ( !wall?.isDoor ) throw new Error(`wall ${wallId} is not a door of the viewed scene`);
  await setDoorOpen(token, wall, open);
  return { state: doorState(wall), x: token._source.x, y: token._source.y };
}

/* -------------------------------------------- */
/*  §177 : diagnostic, pour les scénarios          */

/* -------------------------------------------- */
/*  Escalade (§192)                             */
/* -------------------------------------------- */

/** L'état d'un grimpeur (ou d'un candidat) : murs touchés, mode, statut, ce qu'il peut monter, règles du monde ; §192 lot 2 : le plafond. */
export function climbState({ tokenId }) {
  const token = viewedToken({ tokenId });
  const walls = wallsNear(token).map(w => w.id);
  const room = canClimb(token) || isClimbing(token) ? climbRoom(token) : null;
  const ceiling = ceilingRoom(token);
  return { walls, canClimb: canClimb(token), climbing: isClimbing(token), status: token.actor?.statuses?.has(MODE_STATUSES.climbing.id) === true,
    rules: climbRules(), speed: climbingOf(token), room: room ? { ...room, remaining: finite(room.remaining) } : null, position: positionJson(token),
    falling: token.actor?.statuses?.has("falling") === true, checkedAt: token.getFlag(MODULE_ID, "climb")?.checkedAt ?? null,
    // Lot 2 : au plafond ?, peut y aller ?, la capacité, le perchoir, le statut « Au plafond », le miroir vertical.
    onCeiling: isOnCeiling(token), canCeiling: canClimbCeiling(token), walksCeilings: canWalkCeilings(token.actor),
    perch: ceilingPerchFor(token), ceiling: ceiling ? { perch: ceiling.perch, cells: ceiling.cells, affordable: ceiling.affordable } : null,
    ceilingStatus: token.actor?.statuses?.has(MODE_STATUSES.ceiling.id) === true, canDown: canClimbDown(token),
    scaleY: token._source.texture?.scaleY ?? 1, flip: token.getFlag(MODULE_ID, FLIP_FLAG) ?? null,
    // Lot 3 (§195) : surface glissante, capacité au plafond ici, « Courir sur le mur », vitesses accordées par le contenu.
    slippery: inSlipperyZone(token), walksCeilingsHere: canWalkCeilingsAt(token), canRun: acrobaticFor(token),
    acrobatic: token.getFlag(MODULE_ID, "climb")?.acrobatic === true,
    grants: speedGrantEffects(token.actor).map(e => ({ id: e.id, name: e.name, changes: (e.system?.changes ?? e.changes ?? []).map(c => ({ key: c.key, value: c.value })) })),
    // §196 : ce que publie `api.climb.state`.
    api: climbStateOf(token) };
}

/** §209 : se hisser sur le rebord `dir` (« n », « s », « e », « w » ; le premier sinon), comme l'entrée de menu. */
export async function hoist({ tokenId, dir=null }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const ledges = ledgesOf(token);
  const ledge = ledges.find(l => !dir || (l.dir === dir)) ?? null;
  const done = ledge ? await hoistOnto(token, ledge) : false;
  await sleep(800);
  return { done, ledges: ledges.map(({ dir, ground, rise, level }) => ({ dir, ground, rise, level })), before, after: positionJson(token),
    climbing: isClimbing(token) };
}

/** §216 : « S'agripper au bord » vers `dir` (ou le premier bord), comme l'entrée de menu ; rend les bords proposés et la position. */
export async function grab({ tokenId, dir=null }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const edges = edgesBelowOf(token);
  const edge = edges.find(e => !dir || (e.dir === dir)) ?? null;
  const done = edge ? await grabEdge(token, edge) : false;
  await sleep(800);
  return { done, edges: edges.map(({ dir, elevation, level, drop }) => ({ dir, elevation, level, drop })), before, after: positionJson(token),
    climbing: isClimbing(token) };
}

/** §196 : `api.climb.holds` sur une case (`cell` : { i, j }) — le grimpeur y tiendrait-il ? */
export function climbHolds({ tokenId, cell }) {
  return { holds: climbHoldsAt(viewedToken({ tokenId }), cell) };
}

/** §196 : `api.climb.toward` — grimper jusqu'à l'allonge d'une cible ; rend son résultat, les positions et l'écart (3D) avant / après. */
export async function climbToward({ tokenId, targetId, reachCells=1 }) {
  const token = viewedToken({ tokenId });
  const target = viewedToken({ tokenId: targetId });
  const before = { ...positionJson(token), gap: gapCells(token, target), vertical: verticalGapCells(token, target) };
  const result = await climbTowardIntent(token, target, { reachCells });
  await sleep(300);
  const after = { ...positionJson(token), gap: gapCells(token, target), vertical: verticalGapCells(token, target) };
  return { result, before, after, ...climbState({ tokenId }) };
}

/** Grimper de `cells` cases, comme l'entrée de menu (sans fenêtre), et attendre la montée ; `acrobatic` : « Courir sur le mur » (§195). */
export async function climb({ tokenId, cells, acrobatic=false }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const done = await startClimb(token, { cells: Number.isFinite(cells) ? cells : null, acrobatic: acrobatic === true });
  return { done, before, after: positionJson(token), ...climbState({ tokenId }) };
}

/** §192 lot 2 : « Grimper au plafond », comme l'entrée de menu, et attendre la montée. */
export async function climbCeiling({ tokenId }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const done = await climbToCeiling(token);
  await sleep(300);
  return { done, before, after: positionJson(token), ...climbState({ tokenId }) };
}

/** §192 lot 2 : « Descendre le long du mur » de `cells` cases, comme l'entrée de menu (sans fenêtre). */
export async function climbDown({ tokenId, cells }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const room = canClimbDown(token) ? descentRoom(token) : null;
  const done = await climbDownIntent(token, { cells: Number.isFinite(cells) ? cells : null });
  await sleep(300);
  return { done, before, after: positionJson(token), max: room?.max ?? null, ...climbState({ tokenId }) };
}

/**
 * §192 lot 2 : ce que l'attaque de base de `tokenId` pense de `targetId` — écart en cases (3D), vide vertical, trop haut pour une
 * approche, et le verdict de portée ; `engage: true` lance l'attaque de base comme un clic sur l'ennemi (sans dialogue) et dit si le
 * token a bougé et si une carte a été créée. `approach: true` : `api.approach({ target })` (la marche de l'IA, §179) et son résultat.
 */
export async function reachCheck({ tokenId, targetId, engage: doEngage=false, approach: doApproach=false }) {
  const token = viewedToken({ tokenId });
  const target = viewedToken({ tokenId: targetId });
  const attack = basicAttack(token.actor);
  const reach = attack ? reachCells(attack.activity) : null;
  const out = {
    weapon: attack?.activity?.item?.name ?? null, reach, gap: gapCells(token, target), vertical: verticalGapCells(token, target),
    tooHigh: attack ? tooHighFor(token, target, reach) : null, status: attack ? rangeStatus(token, target, attack.activity) : null,
    before: positionJson(token)
  };
  if ( doApproach ) out.approach = await approach(token, { target, reachCells: reach?.normal ?? 1 });
  if ( doEngage && attack ) {
    const messages = game.messages.size;
    await engage(token, target, attack.activity, { fast: true });
    await sleep(500);
    out.engaged = { messages: game.messages.size - messages };
  }
  out.after = positionJson(token);
  out.moved = (out.after.x !== out.before.x) || (out.after.y !== out.before.y) || (out.after.elevation !== out.before.elevation);
  return out;
}

/**
 * §208 : un saut comme l'entrée de menu (« Sauter ici », « Sauter en hauteur ici »), vers le centre de `cell`. Rend les positions avant et
 * après, ce que le saut permettait (`options`, en pieds), les avertissements affichés, et le budget du tour (saut fixe, remboursement).
 */
export async function jump({ tokenId, cell, high=false }) {
  const token = viewedToken({ tokenId });
  const grid = token.parent.grid;
  const before = positionJson(token);
  const options = jumpOptionsOf(token);
  const warnings = [];
  const warn = ui.notifications.warn;
  ui.notifications.warn = (msg, ...rest) => { warnings.push(String(msg)); return warn.call(ui.notifications, msg, ...rest); };
  let result;
  try { result = await jumpTo(token, grid.getCenterPoint(grid.getTopLeftPoint(cell)), { high, configure: false }); }
  finally { ui.notifications.warn = warn; }
  await sleep(800);
  const combatant = token.actor ? combatantFor(token.actor) : null;
  const budget = combatant ? readBudget(combatant) : null;
  return { result: result ?? null, before, after: positionJson(token), warnings,
    options: { long: options.long, high: options.high, runningStart: options.runningStart, fixed: options.fixed, runUp: options.rules.runUp, useDex: options.rules.useDex },
    budget: budget ? { jumped: budget.jumped ?? 0, fixedJump: !!budget.fixedJump, jumpDouble: !!budget.jumpDouble } : null,
    statuses: Array.from(token.actor?.statuses ?? []) };
}

/** « Se laisser tomber » : chute volontaire, comme l'entrée de menu. */
export async function dropDown({ tokenId }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const done = await dropDownIntent(token);
  return { done, before, after: positionJson(token), hp: token.actor?.system?.attributes?.hp?.value ?? null, ...climbState({ tokenId }) };
}
