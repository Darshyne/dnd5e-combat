/**
 * Fonctions de test exposées au connecteur MCP (`call-module-api`, connecteur ≥ 0.28.0) sous
 * `game.modules.get("dnd5e-combat").api.mcp` : ce que les scénarios (tools/scenarios/) ne peuvent pas
 * faire par les outils génériques — faire marcher un token par le chemin du MOTEUR (A*, escaliers,
 * budget), comme un clic. Arguments et résultats en JSON (ids, cases, points), jamais de document.
 *
 * Client du MJ seulement (celui qui exécute le connecteur), sur la scène qu'il affiche : l'A* lit le
 * canevas (murs, polygones des régions).
 */

import { boltAim, setBoltAim, strike } from "./storm.mjs";
import { cloudOf, cloudCircle } from "../adapter/storm.mjs";
import { MODULE_ID } from "../constants.mjs";
import { afterTeleportOptions } from "./teleport-options.mjs";
import { naturalOneFor } from "./natural-one.mjs";
import { perfApi } from "./perf.mjs";
import { planPath, stairsOf, cellOf, stairsDestinations, stopWalking } from "../adapter/movement.mjs";
import { combatantFor, readBudget, movementOf } from "../adapter/turn.mjs";
import { useIssues } from "./turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { moveTo, movementCap, selfTeleportOf, currentTeleport, teleportClick, dashStrike, dashTargets, dashProblem, lineDashOf, transpose as transposeIntent, takeStairs as takeStairsIntent } from "./actions.mjs";
import { dismissFamiliar, recallFamiliar, recallRefusal, canPocket, canRecall } from "./familiar.mjs";
import { pocketOf, isFamiliarToken, emptyPocket } from "../adapter/familiar.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { leaderOf, followersOf, follow as followIntent, unfollow as unfollowIntent } from "./follow.mjs";
import { ownEndingsOf, endingsOn, endFor } from "./action-end.mjs";
import { escapeGrapple } from "./grapple.mjs";
import { reports as itemReports } from "../adapter/automation.mjs";
import { rollDamageFor } from "../adapter/messages.mjs";
import { saveChanceOf } from "../adapter/hitchance.mjs";
import { reportsText } from "../core/automation.mjs";
import { identifierOf, contentOf, worldOverrides, setWorldOverride } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { attackContext, areAdjacent } from "../adapter/conditions.mjs";
import { attackModifiers } from "../core/conditions.mjs";
import { areHostile } from "../core/reaction.mjs";
import { opportunityThreats } from "./reactions.mjs";
import { portentDice, portentOf, rollPortent } from "../adapter/portent.mjs";

/** Le token désigné, sur la scène affichée par le MJ. */
function tokenOf({ tokenId }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const scene = canvas.scene;
  if ( !scene || !canvas.ready ) throw new Error("aucune scène affichée");
  const token = scene.tokens.get(tokenId);
  if ( !token ) throw new Error(`token ${tokenId} absent de la scène affichée (${scene.name})`);
  if ( !token.object ) throw new Error(`token ${token.name} non dessiné`);
  return token;
}

/** La case visée : `cell` ({ i, j }) ou `point` ({ x, y } en pixels, comme un clic). */
function cellArg(token, { cell, point }) {
  if ( cell ) return { i: cell.i, j: cell.j };
  if ( point ) return token.parent.grid.getOffset(point);
  throw new Error("cell { i, j } ou point { x, y } requis");
}

const finite = n => (Number.isFinite(n) ? n : null);

/** Position validée d'un token : ce que lit le moteur. */
function positionOf(token) {
  const { x, y, elevation, level } = token._source;
  return { x, y, elevation: elevation ?? 0, level: level ?? null, cell: cellOf(token), movementAction: token.movementAction ?? null };
}

const waypointOf = ({ x, y, elevation, level, action, climb }) =>
  ({ x, y, elevation: finite(elevation), level: level ?? null, action: action ?? null, climb: finite(climb) });

