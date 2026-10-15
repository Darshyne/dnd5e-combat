/**
 * La souris du moteur : clics gauche et droit sur le canevas, aperçu du chemin et curseur au survol, ruée, rappel,
 * téléportation, touches. Extrait d'ui/pointer.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { footprintGap } from "../core/movement.mjs";
import { positionOf, distanceBetween } from "../adapter/turn.mjs";
import { planPath, previewPath, cellUnder, footprintOf, stairsEntry, stairsDestinations } from "../adapter/movement.mjs";
import { strike } from "../runtime/storm.mjs";
import { movementCap, reachCells, basicAttack, hostileTo, moveTo, approaches, contactAction, contactRefusal, rangeStatus, currentTeleport, teleportClick, dashStrike, dashRefusal, dashPreview } from "../runtime/actions.mjs";
import { pocketedFamiliar, recallFamiliar, recallRefusal } from "../runtime/familiar.mjs";
import { leapProblem } from "../runtime/projectiles.mjs";
import { tetherOfActivity, tetheredToken } from "../adapter/tether.mjs";
import { closeLegalityDialogs, openLegalityDialogs } from "../runtime/turn.mjs";
import { doorState, setDoorOpen } from "../runtime/doors.mjs";
import { cleaveCandidates } from "../adapter/mastery.mjs";
import { cancelPendingRoll, pendingRoll } from "../runtime/cancel.mjs";
import { loc } from "../runtime/shared.mjs";
import { showHitChance, showSaveChance, hideHitChance, showBadge } from "./hitchance.mjs";
import { floatNotice } from "./feedback.mjs";
import { actingToken, busy, dashing, engageWith, exclusive, finishGroup, inCombat, interruptWalk, markTargeting, openRecall, pickTarget, picking, placing, promptTargeting, recalling, setReticleRefused, setting, stopTargeting, targetTypeRefusal, targeting } from "./pointer.mjs";
import { closeMenu, doorEntries, groundEntries, hasSelfMenu, hoveredDoor, menu, openMenu, openTokenMenu, selfEntries, stairsEntries } from "./pointer-menu.mjs";
import { clearTargets } from "./pointer-offers.mjs";

/* -------------------------------------------- */
/*  Souris                                      */
/* -------------------------------------------- */

const onBoard = event => !!canvas.ready && (event.target === canvas.app?.view);
const plain = event => !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
/** Un clic d'attaque accepte Alt et Ctrl : ce sont les touches d'avantage et de désavantage de dnd5e (§15.1). */
const attackClick = event => !event.shiftKey && !event.metaKey;

/** Une touche d'avantage ou de désavantage de dnd5e (réglable dans ses raccourcis) est-elle tenue ? */
function keyHeld(event, action) {
  try { return !!event && dnd5e.utils.areKeysPressed(event, action); }
  catch { return false; }
}

/**
 * Les touches que le jet lira : celles tenues maintenant (dnd5e consulte aussi le clavier au moment du
 * jet) et, en mode visée, celles du clic qui a choisi l'action (fiche, barre d'actions), que l'utilisation
 * suspendue emporte jusqu'au jet.
 */
function heldKeys(event) {
  const origin = targeting?.usage?.[0]?.event;
  return {
    advantage: keyHeld(event, "skipDialogAdvantage") || keyHeld(origin, "skipDialogAdvantage"),
    disadvantage: keyHeld(event, "skipDialogDisadvantage") || keyHeld(origin, "skipDialogDisadvantage")
  };
}
const selecting = () => canvas.tokens?.active && (ui.controls?.tool?.name ?? game.activeTool ?? "select") === "select";
const scenePoint = event => canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });

function clickMoveAllowed() {
  const mode = setting("clickToMove");
  return (mode === "always") || ((mode === "combat") && inCombat());
}

/**
 * Le clic d'attaque vaut-il maintenant ? Réglage « always » / « combat » / « off » (§100) ; une valeur booléenne enregistrée
 * avant (case à cocher, vraie = en combat seulement) est relue comme telle.
 */
function clickAttackAllowed() {
  let mode = setting("clickToAttack");
  // Relue en texte par un réglage devenu String (« true » / « false », vu le 2026-10-06), ou en booléen.
  if ( (mode === true) || (mode === "true") ) mode = "combat";
  else if ( (mode === false) || (mode === "false") ) mode = "off";
  return (mode === "always") || ((mode === "combat") && inCombat());
}