/** Les escaliers et échelles de la scène, avec les cases qu'ils couvrent (centre dans la région). */
function stairs({ tokenId }) {
  const token = tokenOf({ tokenId });
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
function plan({ tokenId, cell, point, levelId, maxCost }) {
  const token = tokenOf({ tokenId });
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
function movement({ tokenId }) {
  const token = tokenOf({ tokenId });
  const combatant = token.actor ? combatantFor(token.actor) : null;
  const out = { position: positionOf(token), viewedLevel: canvas.level?.id ?? null, cap: finite(movementCap(token)), combat: null };
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
async function move({ tokenId, cell, point, levelId, action, stopAfterMs, pauseAfterMs }) {
  const token = tokenOf({ tokenId });
  const target = cellArg(token, { cell, point });
  const opened = new Set(foundry.applications.instances.keys());
  const before = positionOf(token);
  const started = Date.now();
  const timers = [];
  if ( Number.isFinite(stopAfterMs) ) timers.push(setTimeout(() => stopWalking(token), stopAfterMs));
  if ( Number.isFinite(pauseAfterMs) ) timers.push(setTimeout(() => game.togglePause(true, { broadcast: true }), pauseAfterMs));
  try { await moveTo(token, token.parent.grid.getCenterPoint(target), { action: action ?? null, level: levelId ?? null }); }
  finally {
    timers.forEach(clearTimeout);
    if ( Number.isFinite(pauseAfterMs) && game.paused ) game.togglePause(false, { broadcast: true });
  }
  const after = positionOf(token);
  const newWindows = windows().filter(w => !opened.has(w.id));
  return { before, after, elapsedMs: Date.now() - started, viewedLevel: canvas.level?.id ?? null, newWindows };
}

/** §41.2 : où mène l'escalier sous ce point pour ce token (ce que lit le curseur et le menu). */
function stairsAt({ tokenId, point }) {
  return stairsDestinations(tokenOf({ tokenId }), point);
}

/** §41.2 : prendre l'escalier sous ce point jusqu'à `levelId`, comme un clic dessus (sans le dialogue du cœur). */
async function takeStairs({ tokenId, point, levelId }) {
  const token = tokenOf({ tokenId });
  const opened = new Set(foundry.applications.instances.keys());
  const before = positionOf(token);
  await takeStairsIntent(token, point, levelId);
  return { before, after: positionOf(token), viewedLevel: canvas.level?.id ?? null, newWindows: windows().filter(w => !opened.has(w.id)) };
}

/** §41.3 : l'ordre de suivre, de ne plus suivre, et qui suit qui. */
async function follow({ followerId, leaderId }) {
  return { following: await followIntent(tokenOf({ tokenId: followerId }), tokenOf({ tokenId: leaderId })) };
}
async function unfollow({ tokenId }) {
  return { stopped: await unfollowIntent(tokenOf({ tokenId })) };
}
function followState({ tokenId }) {
  const token = tokenOf({ tokenId });
  return { leader: leaderOf(token)?.id ?? null, followers: followersOf(token).map(t => t.id), position: positionOf(token) };
}

/**
 * §107 : l'état d'un familier ou d'un maître — familier reconnu, vision, actions de base, poche dimensionnelle (le familier
 * gardé et ses PV ; `clear` la vide) ; et les gestes : congé (`tokenId` du familier), rappel (`tokenId` du maître, `point`).
 */
async function familiar({ tokenId, clear=false }) {
  const token = canvas.scene?.tokens.get(tokenId);
  if ( !token ) return { present: false };
  if ( clear && game.user.isGM ) await emptyPocket(token.actor);   // remise en état d'un scénario
  const pocket = pocketOf(token.actor);
  return { present: true, familiar: isFamiliarToken(token), sight: token._source.sight?.enabled === true,
    basics: (token.actor?.items ?? []).map(basicActionOf).filter(Boolean).sort(), canPocket: canPocket(token), canRecall: canRecall(token),
    pocket: pocket ? { name: pocket.name, hp: pocket.token.delta?.system?.attributes?.hp?.value ?? null,
      items: (pocket.token.delta?.items ?? []).map(i => i.name) } : null };
}
async function familiarPocket({ tokenId }) {
  return { done: await dismissFamiliar(tokenOf({ tokenId })) };
}
async function familiarRecall({ tokenId, point }) {
  const token = tokenOf({ tokenId });
  const refusal = recallRefusal(token, point);
  const done = refusal ? false : await recallFamiliar(token, point);
  return { done, refusal, tokens: token.parent.tokens.filter(t => isFamiliarToken(t)).map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y,
    hp: t.actor?.system?.attributes?.hp?.value ?? null })) };
}

/**
 * §43.2 : les effets auxquels une action met fin — ceux du token (`own`), ceux qu'un autre lui retire (`byOther`) ; et le
 * geste : sans `targetId`, le token prend « S'échapper » pour lui-même ; avec, il met fin au premier effet de la cible.
 */
function endings({ tokenId }) {
  const token = tokenOf({ tokenId });
  const tell = e => ({ effect: e.effect.id, name: e.effect.name, item: e.item.name, by: e.rule.by, roll: e.rule.roll ?? null, dc: e.check?.dc ?? null });
  return { own: ownEndingsOf(token.actor).map(tell), byOther: endingsOn(token).map(tell) };
}
async function actionEnd({ tokenId, targetId=null }) {
  const token = tokenOf({ tokenId });
  if ( !targetId ) { await escapeGrapple(token); return { done: true }; }
  const target = tokenOf({ tokenId: targetId });
  const ending = endingsOn(target)[0];
  return { done: ending ? await endFor(token, target, ending) : false };
}

/** Les fenêtres ouvertes chez le MJ (ApplicationV2) : pour retrouver un dialogue qu'un déplacement bloqué attend. */
function windows() {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  return [...foundry.applications.instances.entries()].map(([id, app]) => ({ id, title: app.title ?? null, className: app.constructor?.name ?? null }));
}

/** Ferme une fenêtre (un dialogue fermé vaut « non » : le déplacement mis en pause par le cœur se termine). */
async function closeWindow({ id }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const app = foundry.applications.instances.get(id);
  if ( !app ) return { closed: false };
  await app.close();
  return { closed: true };
}

/** Affiche un niveau de la scène chez le MJ (un déplacement du moteur fait suivre la vue : le scénario la rend). */
async function view({ levelId }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  if ( !canvas.scene?.levels?.get?.(levelId) ) throw new Error(`niveau ${levelId} absent de la scène affichée`);
  if ( canvas.level?.id !== levelId ) await canvas.scene.view({ level: levelId });
  return { viewedLevel: canvas.level?.id ?? null };
}

/**
 * §62 : ce que le client voit à l'écran par les yeux d'un token — le MJ en prend le contrôle (sa vision devient celle de ce
 * token), on lit `isVisible` et le filtre de détection de chaque cible (le contour de l'ouïe, ou d'un mode spécial), puis le
 * contrôle d'avant est rendu.
 */
async function perceived({ observerId, targetIds=[] }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const observer = canvas.tokens.get(observerId);
  if ( !observer ) throw new Error(`token ${observerId} absent de la scène affichée`);
  const before = canvas.tokens.controlled.map(t => t.id);
  observer.control({ releaseOthers: true });
  canvas.perception.update({ initializeVision: true });
  await new Promise(resolve => setTimeout(resolve, 400));
  const out = {};
  for ( const id of targetIds ) {
    const token = canvas.tokens.get(id);
    if ( !token ) continue;
    const visible = token.isVisible;
    const color = token.detectionFilter?.uniforms?.outlineColor;
    out[id] = { name: token.name, visible, filter: visible && token.detectionFilter ? (color ? Array.from(color).map(c => Math.round(c * 100) / 100) : "autre") : null };
  }
  observer.release();
  for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
  canvas.perception.update({ initializeVision: true });
  return out;
}

/** Les items signalés en partie par le MJ (SPEC §9.2), pour le bilan relu par Claude. */
function reports() {
  return { entries: itemReports(), text: reportsText(itemReports()) };
}

/**
 * Le clic sur « Dégâts » ou « Soins » d'une carte d'utilisation dont le moteur attend le jet de l'auteur (soins, dégâts
 * laissés au système) : ce que le connecteur ne fait pas seul (il ne lance que les attaques). Même chemin que le moteur
 * (adapter/messages.mjs, `rollDamageFor`) : le jet est rattaché à la carte, sur les cibles de la résolution.
 */
async function rollCard({ messageId }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const carrier = game.messages.get(messageId);
  if ( !carrier ) throw new Error(`message ${messageId} introuvable`);
  const resolution = carrier.getFlag(MODULE_ID, "resolution");
  if ( !resolution ) throw new Error(`message ${messageId} : pas de résolution du moteur`);
  const rolls = await rollDamageFor(carrier, resolution, false);
  return { rolled: !!rolls, step: resolution.step ?? null };
}

/**
 * Une invocation posée à une case fixe, pour un scénario. L'activité est utilisée sans invoquer (`create.summons: false` :
 * carte, concentration, budget comme en jeu), puis `placeSummons` est appelé avec le premier profil (ou `profile`) ; le
 * placement interactif de dnd5e (`getPlacement`, un clic sur le canevas, dnd5e 6.0.3 dnd5e.mjs:40825-40843, appelé par
 * `placeSummons` :40494) est remplacé par la position donnée, sur CETTE instance d'activité et le temps de l'appel.
 * Outil de test seulement : le moteur, lui, laisse le placement au système.
 */
async function summonAt({ tokenId, itemId, activityId=null, profile=null, actorUuid=null, x, y }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.type === "summon");
  if ( !activity || (activity.type !== "summon") ) throw new Error("activité d'invocation introuvable");
  // §84 : sans rien consommer, comme `use` par défaut — un lanceur sans emplacement ouvrait « Plus de charge » chez le MJ (§77).
  const used = await activity.use({ consume: false, create: { summons: false }, [MODULE_ID]: { confirmed: true, autoReact: "none" } },
    { configure: false });
  activity.getPlacement = async () => [{ x, y, elevation: token.elevation ?? 0, rotation: 0 }];
  // §107 : une invocation « par FP » (Appel de familier) demande la créature au joueur (summon.mjs, `queryActor`) — fournie ici.
  if ( actorUuid ) activity.queryActor = async () => actorUuid;
  try {
    const created = await activity.placeSummons({ profile: profile ?? activity.profiles[0]?._id });
    return { messageId: used?.message?.id ?? null, tokens: (created ?? []).map(t => ({ id: t.id, name: t.name, actorId: t.actorId })) };
  } finally {
    delete activity.getPlacement;
    delete activity.queryActor;
  }
}

/**
 * Les valeurs calculées d'un token (données préparées par dnd5e, que le connecteur ne rend pas : il lit la source) : CA,
 * vitesses, PV, bonus aux attaques et aux sauvegardes — pour vérifier un effet passif sans passer par une attaque.
 */
function stats({ tokenId }) {
  const tok = tokenOf({ tokenId });
  const actor = tok.actor;
  const a = actor?.system?.attributes ?? {};
  // dnd5e 6 range les bonus de jets sous `system.rolls` (`system.bonuses` ne garde que le DD de sort) et y traduit les
  // anciennes clés des effets (`system.bonuses.mwak.attack` → `system.rolls.attack.mwak.bonus`), vu en jeu le 2026-09-27.
  const rolls = actor?.system?.rolls ?? {};
  const attack = kind => rolls.attack?.[kind]?.bonus ?? "";
  return {
    ac: a.ac?.value ?? null, hp: { value: a.hp?.value ?? null, max: a.hp?.max ?? null, tempmax: a.hp?.tempmax ?? 0 },
    speed: Object.fromEntries(Object.entries(a.movement ?? {}).filter(([, v]) => typeof v === "number")),
    bonuses: { mwak: attack("mwak"), rwak: attack("rwak"), msak: attack("msak"), rsak: attack("rsak"),
      save: rolls.ability?.save?.bonus ?? "" },
    size: actor?.system?.traits?.size ?? null,
    mods: Object.fromEntries(Object.entries(actor?.system?.abilities ?? {}).map(([k, v]) => [k, v.mod ?? null])),
    statuses: Array.from(actor?.statuses ?? []),
    // §52 : la lumière du token telle que le cœur la rend (données préparées : effets `token.light.*` compris).
    light: (() => { const l = (tok?.document ?? tok)?.light ?? {}; return { bright: l.bright ?? 0, dim: l.dim ?? 0, angle: l.angle ?? 360,
      animation: l.animation?.type ?? null }; })()
  };
}