function clickAttackApplies(me, other) {
  // §110 : chez le MJ, le clic gauche sur un token reste celui du cœur (sélection) ; ses actions passent par le clic droit.
  if ( game.user.isGM ) return false;
  return clickAttackAllowed() && hostileTo(me, other) && !!basicAttack(me.actor);
}

export let down = null;
const LONG_PRESS_MS = 350;

function swallow(event) {
  event.stopImmediatePropagation();
  event.preventDefault();
}

/** Une visée qui attend un clic du joueur (cible, projectiles ou groupe, ruée, rappel d'un familier) ; pas la pose d'une zone. */
const aimingByClick = () => !!(targeting || picking || dashing || recalling);

/** Fermer la visée en cours ; une visée multiple relâche aussi les cibles déjà choisies. */
function cancelAiming() {
  if ( picking ) clearTargets();
  stopTargeting();
}

/** Une action en cours qu'un clic droit annulerait (hors mode visée) : dialogue de légalité, jet pas encore lancé. */
export const cancellable = () => (openLegalityDialogs().length > 0) || !!pendingRoll();

/** Clic droit (§15.1) : le dialogue de légalité se ferme (« Renoncer »), ou le jet pas encore lancé est annulé. */
async function cancelInProgress() {
  if ( await closeLegalityDialogs() ) return ui.notifications.info(loc("Visee.Annulee"));
  await cancelPendingRoll();
}

/**
 * Le cœur planifie un déplacement (téléportation native de dnd5e, §16.10 : Token#planMovement pose
 * `canvas.tokens._movementPlanningContext`) : ses clics valident la destination, la souris du moteur s'efface.
 */
const corePlanning = () => !!canvas?.tokens?._movementPlanningContext;

export function onPointerDown(event) {
  // §67 ter : pendant la visée d'une téléportation, un clic gauche au sol choisit la destination (le cœur n'accepte qu'un glisser
  // du token, qui reste possible : un clic sur le token lui-même est laissé au cœur).
  const tp = currentTeleport();
  if ( tp && corePlanning() && (event.button === 0) && onBoard(event) && (hoveredToken()?.id !== tp.token.id) ) {
    down = null;
    teleportClick(scenePoint(event));
    return;
  }
  if ( corePlanning() || placing ) { down = null; return; }
  if ( menu && !menu.contains(event.target) ) closeMenu();
  hideHitChance();
  lastHoverKey = null;
  down = null;
  if ( !onBoard(event) || ![0, 2].includes(event.button) ) return;
  down = { x: event.clientX, y: event.clientY, button: event.button, at: Date.now() };
  if ( aimingByClick() || ((event.button === 2) && cancellable()) ) return swallow(event);
  // §39.3 : un module voisin peut réclamer un clic gauche (fouiller un coffre, un cadavre, un tas au sol — Darsh Loot) en
  // répondant `false` au hook `dnd5e-combat.claimClick` (appelé par Hooks.call) : le moteur l'ignore alors entièrement (ni
  // déplacement, ni attaque). Le moteur ne connaît aucun de ces modules ; sans eux, rien ne change.
  if ( (event.button === 0) && (Hooks.call(`${MODULE_ID}.claimClick`, event) === false) ) { down = null; return; }
  const me = actingToken();
  const hover = hoveredToken();
  // Clic droit sur son propre token agrippé ou objet piloté : le menu (S'échapper, Renvoyer) au lieu du HUD du cœur.
  if ( me && (hover === me) && (event.button === 2) && plain(event) && selecting() && hasSelfMenu(me) ) return swallow(event);
  // §18.24 : clic droit sur une porte, un token en main — le menu de porte au lieu du verrou du cœur (MJ).
  if ( me && !hover && (event.button === 2) && plain(event) && selecting() && hoveredDoor() ) return swallow(event);
  // §18.25 : clic gauche sur une porte, quand un clic déplace — s'avancer puis l'ouvrir ou la fermer, pas l'ouvrir de loin.
  if ( me && !hover && (event.button === 0) && plain(event) && selecting() && hoveredDoor() && clickMoveAllowed() ) return swallow(event);
  if ( !me || !hover || (hover === me) || !selecting() ) return;
  // Le moteur prend ce clic : ni sélection du token visé (MJ), ni HUD de token.
  if ( ((event.button === 2) && plain(event)) || ((event.button === 0) && attackClick(event) && clickAttackApplies(me, hover)) ) swallow(event);
}