/**
 * Une destination de téléportation de soi (Foulée brumeuse), comme la rendrait le clic de la planification du cœur : le
 * plan passe par le même point de contrôle (`dnd5e.teleport`, que le moteur tient : portée, case occupée, vue —
 * runtime/actions.mjs, `onTeleport`) ; accepté, le token se téléporte (action « blink »). Seul le clic lui-même (la
 * planification interactive du cœur) n'est pas joué.
 */
/** La visée d'une téléportation en cours sur ce client : celle du moteur, et la planification du cœur (`_movementPlanningContext`). */
function planning() {
  const ctx = canvas.tokens?._movementPlanningContext ?? null;
  return { teleporting: currentTeleport()?.token?.name ?? null, planning: ctx?.object?.name ?? null,
    controlled: canvas.tokens?.controlled.map(t => t.name) ?? [] };
}

/** §70 : le clic de la visée de l'éclair (un point de la scène) : la pose du cœur est fermée, l'éclair posé au point. */
async function stormStrike({ x, y }) {
  const aim = boltAim();
  if ( !aim ) return { struck: false };
  setBoltAim(null);
  canvas.regions._cancelPlacement?.();
  const region = await strike(aim.activity, aim.cloud, { x, y });
  return { struck: !!region, regionId: region?.id ?? null };
}

/**
 * §70 : valide la pose de région en cours (`RegionLayer#placeRegion` : celle de dnd5e pour la zone d'un sort, ou la visée de
 * l'éclair) au point (x, y) de la scène, comme un clic : la forme y est centrée, puis la fin de `#nextPlacement` est rejouée
 * (client/canvas/layers/regions.mjs:1146-1191 : création si `create`, sinon le document rendu). Une seule forme.
 */
async function placeRegionAt({ x, y }) {
  const ctx = canvas.regions._placementContext;
  if ( !ctx ) return { placed: false };
  const { preview, resolve, create, createOptions, preCommit, destroyPreview, preConfirm, regionIndex, regionCount } = ctx;
  const document = preview.document;
  const shape = document.shapes[0]?.toObject?.() ?? null;
  if ( !shape ) return { placed: false };
  const center = shapeCenterOf(shape);
  const moved = (shape.type === "polygon")
    ? { ...shape, points: shape.points.map((v, i) => v + ((i % 2) ? (y - center.y) : (x - center.x))) }
    : (shape.type === "rectangle") ? { ...shape, x: x - (shape.width / 2), y: y - (shape.height / 2) } : { ...shape, x, y };
  document.updateSource({ shapes: [moved] });
  // Comme `#confirmPlacement` : le rappel du demandeur (dnd5e y relève la forme posée, template-placement.mjs:36).
  if ( preConfirm && (preConfirm({ event: null, document, regionIndex, regionCount, shape: ctx.shape, shapeIndex: 0, shapeCount: 1 }) === false) ) return { placed: false };
  // `_cancelPlacement` détruit l'aperçu (son document est celui qu'on rend) : on lui en laisse un factice, et on finit comme le cœur.
  ctx.resolve = () => {};
  ctx.preview = { destroyed: true };
  canvas.regions._cancelPlacement();
  let region = null;
  if ( !preCommit || ((await preCommit(Object.freeze([document]))) !== false) ) {
    if ( create ) region = await CONFIG.Region.documentClass.create(document.toObject(), { controlObject: true, ...(createOptions ?? {}), parent: document.parent });
    else {
      region = document;
      if ( destroyPreview ) { region._object = null; region._destroyed = false; }
    }
  }
  resolve(region);
  if ( (!region || destroyPreview) && !preview.destroyed ) preview.destroy({ children: true });
  return { placed: true, regionId: create ? region?.id ?? null : null, shape: moved.type };
}

const shapeCenterOf = shape => (Array.isArray(shape.points)
  ? { x: shape.points.filter((_, i) => !(i % 2)).reduce((a, b) => a + b, 0) / (shape.points.length / 2),
      y: shape.points.filter((_, i) => i % 2).reduce((a, b) => a + b, 0) / (shape.points.length / 2) }
  : (shape.type === "rectangle") ? { x: shape.x + (shape.width / 2), y: shape.y + (shape.height / 2) } : { x: shape.x, y: shape.y });

/** §70 : l'orage d'un item sur la scène (nuage, « déjà là », visée en cours). */
function storm({ tokenId, itemId }) {
  const item = tokenOf({ tokenId }).actor?.items.get(itemId);
  const cloud = cloudOf(item);
  return { cloud: cloud ? { id: cloud.id, stormy: !!cloud.getFlag(MODULE_ID, "stormy"), behaviors: cloud.behaviors.map(b => b.type),
    visibility: cloud.visibility, circle: cloudCircle(cloud) } : null, aiming: !!boltAim() };
}

/** §67 ter : le clic du moteur pendant la visée d'une téléportation (un point de la scène), sans la souris. */
function teleportPick({ x, y }) {
  return { picked: teleportClick({ x, y }) };
}

async function teleport({ tokenId, itemId, x, y }) {
  const token = tokenOf({ tokenId });
  const activity = token.actor?.items.get(itemId)?.system.activities?.find(a => selfTeleportOf(a)) ?? null;
  if ( !activity ) throw new Error("pas de téléportation de soi sur cet item");
  const elevation = token._source.elevation ?? 0;
  const plans = [{ token: token.object, plan: { destination: { x, y, elevation } } }];
  const accepted = Hooks.call("dnd5e.teleport", activity, plans) !== false;
  const from = { x: token._source.x, y: token._source.y, elevation, level: token._source.level ?? null };
  if ( accepted ) await token.move([{ x, y, elevation, action: "blink", snapped: true }], { [MODULE_ID]: { cleared: true } });
  // §92 : les options de la Foulée des fées, comme après le vrai geste — sans les attendre (le scénario répond à la question).
  if ( accepted ) afterTeleportOptions(activity, token, from).catch(err => console.error(err));
  return { accepted, position: positionOf(token) };
}

/**
 * Rend un item à un acteur sous son identifiant d'origine (`keepId`), pour un scénario qui le lui a fait perdre (Lâche
 * d'Injonction posée en tas par un module voisin) : le connecteur crée toujours un nouvel identifiant, et le filet de sécurité du lanceur
 * retire les items qu'il ne connaissait pas.
 */
async function restoreItem({ actorId, itemData }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const actor = game.actors.get(actorId);
  if ( !actor ) throw new Error(`acteur ${actorId} introuvable`);
  if ( actor.items.has(itemData?._id) ) return { restored: false, id: itemData._id };
  const [item] = await actor.createEmbeddedDocuments("Item", [itemData], { keepId: true });
  return { restored: !!item, id: item?.id ?? null };
}

/** La chance d'échec de la sauvegarde que la pastille afficherait (§15.3), pour la comparer au vrai jet. */
function saveChance({ casterId, targetId, itemId, activityId=null }) {
  const caster = tokenOf({ tokenId: casterId });
  const target = tokenOf({ tokenId: targetId });
  const item = caster.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.type === "save");
  const info = saveChanceOf(caster, target, activity);
  return info ? { ...info, dice: info.dice.map(d => ({ ...d })) } : null;
}

/**
 * Les raisons d'Avantage et de Désavantage que le moteur donnerait à cette attaque (core/conditions.mjs), et les créatures
 * hostiles au contact de l'attaquant — pour comprendre un jet « normal » inattendu.
 */
function attackReasons({ attackerId, targetId, itemId, attackMode=null }) {
  const origin = tokenOf({ tokenId: attackerId });
  const target = tokenOf({ tokenId: targetId });
  const activity = origin.actor?.items.get(itemId)?.system.activities.find(a => a.type === "attack");
  if ( !activity ) throw new Error("pas d'attaque sur cet item");
  const factors = readUnitFactors();
  const { advantage, disadvantage } = attackModifiers(attackContext(origin, target, activity, attackMode, factors));
  const adjacentHostiles = origin.parent.tokens.filter(t => (t !== origin) && t.actor && !t.hidden
    && areHostile(origin.disposition, t.disposition) && areAdjacent(origin, t, factors)).map(t => t.name);
  return { advantage: advantage.map(r => `${r.who}.${r.key}`), disadvantage: disadvantage.map(r => `${r.who}.${r.key}`), adjacentHostiles };
}

/**
 * §27 : pose (ou retire, `entry: null`) l'entrée d'un identifiant dans la surcouche du monde, et rend celle qu'il y avait —
 * pour qu'un scénario la remette (Incantation puissante à la place d'Impact divin).
 */
async function overrideContent({ identifier, entry=null }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const before = worldOverrides()[identifier] ?? null;
  await setWorldOverride(identifier, entry);
  return { before };
}

/**
 * §29 : applique l'enchantement d'une activité (son premier profil, ou `profile`) à un item de l'acteur — ce que dnd5e fait par un
 * glisser-déposer sur la carte (Décharge répulsive sur la Décharge occulte). Rend l'id de l'effet posé.
 */
async function enchant({ tokenId, itemId, activityId, targetItemId, profile=null }) {
  const actor = tokenOf({ tokenId }).actor;
  const activity = actor?.items.get(itemId)?.system.activities?.get(activityId);
  const target = actor?.items.get(targetItemId);
  if ( !activity || !target ) throw new Error("activité ou item introuvable");
  const effect = await activity.applyEnchantment(profile ?? activity.effects?.[0]?._id, target, { strict: true });
  return { effectId: effect?.id ?? null };
}

/** §23 : soigne un token comme le ferait un sort (`applyDamage` de type « healing ») ; rend ses PV avant et après. */
async function heal({ tokenId, amount }) {
  const actor = tokenOf({ tokenId }).actor;
  const before = actor.system.attributes.hp.value;
  await actor.applyDamage([{ value: amount, type: "healing" }]);
  return { before, after: actor.system.attributes.hp.value };
}

/** §23 : des dégâts à un token, par `applyDamage` (résistances comprises) ; rend ses PV avant et après. */
async function hurt({ tokenId, amount, type="bludgeoning", properties=[] }) {
  const actor = tokenOf({ tokenId }).actor;
  const before = actor.system.attributes.hp.value;
  // `properties` : celles du jet (« sil » : arme argentée, §78).
  await actor.applyDamage([{ value: amount, type, properties: new Set(properties) }]);
  return { before, after: actor.system.attributes.hp.value };
}