export function onPointerUp(event) {
  const start = down;
  down = null;
  if ( corePlanning() || placing ) return;
  if ( !start || (start.button !== event.button) || !onBoard(event) ) return;
  if ( Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ) return;   // c'était un glisser
  // Un appui long est le ping du cœur (500 ms) : ce n'est pas un ordre de déplacement.
  if ( !aimingByClick() && ((Date.now() - start.at) > LONG_PRESS_MS) ) return;
  if ( !targeting && !picking && (event.button === 2) && cancellable() ) return exclusive(cancelInProgress);
  const hover = hoveredToken();
  const left = event.button === 0;

  // Clic droit pendant une visée : elle se ferme.
  if ( !left && aimingByClick() ) {
    cancelAiming();
    return ui.notifications.info(loc("Visee.Annulee"));
  }
  if ( dashing ) return dashTo(scenePoint(event));
  if ( recalling ) return recallTo(scenePoint(event));
  if ( picking ) return pickTarget(hover);
  if ( targeting ) {
    if ( !hover ) return;
    // §16.29 : un refus (hors de portée, rebond impossible) laisse la visée ouverte.
    const refusal = refusalFor(targeting.token, hover, targeting.activity, targeting.usage?.[0]);
    if ( refusal ) return floatNotice(hover, refusal, "refused");
    const { token, activity, usage } = targeting;
    stopTargeting();
    return exclusive(() => engageWith(token, hover, activity, { usage, event }));
  }

  const me = actingToken();
  if ( !me || !selecting() ) return;
  // §99 : le token marche encore — un clic gauche au sol l'envoie ailleurs, sur un ennemi l'y fait attaquer, tout autre clic
  // l'arrête sur place.
  if ( busy ) {
    const point = scenePoint(event);
    if ( left && hover && (hover !== me) && attackClick(event) && clickAttackApplies(me, hover) ) {
      if ( interruptWalk(me, () => engageWith(me, hover, basicAttack(me.actor).activity, { event })) ) return;
    }
    else if ( left && !hover && plain(event) && clickMoveAllowed() ) {
      if ( interruptWalk(me, () => moveTo(me, point)) ) { lastHoverKey = null; return; }
    }
    else if ( interruptWalk(me) ) return;
  }
  if ( left ) {
    if ( hover && (hover !== me) && attackClick(event) && clickAttackApplies(me, hover) ) {
      return exclusive(() => engageWith(me, hover, basicAttack(me.actor).activity, { event }));
    }
    const door = (!hover && plain(event) && clickMoveAllowed()) ? hoveredDoor() : null;
    if ( door ) return exclusive(() => setDoorOpen(me, door, doorState(door) !== "open"));
    // §41.2 : un escalier — on le prend d'un clic (un seul niveau au bout), ou l'on choisit le niveau (ascenseur).
    const steps = (!hover && plain(event)) ? stairsEntries(me, scenePoint(event)) : [];
    if ( steps.length === 1 ) { lastHoverKey = null; return exclusive(() => steps[0].run(event)); }
    if ( steps.length > 1 ) return openMenu(event, steps);
    if ( !hover && plain(event) && clickMoveAllowed() ) { lastHoverKey = null; return exclusive(() => moveTo(me, scenePoint(event))); }
    return;
  }
  if ( !plain(event) ) return;
  if ( hover && (hover === me) && hasSelfMenu(me) ) return openMenu(event, selfEntries(me));
  if ( hover && (hover !== me) ) return openTokenMenu(event, me, hover);
  const door = hover ? null : hoveredDoor();
  if ( door ) return openMenu(event, doorEntries(me, door));
  if ( !hover ) openMenu(event, groundEntries(me, scenePoint(event)));
}

/* ---- aperçu du chemin, en combat ---- */

let lastHoverKey = null;
let previewed = null;

export function clearPreview() {
  if ( previewed ) previewPath(previewed, null);
  previewed = null;
  lastHoverKey = null;
  hideHitChance();
  setCursor(null);
}

/** Le canevas se démonte : l'aperçu et le survol n'ont plus d'objet (rien à effacer). */
export function forgetHover() {
  previewed = null;
  lastHoverKey = null;
}

/**
 * Curseur selon ce qu'un clic ferait (§15.3) : se déplacer, attaquer au contact ou à distance, lancer
 * un sort, hors de portée, impossible. Un attribut sur `body`, que la feuille de style traduit en
 * curseur SVG du module sur le canevas (`#board`). null : le curseur de Foundry (ou la mire de la visée).
 */
export function setCursor(kind) {
  const wanted = (kind && setting("situationalCursor")) ? kind : null;
  if ( (document.body.dataset.dnd5eCombatCursor ?? null) === wanted ) return;
  if ( wanted ) document.body.dataset.dnd5eCombatCursor = wanted;
  else delete document.body.dataset.dnd5eCombatCursor;
}

/** Le token sous la souris. */
function hoveredToken() {
  return canvas.tokens.hover?.document ?? null;
}

/**
 * §16.29 : ce qu'un clic sur cette créature donnerait, hors du corps à corps (qui s'approche) — null si rien ne s'y oppose,
 * sinon le texte du refus (« Hors de portée », « Hors de vue », ou celui du rebond : « Déjà visé… », « … à plus de 30 ft »).
 */
export function refusalFor(me, hover, activity, usageConfig=null) {
  const wrongTarget = targetTypeRefusal(me, hover, activity);
  if ( wrongTarget ) return wrongTarget;
  // §16.43 : l'action suivante d'un lien (Trait ensorcelé) ne vise que la créature liée.
  if ( tetherOfActivity(activity)?.role === "follow" ) {
    const bound = tetheredToken(activity.item);
    if ( !bound || (bound !== hover) ) return loc("Retour.PasLiee");
  }
  // §21 : Enchaînement — seulement une créature à 1,50 m de la première et à l'allonge (adapter/mastery.mjs).
  const cleave = usageConfig?.[MODULE_ID]?.cleave;
  if ( cleave ) {
    const first = fromUuidSync(cleave, { strict: false });
    if ( !first || !cleaveCandidates(me, first, activity).includes(hover) ) return loc("Botte.Enchainement.Refus");
  }
  const leap = usageConfig?.[MODULE_ID]?.leap;
  if ( leap ) {
    const problem = leapProblem(activity, leap, hover);
    if ( problem ) return problem.replace(/^[^:]*:\s*/, "");
  }
  const contact = contactRefusal(me, hover, activity);
  if ( contact ) return contact;
  if ( approaches(activity) ) return null;
  const status = rangeStatus(me, hover, activity);
  if ( status?.out ) return loc("Retour.HorsDePortee");
  if ( status?.blind ) return loc("Retour.NonVue");
  return null;
}

/** La case d'arrivée d'une ruée sous ce point : le coin haut-gauche d'un token de sa taille, centré sur le point. */
function dashCell(point) {
  const grid = dashing.token.parent.grid;
  return grid.getTopLeftPoint(cellUnder(dashing.token, point));
}

/** §57 : au survol, ce qui refuse la case, ou les créatures que la ruée toucherait. */
function dashHover(event) {
  const at = dashCell(scenePoint(event));
  const key = `dash|${at.x},${at.y}`;
  if ( key === lastHoverKey ) return;
  lastHoverKey = key;
  const refusal = dashRefusal(dashing.activity, at);
  if ( refusal ) {
    setCursor("outOfRange");
    return showBadge(event, refusal.short);
  }
  setCursor(null);
  const names = dashPreview(dashing.activity, at).map(t => t.name);
  showBadge(event, names.length ? names.join(", ") : loc("Ruee.Personne"));
}

/** §57 : un clic sur la case d'arrivée — refusée, la visée reste ouverte ; acceptée, la ruée part. */
function dashTo(point) {
  const at = dashCell(point);
  const refusal = dashRefusal(dashing.activity, at);
  if ( refusal ) { ui.notifications.warn(refusal.text); return floatNotice(dashing.token, refusal.short, "refused"); }
  const { activity, usage } = dashing;
  stopTargeting();
  return exclusive(() => dashStrike(activity, usage, at)).catch(err => console.error(`${MODULE_ID} | dash strike`, err));
}

/** §107 : au survol, ce qui refuse la case de réapparition du familier, ou son nom. */
function recallHover(event) {
  const point = scenePoint(event);
  const cell = recalling.token.parent.grid.getOffset(point);
  const key = `recall|${cell.i},${cell.j}`;
  if ( key === lastHoverKey ) return;
  lastHoverKey = key;
  const refusal = recallRefusal(recalling.token, point);
  setCursor(refusal ? "outOfRange" : null);
  showBadge(event, refusal ?? pocketedFamiliar(recalling.token)?.name ?? "");
}