/** §23 : un jet de sauvegarde du token, sans fenêtre ; rend sa formule et son total. */
async function rollSave({ tokenId, ability }) {
  const rolls = await tokenOf({ tokenId }).actor.rollSavingThrow({ ability }, { configure: false });
  return { formula: rolls?.[0]?.formula ?? null, total: rolls?.[0]?.total ?? null, d20: rolls?.[0]?.d20?.total ?? null };
}

/** §98 : le relevé des temps du moteur sur le client du MJ (les `limit` lignes les plus coûteuses), et les tâches longues. */
function perf({ limit=20, reset=false }={}) {
  const out = { hooks: perfApi.report().slice(0, limit), longTasks: perfApi.longTasks() };
  if ( reset ) perfApi.reset();
  return out;
}

/** §93 : ce qu'un 1 naturel déclenche chez la créature (le jet lui-même ne se force pas) — sans l'attendre : le scénario répond. */
function naturalOne({ tokenId }) {
  naturalOneFor(tokenOf({ tokenId }).actor, "test").catch(err => console.error(err));
  return { started: true };
}

/** §90 : un test de compétence (`skill`) ou de caractéristique (`ability`), sans fenêtre ; ce qui suit le jet (dé ajouté) n'est pas attendu. */
async function rollCheck({ tokenId, skill=null, ability=null }) {
  const actor = tokenOf({ tokenId }).actor;
  const rolls = skill ? await actor.rollSkill({ skill }, { configure: false }) : await actor.rollAbilityCheck({ ability }, { configure: false });
  return { formula: rolls?.[0]?.formula ?? null, total: rolls?.[0]?.total ?? null, d20: rolls?.[0]?.d20?.total ?? null };
}

/** §23 : qui menacerait d'une attaque d'opportunité un déplacement en ligne droite jusqu'à ce point (noms). */
function threats({ tokenId, point }) {
  const token = tokenOf({ tokenId });
  const at = token.parent.grid.getTopLeftPoint(token.parent.grid.getOffset(point));
  const waypoints = [{ x: at.x, y: at.y, elevation: token._source.elevation, action: "walk" }];
  return opportunityThreats(token, waypoints).map(uuid => fromUuidSync(uuid, { strict: false })?.name ?? uuid);
}

/** §20 : le budget du tour d'un combattant (action, action Bonus, Foncer, Se désengager, Vitesse à 0, déplacement en plus). */
/** Ce qui cloche dans une utilisation (légalité du tour, états), sans l'utiliser ; `cost` force le coût (« bonus », « reaction »). */
function issues({ tokenId, itemId, activityType=null, cost=null }) {
  const item = tokenOf({ tokenId }).actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activité introuvable");
  return useIssues(activity, { cost }).lines;
}

function budget({ tokenId }) {
  const token = tokenOf({ tokenId });
  const combatant = token.actor ? combatantFor(token.actor) : null;
  return combatant ? { ...readBudget(combatant), combatantId: combatant.id, cap: finite(movementCap(token)) } : null;
}

/** Heure de chargement du code du moteur dans ce client : change à chaque rechargement. */
const BOOTED_AT = Date.now();

/**
 * L'état du client qui exécute (le MJ du connecteur) : version et heure de chargement du moteur, et s'il est le MJ actif
 * — celui qui exécute le moteur (`game.users.activeGM`). `tools/reload.mjs` s'en sert pour savoir que le F5 a eu lieu.
 */
function status() {
  return { version: game.modules.get(MODULE_ID)?.version ?? null, bootedAt: BOOTED_AT, ready: game.ready === true, worldTime: game.time?.worldTime ?? null,
    user: game.user.name, activeGM: game.users.activeGM?.id === game.user.id };
}

/**
 * Lance une macro (par son uuid : monde ou compendium « Outils du MJ », §56) sans attendre sa fin : ses fenêtres se lisent et se
 * répondent ensuite par `list-dialogs` / `answer-dialog` du connecteur. Réservé au MJ.
 */
async function runMacro({ uuid }={}) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const macro = await fromUuid(uuid);
  if ( !(macro instanceof Macro) ) throw new Error(`pas de macro : ${uuid}`);
  Promise.resolve(macro.execute()).catch(err => console.error(`${MODULE_ID} | macro « ${macro.name} »`, err));
  return { started: macro.name };
}

/**
 * Le F5 du client du MJ, pour qu'il relise le code du moteur après un changement : la réponse part avant le rechargement.
 * Réservé au MJ ; `call-module-api` n'existe que dans un monde où le réglage « Outils de test » du connecteur est activé.
 */
function reload() {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  setTimeout(() => window.location.reload(), 300);
  return { reloading: true, bootedAt: BOOTED_AT };
}

/**
 * §19.9 : sous quel identifiant le moteur reconnaît chaque item d'un token, d'où il le tient (item, source, compendium, nom) et
 * les clés de contenu qui s'y attachent — pour les items premium sans identifiant (Ravenloft), traduits par Babele.
 */
/**
 * L'inventaire des capacités du monde (acteurs du monde, pas les tokens non liés) : une ligne par identifiant et type d'item,
 * avec qui la porte, ce que le moteur en connaît (`rules` : les clés de contenu), ses activités, ses effets et le début de son
 * texte anglais d'origine. `types` filtre les types d'item (par défaut tout sauf l'équipement de base et le butin).
 */
function inventory({ types=null, textLength=700 }={}) {
  const skip = new Set(["loot", "container", "class", "subclass", "background", "race"]);
  const rows = new Map();
  for ( const actor of game.actors ) {
    if ( !["character", "npc"].includes(actor.type) ) continue;
    for ( const item of actor.items ) {
      if ( types ? !types.includes(item.type) : skip.has(item.type) ) continue;
      const { id, from } = identifierOf(item);
      const key = `${item.type}|${id ?? item.name}`;
      let row = rows.get(key);
      if ( !row ) {
        const text = String(item.flags?.babele?.originalPayload?.description ?? item.system?.description?.value ?? "")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        row = { identifier: id, from, type: item.type, names: [], actors: [], rules: Object.keys(contentOf(item).entry ?? {}),
          activities: Array.from(item.system.activities ?? []).map(a => a.type), effects: item.effects.size,
          level: item.system.level ?? null, source: item._stats?.compendiumSource ?? null, text: text.slice(0, textLength) };
        rows.set(key, row);
      }
      if ( !row.names.includes(item.name) ) row.names.push(item.name);
      row.actors.push(`${actor.name}${actor.hasPlayerOwner ? " (PJ)" : ""}`);
    }
  }
  return Array.from(rows.values()).sort((a, b) => (b.actors.length - a.actors.length) || String(a.identifier).localeCompare(String(b.identifier)));
}

function identify({ tokenId }) {
  const actor = tokenOf({ tokenId }).actor;
  return (actor?.items ?? []).map(item => {
    const { id, from } = identifierOf(item);
    return { item: item.name, id: item.id, identifier: id, from, rules: Object.keys(contentOf(item).entry ?? {}) };
  }).filter(r => r.rules.length || (r.from !== "item"));
}

/**
 * §36 : les jets notés du Présage d'un token — `roll: true` les lance comme au Repos long ; `rolls: [n…]` les fixe (scénario : des
 * valeurs connues) ; `clear: true` les efface. Rend le nombre de d20 du devin et son état.
 */
async function portent({ tokenId, roll=false, rolls=null, clear=false }) {
  const actor = tokenOf({ tokenId }).actor;
  if ( !actor ) throw new Error("token sans acteur");
  if ( clear ) await actor.unsetFlag(MODULE_ID, "portent");
  else if ( Array.isArray(rolls) ) await actor.setFlag(MODULE_ID, "portent", { rolls, turn: null });
  else if ( roll ) await rollPortent(actor);
  return { dice: portentDice(actor), ...portentOf(actor) };
}

/** §38.2 : l'échange de place du Troc du filou, comme l'entrée du menu (depuis l'illusion ou son lanceur) ; positions avant / après. */
async function transpose({ tokenId }) {
  const token = tokenOf({ tokenId });
  const at = t => ({ x: t._source.x, y: t._source.y });
  const before = at(token);
  const done = await transposeIntent(token);
  return { done, before, after: at(token) };
}

/**
 * Un réglage du moteur (et de lui seul) : rend la valeur d'avant, pour qu'un scénario la remette ; `value` absent : lecture seule.
 * Réservé au MJ (§38.4 : le scénario `presage` désactive le Présage le temps d'une partie).
 */
async function setting({ key, value }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  if ( !game.settings.settings.has(`${MODULE_ID}.${key}`) ) throw new Error(`réglage inconnu : ${key}`);
  const before = game.settings.get(MODULE_ID, key);
  if ( value !== undefined ) await game.settings.set(MODULE_ID, key, value);
  return { key, before, now: game.settings.get(MODULE_ID, key) };
}

/**
 * Les effets et sons en cours de Sequencer (module tiers : les animations de Boss Loot / BLFX), et la fin de ceux qu'on désigne —
 * pour que le lanceur de scénarios termine ce qu'un scénario a fait naître (vu le 2026-09-29 : le son en boucle de l'Aspersion acide
 * restait après le scénario `presage`). `Sequencer.EffectManager.effects` / `.endEffects({ effects: [ids] })`,
 * `Sequencer.SoundManager.sounds` / `.endSounds({ sounds: [ids] })` (sequencer.js 4.2.3 : 10723, 10842, 11538, 11626, 30899-30900) ; les
 * autres clients sont prévenus par Sequencer. Sans Sequencer : rien.
 */
async function sequencer({ end=null }={}) {
  const S = globalThis.Sequencer;
  if ( !S?.EffectManager || !S?.SoundManager ) return { available: false, effects: [], sounds: [] };
  if ( end?.effects?.length ) await S.EffectManager.endEffects({ effects: end.effects }).catch(() => null);
  if ( end?.sounds?.length ) await S.SoundManager.endSounds({ sounds: end.sounds });
  return {
    available: true,
    effects: (S.EffectManager.effects ?? []).map(e => ({ id: e.id, name: e.data?.name ?? null })),
    sounds: (S.SoundManager.sounds ?? []).map(s => ({ id: s.data?._id ?? s.id, name: s.data?.name ?? null }))
  };
}

/**
 * Une activité utilisée comme au clic (§47) : pose de zone de dnd5e comprise — à la différence de `use-activity` du connecteur,
 * qui la coupe (`create.measuredTemplate: false`). Sans emplacement ; la fenêtre de dnd5e, si elle s'ouvre, est relevée puis validée ; réactions du MJ refusées. Rend la carte
 * d'utilisation et les régions nées de cette activité dans les 3 s (une pose interactive, elle, attendrait un clic : rien).
 */