/** §107 : la case du familier qui revient — refusée, la visée reste ouverte ; acceptée, il réapparaît. */
function recallTo(point) {
  const { token } = recalling;
  const refusal = recallRefusal(token, point);
  if ( refusal ) return floatNotice(token, refusal, "refused");
  stopTargeting();
  return exclusive(() => recallFamiliar(token, point));
}

/** §107 : « Rappeler » — la case se choisit d'un clic (9 m autour du maître), clic droit ou Échap pour renoncer. */
export function startRecall(token) {
  if ( !canvas.ready || !token?.object ) return;
  stopTargeting();
  const familiar = pocketedFamiliar(token);
  promptTargeting(loc("Familier.Choisir", { name: familiar?.name ?? "" }));
  openRecall(token);
  markTargeting();
}

/** §16.29 : pendant le choix de la destination d'une téléportation (cœur), la portée se lit au curseur. */
function teleportHover(event) {
  const tp = currentTeleport();
  if ( !tp || !corePlanning() || !tp.token?.parent || (tp.limit === null) ) return false;
  const grid = tp.token.parent.grid;
  const cell = cellUnder(tp.token, scenePoint(event));
  const at = grid.getTopLeftPoint(cell);
  const far = distanceBetween(tp.token, tp.token, { posB: { x: at.x, y: at.y } }).value > tp.limit + 1e-6;
  setCursor(far ? "outOfRange" : null);
  if ( far ) showBadge(event, loc("Retour.HorsDePortee"));
  else hideHitChance();
  return true;
}

/**
 * Survol : aperçu du chemin (en combat) et chance de toucher (§15.3) quand un clic sur ce token
 * lancerait une attaque — attaque de base en combat, ou activité en attente en mode visée. Si le
 * clic ferait d'abord approcher, la chance est calculée depuis la case d'arrivée, comme `engage`.
 */