async function use({ tokenId, itemId, activityType=null, extra=null, consume=false }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activité introuvable");
  const before = new Set(canvas.scene.regions.map(r => r.id));
  const mine = () => canvas.scene.regions.filter(r => !before.has(r.id) && (r.getFlag("dnd5e", "activity") === activity.uuid));
  // La fenêtre d'utilisation de dnd5e, si elle s'ouvre, est relevée (avec ou sans case « Placer le gabarit ») puis validée.
  let dialog = null;
  const hook = Hooks.on("renderActivityUsageDialog", (app, element) => {
    dialog = { templateBox: !!element.querySelector('[name="create.measuredTemplate"]') };
    setTimeout(() => element.querySelector('button[type="submit"], [data-action="use"]')?.click(), 100);
  });
  let used;
  // `consume` : comme un vrai clic, ressources dépensées (§77 : sans charge, la fenêtre « Plus de charge » du MJ).
  try { used = await activity.use({ ...(consume ? {} : { consume: false }), [MODULE_ID]: { confirmed: true, autoReact: "none", ...(extra ?? {}) } }, { configure: true }); }
  finally { Hooks.off("renderActivityUsageDialog", hook); }
  for ( let i = 0; (i < 30) && !mine().length; i++ ) await new Promise(r => setTimeout(r, 100));
  return {
    messageId: used?.message?.id ?? null,
    dialog,
    regions: mine().map(r => ({ id: r.id, shapes: r.shapes.map(s => s.type), attachedTo: r.attachment?.token?.id ?? r.attachment?.token ?? null,
      elevation: { bottom: r.elevation.bottom, top: r.elevation.top } }))
  };
}

/**
 * §57 : une ruée en ligne droite (Frappe du vent) vers une case donnée (coin haut-gauche), sans la visée : le même contrôle de la
 * case, les mêmes cibles, la même utilisation sans gabarit. `preview: true` : seulement les cibles et ce qui refuserait la case
 * (`problem`, clé de traduction ou null), rien de lancé.
 */
async function dash({ tokenId, itemId, x, y, preview=false }) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const token = tokenOf({ tokenId });
  const activity = token.actor?.items.get(itemId)?.system.activities?.find(a => lineDashOf(a)) ?? null;
  if ( !activity ) throw new Error("pas de ruée en ligne droite sur cet item");
  if ( preview ) {
    const to = { x, y, elevation: token._source.elevation ?? 0 };
    const movement = token.actor.system.attributes?.movement;
    return { targets: dashTargets(token, to, lineDashOf(activity)).map(t => t.name),
      problem: dashProblem(token, to, Number(movement?.speeds?.walk ?? movement?.walk) || null)?.[0] ?? null };
  }
  const before = game.messages.contents.at(-1)?.id ?? null;
  const used = await dashStrike(activity, [{ consume: false, [MODULE_ID]: { confirmed: true, autoReact: "none" } }, {}, {}], { x, y });
  for ( let i = 0; (i < 30) && ((token._source.x !== x) || (token._source.y !== y)); i++ ) await new Promise(r => setTimeout(r, 100));
  const message = game.messages.contents.findLast(m => (m.type === "usage") && m.getFlag(MODULE_ID, "dash"));
  return { used, position: positionOf(token), messageId: (message && (message.id !== before)) ? message.id : null,
    targets: (message?.system.targets ?? []).map(t => t.name), regions: canvas.scene.regions.filter(r => r.getFlag("dnd5e", "activity") === activity.uuid).length };
}

/**
 * §58 : les dernières cartes du journal telles que le MJ les voit — type, repliée ou non (`display` calculé), résumé des jets
 * de la carte unique et verdict. Lecture seule.
 */
function chatCards({ count=6 }={}) {
  return game.messages.contents.slice(-count).map(m => {
    const li = document.querySelector(`#chat .chat-message[data-message-id="${m.id}"]`);
    return { id: m.id, type: m.type, origin: m._source.system?.origin ?? null, inLog: !!li,
      hidden: li ? (getComputedStyle(li).display === "none") : null,
      rolls: li ? [...li.querySelectorAll(".dnd5e-combat-rolls p")].map(p => p.textContent) : [],
      details: li?.querySelector(".dnd5e-combat-details")?.textContent ?? null,
      verdict: li ? [...li.querySelectorAll(".dnd5e-combat-result:not(.dnd5e-combat-rolls) p")].map(p => p.textContent) : [] };
  });
}

/** Ce que `api.mcp` expose. */
/** §53 : pour chaque effet d'un token, l'item d'origine que le moteur retrouve (item détruit : relu dans le message). */
function effectOrigins({ tokenId }) {
  const actor = tokenOf({ tokenId }).actor;
  return (actor?.effects ?? []).map(e => {
    const item = originItemOf(e);
    return { effect: e.name, origin: e.origin ?? null, systemOrigin: e.system?.origin ?? null, item: item?.name ?? null,
      identifier: item ? identifierOf(item).id : null };
  });
}

export const testApi = Object.freeze({ issues, planning, stormStrike, storm, placeRegionAt, effectOrigins, enchant, overrideContent, heal, hurt, rollSave, rollCheck, naturalOne, perf, threats, attackReasons, perceived, inventory, budget, identify, stairs, plan, movement, move, windows, closeWindow, view, reports, rollCard, status, reload, summonAt, stats, teleport, teleportPick, restoreItem, runMacro, saveChance, portent, transpose, dash, chatCards, setting, sequencer, stairsAt, takeStairs, follow, unfollow, followState, endings, actionEnd, use, familiar, familiarPocket, familiarRecall });