export const onPointerMove = foundry.utils.throttle(event => {
  if ( onBoard(event) && teleportHover(event) ) return;
  if ( dashing ) return onBoard(event) ? dashHover(event) : undefined;
  if ( recalling ) return onBoard(event) ? recallHover(event) : undefined;
  if ( busy || !onBoard(event) || event.buttons || !selecting() ) return clearPreview();
  // §16.14 : la pose du cœur montre la zone sous la souris — ni chemin ni chance de toucher.
  if ( placing ) return clearPreview();
  const me = picking?.token ?? targeting?.token ?? actingToken();
  if ( !me?.object || me.object.animationContexts?.has(me.object.movementAnimationName) ) return clearPreview();
  const hover = hoveredToken();
  const point = scenePoint(event);
  const cell = cellUnder(me, point);
  const keys = heldKeys(event);
  // §41.2 : le bord d'un escalier peut couper une case — le curseur suit le point, pas la case.
  const onStairs = !hover && !targeting && !picking && (stairsDestinations(me, point).length > 0);
  const id = `${me.id}|${hover?.id ?? ""}|${cell.i},${cell.j}|${(picking ?? targeting)?.activity.uuid ?? ""}|${picking?.picks.length ?? ""}|${keys.advantage}${keys.disadvantage}|${onStairs}`;
  if ( id === lastHoverKey ) return;
  lastHoverKey = id;

  const preview = inCombat() && setting("pathPreview");
  let plan = null;
  let cursor = null;
  hideHitChance();
  if ( !hover || (hover === me) ) setReticleRefused(false);
  // En mode visée, le lanceur est une cible comme une autre (Invisibilité sur soi) : son type de cible en décide.
  if ( hover && ((hover !== me) || targeting || picking) ) {
    const activity = (picking ?? targeting)?.activity ?? (clickAttackApplies(me, hover) ? basicAttack(me.actor).activity : null);
    // §16.29 : hors du corps à corps, pas d'approche — la portée se lit telle quelle, et un refus s'annonce au curseur.
    const refusal = activity ? refusalFor(me, hover, activity, targeting?.usage?.[0]) : null;
    setReticleRefused(!!refusal);
    if ( refusal ) {
      setCursor(refusal === loc("Retour.HorsDePortee") ? "outOfRange" : "invalid");
      showBadge(event, refusal);
      if ( previewed ) previewPath(previewed, null);
      previewed = null;
      return;
    }
    const reach = activity ? reachCells(activity) : null;
    const gap = reach ? footprintGap(footprintOf(me), footprintOf(hover)) : 0;
    const far = !!reach && (gap > reach.normal) && approaches(activity);
    if ( far ) plan = planPath(me, { target: hover, reachCells: reach.normal }, { maxCost: movementCap(me) });
    // Comme `engage` : hors de portée si l'approche n'arrive pas et que la cible est au-delà de la portée longue.
    // §18.22 : un geste de contact (mains nues, Lutte, Soutien) n'avance que s'il arrive.
    const outOfReach = far && !plan?.arrives && (contactAction(activity) || (gap > reach.long));
    if ( activity?.type === "attack" ) {
      const end = (far && plan?.arrives) ? plan.waypoints.at(-1) : null;
      showHitChance(event, me, hover, activity, { posA: end ? positionOf(end) : undefined, outOfReach, keys });
    }
    // §15.3 : une sauvegarde — la chance que la cible la rate (le mode visée ne vise qu'avec une activité choisie).
    else if ( activity?.type === "save" ) showSaveChance(event, me, hover, activity, { outOfReach });
    if ( activity ) {
      cursor = outOfReach ? "outOfRange"
        : (activity.type !== "attack") ? "spell"
        : (activity.attack?.type?.value === "ranged") ? "ranged" : "melee";
    }
  }
  else if ( !hover && !targeting && hoveredDoor() ) cursor = null;   // §18.25 : l'icône de porte garde le curseur du cœur
  // §41.2 : un escalier que le token peut prendre — le clic l'y mène, que le clic-déplacement soit actif ou non.
  else if ( onStairs ) {
    cursor = "stairs";
    if ( preview ) {
      const stairs = stairsEntry(me, cell);
      plan = planPath(me, stairs ? { cells: stairs.around, level: stairs.level } : { cell }, { maxCost: movementCap(me), throughDoors: true });
    }
  }
  else if ( !hover && !targeting && clickMoveAllowed() ) {
    // §18.26 : sur un escalier, l'aperçu va jusqu'à la case voisine (le dernier pas y entre en marchant).
    const stairs = preview ? stairsEntry(me, cell) : null;
    if ( preview ) plan = planPath(me, stairs ? { cells: stairs.around, level: stairs.level } : { cell }, { maxCost: movementCap(me), throughDoors: true });
    // En combat, on sait si le clic mènera quelque part : aucun chemin, ou plus de déplacement ce tour.
    cursor = (preview && (!plan || (!plan.waypoints.length && !plan.arrives))) ? "invalid" : "move";
  }
  setCursor(cursor);
  if ( !preview ) {
    if ( previewed ) previewPath(previewed, null);
    previewed = null;
    return;
  }
  if ( previewed && (previewed !== me) ) previewPath(previewed, null);
  previewPath(me, plan);
  previewed = plan ? me : null;
}, 60);

/** Alt ou Ctrl pressé ou relâché sans bouger la souris : la chance affichée suit (après que Foundry a noté la touche). */
export let lastPointer = null;
/** Le dernier mouvement de la souris, pour rejouer le survol quand une touche change (`onModifierKey`). */
export function trackPointer(event) {
  lastPointer = event;
}

export function onModifierKey(event) {
  if ( !["Alt", "Control", "Meta", "OS"].includes(event.key) || !lastPointer ) return;
  setTimeout(() => onPointerMove({ target: lastPointer.target, clientX: lastPointer.clientX, clientY: lastPointer.clientY,
    buttons: 0, altKey: event.type === "keydown" ? event.altKey || event.key === "Alt" : event.altKey && event.key !== "Alt",
    ctrlKey: event.type === "keydown" ? event.ctrlKey || event.key === "Control" : event.ctrlKey && event.key !== "Control",
    shiftKey: event.shiftKey, metaKey: event.metaKey }), 0);
}

export function onKeyDown(event) {
  onModifierKey(event);
  // §16.33 : Entrée lance un sort de groupe avec les créatures déjà choisies (« jusqu'à cinq créatures »).
  if ( (event.key === "Enter") && picking?.group && picking.picks.length ) { swallow(event); return finishGroup(); }
  if ( event.key !== "Escape" ) return;
  if ( menu ) { closeMenu(); swallow(event); }
  else if ( aimingByClick() ) {   // une zone en cours de pose : Échap est au cœur
    cancelAiming();
    swallow(event);
  }
}
