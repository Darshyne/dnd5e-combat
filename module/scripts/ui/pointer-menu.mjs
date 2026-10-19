/**
 * Le menu contextuel du moteur (clic droit) : déplacement, saut, attaques, portes, escaliers, soi-même, familier, suivre, fins
 * d'effets. Extrait d'ui/pointer.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { canBeThrown } from "../adapter/turn.mjs";
import { areAdjacent } from "../adapter/conditions.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { isNonLethal, isKnockedOut, setNonLethal } from "../adapter/knockout.mjs";
import { firstAid } from "../runtime/knockout.mjs";
import { stairsDestinations } from "../adapter/movement.mjs";
import { grappleShoveOf, unarmedAttackOf, helpActivityOf } from "../adapter/basics.mjs";
import { pilotOf, commandActivities, commandLabel, transposeOf } from "../adapter/pilot.mjs";
import { grappleEffectsOf, grapplerOf } from "../adapter/grapple.mjs";
import { weaponAttacks, hostileTo, moveTo, jumpTo, transpose, takeStairs } from "../runtime/actions.mjs";
import { leaderOf, canFollow, follow, unfollow } from "../runtime/follow.mjs";
import { canDismiss, dismissPilot, useCommand } from "../runtime/pilot.mjs";
import { canPocket, canRecall, pocketedFamiliar, dismissFamiliar } from "../runtime/familiar.mjs";
import { revertActivityOf } from "../adapter/wildshape.mjs";
import { traceAttacks } from "../adapter/traces.mjs";
import { tetheredToken, tetherItems, tetherRuleOf } from "../adapter/tether.mjs";
import { leaveForm } from "../runtime/wildshape.mjs";
import { canStandUp, standUp } from "../runtime/prone.mjs";
import { escapableRestraintsOf } from "../adapter/escape.mjs";
import { escapeGrapple, holdsOf, releaseGrapple } from "../runtime/grapple.mjs";
import { ownEndingsOf, endingsOn, endFor } from "../runtime/action-end.mjs";
import { doorState, setDoorOpen, setDoorLocked, pickLock, forceDoor } from "../runtime/doors.mjs";
import { swallowerOf } from "../adapter/swallow.mjs";
import { loc, notice } from "../runtime/shared.mjs";
import { effectOfProfile } from "../adapter/usage.mjs";
import { wallsOfCaster } from "../adapter/wall-side.mjs";
import { flipWallSide } from "../runtime/wall-side.mjs";
import { pickUpEntries } from "../runtime/scatter.mjs";
import { igniteEntries } from "../runtime/flammable.mjs";
import { burningEntries } from "../runtime/burning.mjs";
import { climbEntries } from "../runtime/climb.mjs";
import { actingToken, engageWith, exclusive, inCombat, observe } from "./pointer.mjs";
import { down, startRecall } from "./pointer-mouse.mjs";

/* -------------------------------------------- */
/*  Menu contextuel                             */
/* -------------------------------------------- */

export let menu = null;
/**
 * §16.44 : le menu d'un token neutre ou amical cache ses actions offensives ; **une fois le menu ouvert**, Maj tenue les montre
 * (relâchée, elles se cachent). `{ point, build(aggressive), hidden, shown }`, ou null.
 */
let menuSource = null;
export function closeMenu() {
  menu?.remove();
  menu = null;
  menuSource = null;
}

/** La ligne d'aide d'un menu dont les actions offensives sont cachées. */
const shiftHint = () => ({ hint: true, icon: "fa-solid fa-keyboard", label: loc("Menu.MajOffensives") });

export function openMenu(event, entries, source=null) {
  closeMenu();
  if ( !entries.length ) return;
  renderMenu({ clientX: event.clientX, clientY: event.clientY }, entries);
  menuSource = source;
}

function renderMenu(point, entries) {
  menu = document.createElement("nav");
  menu.classList.add("dnd5e-combat-menu");
  for ( const entry of entries ) {
    if ( entry.hint ) {
      const hint = document.createElement("div");
      hint.classList.add("hint");
      hint.innerHTML = `<i class="${entry.icon}"></i> <span></span>`;
      hint.querySelector("span").textContent = entry.label;
      menu.append(hint);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="${entry.icon}"></i> <span></span>`;
    button.querySelector("span").textContent = entry.label;
    button.addEventListener("click", event => { closeMenu(); exclusive(() => entry.run(event)); });
    menu.append(button);
  }
  document.body.append(menu);
  const { offsetWidth: w, offsetHeight: h } = menu;
  menu.style.left = `${Math.min(point.clientX, window.innerWidth - w - 4)}px`;
  menu.style.top = `${Math.min(point.clientY, window.innerHeight - h - 4)}px`;
}

/**
 * §16.44 : le menu d'une autre créature. Les actions offensives (attaques, mains nues, sorts d'attaque) n'y sont d'emblée que
 * contre une créature hostile ; sur une créature neutre ou amicale, Maj tenue une fois le menu ouvert les montre.
 */
export function openTokenMenu(event, me, target) {
  const hostile = hostileTo(me, target);
  const build = aggressive => withNeighbourEntries(tokenEntries(me, target, { aggressive: hostile || aggressive }), me, target,
    hostile || aggressive);
  const calm = build(false);
  const hidden = !hostile && (build(true).length > calm.length);
  const point = { clientX: event.clientX, clientY: event.clientY };
  openMenu(event, hidden ? [...calm, shiftHint()] : calm, hidden ? { point, build, hidden, shown: false } : null);
}

/**
 * §41.4 : les entrées du menu contextuel d'un token, pour une interface qui veut les offrir ailleurs que sur le canevas
 * (le portrait du Groupe de Darsh UI DnD5) : ce que le token en main (le seul contrôlé, à soi) peut faire de celui-là —
 * les mêmes que le clic droit, entrées des modules voisins comprises, sans les actions offensives sur une créature qui
 * n'est pas hostile. Vide sans token en main, ou sur une autre scène. `run(event)` joue l'entrée (une à la fois).
 * @param {Token|TokenDocument} target
 * @returns {{icon: string, label: string, run: (event?: Event) => void}[]}
 */
export function menuEntriesFor(target) {
  const me = actingToken();
  const doc = target?.document ?? target;
  if ( !me || !doc?.parent || (doc.parent !== me.parent) ) return [];
  const hostile = (doc !== me) && hostileTo(me, doc);
  const raw = (doc === me) ? selfEntries(me) : withNeighbourEntries(tokenEntries(me, doc, { aggressive: hostile }), me, doc, hostile);
  return raw.filter(e => !e.hint).map(e => ({ icon: e.icon, label: e.label, run: event => exclusive(() => e.run(event)) }));
}

/**
 * §39.4 : les modules voisins ajoutent leurs entrées au menu d'un token (Darsh Loot : « Échanger » sur un autre PJ) par le
 * hook `dnd5e-combat.tokenMenu` — `(entries, { token, target, aggressive })`, chaque entrée `{ icon, label, run(event) }`
 * poussée dans `entries`. Le moteur n'en connaît aucun ; sans inscrit, le menu est le sien. Le hook peut partir plusieurs fois
 * pour un même clic droit (le menu se construit, puis se reconstruit avec Maj, et `api.ui` lit ses entrées) : un écouteur ne fait
 * qu'ajouter des entrées, sans autre effet — l'action va dans `run`.
 */
function withNeighbourEntries(entries, token, target, aggressive) {
  Hooks.callAll(`${MODULE_ID}.tokenMenu`, entries, { token, target, aggressive });
  return entries.filter(e => e && (typeof e.run === "function") && e.label);
}

/** Maj enfoncée ou relâchée, menu ouvert : les actions offensives paraissent ou se cachent. */
export function onMenuShift(event) {
  if ( (event.key !== "Shift") || !menu || !menuSource?.hidden ) return;
  const shown = event.type === "keydown";
  if ( shown === menuSource.shown ) return;
  const source = menuSource;
  menu.remove();
  renderMenu(source.point, shown ? source.build(true) : [...source.build(false), shiftHint()]);
  source.shown = shown;
  menuSource = source;
}

/**
 * §18.24 : la porte sous la souris — le cœur note dans `canvas.walls.hover` le mur dont on survole l'icône de porte
 * (door-control.mjs, `_onMouseOver`, seulement pour qui a le droit « WALL_DOORS »).
 */
export function hoveredDoor() {
  const wall = canvas.walls?.hover;
  return (wall?.isDoor && wall.doorControl?.visible !== false) ? wall : null;
}

/** Ouvrir / fermer ; devant une porte verrouillée, crocheter et forcer ; pour le MJ, verrouiller / déverrouiller. */
export function doorEntries(token, wall) {
  const state = doorState(wall);
  const entries = [];
  if ( state === "open" ) entries.push({ icon: "fa-solid fa-door-closed", label: loc("Menu.Fermer"), run: () => setDoorOpen(token, wall, false) });
  else entries.push({ icon: "fa-solid fa-door-open", label: loc("Menu.Ouvrir"), run: () => setDoorOpen(token, wall, true) });
  if ( state === "locked" ) {
    entries.push({ icon: "fa-solid fa-key", label: loc("Menu.Crocheter"), run: event => pickLock(token, wall, { event }) });
    entries.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.Forcer"), run: event => forceDoor(token, wall, { event }) });
  }
  if ( game.user.isGM && (state !== "open") ) {
    const locked = state === "locked";
    entries.push({ icon: locked ? "fa-solid fa-lock-open" : "fa-solid fa-lock", label: loc(locked ? "Menu.Deverrouiller" : "Menu.Verrouiller"),
      run: () => setDoorLocked(wall, !locked) });
  }
  return entries;
}

/**
 * §41.2 : sur un escalier, une échelle ou un ascenseur — une entrée par niveau où il mène (« Monter », « Descendre »).
 */
const STAIRS_ICONS = { up: "fa-solid fa-arrow-up-right-dots", down: "fa-solid fa-arrow-down-wide-short", level: "fa-solid fa-right-left" };
const STAIRS_LABELS = { up: "Menu.Monter", down: "Menu.Descendre", level: "Menu.Rejoindre" };
export function stairsEntries(token, point) {
  return stairsDestinations(token, point).map(d => ({ icon: STAIRS_ICONS[d.direction], label: loc(STAIRS_LABELS[d.direction], { level: d.name }),
    run: () => takeStairs(token, point, d.id) }));
}

export function groundEntries(token, point) {
  return [
    ...stairsEntries(token, point),
    { icon: "fa-solid fa-person-walking", label: loc("Menu.SeDeplacer"), run: () => moveTo(token, point) },
    { icon: "fa-solid fa-person-running", label: loc("Menu.Sauter"), run: () => jumpTo(token, point) },
    // §208 : monter d'un saut sur une surface plus haute (estrade, rebord).
    { icon: "fa-solid fa-arrow-up-from-ground-water", label: loc("Menu.SauterHauteur"), run: () => jumpTo(token, point, { high: true }) }
  ];
}

/**
 * Sur son propre token : S'échapper, s'il est agrippé (toute créature, PNJ compris) ; Renvoyer, si c'est un objet piloté
 * qui met fin au sort (§16.15 : un joueur n'a pas le droit de supprimer un token, même le sien).
 */
const grappledSelf = token => (token?.actor?.statuses?.has("grappled") === true) || !!swallowerOf(token)?.rule.escape   // §18.21
  || (escapableRestraintsOf(token?.actor).length > 0)   // §16.54 : entravé, avec un test pour se libérer
  || (ownEndingsOf(token?.actor).length > 0);   // §43.2 : un effet auquel son action met fin (Danse irrésistible d'Otto)
/** §43.2 : le libellé de « S'échapper » quand il n'y a ni empoignade ni entrave — « Mettre fin : Forme gazeuse ». */
function escapeLabel(token) {
  const actor = token?.actor;
  if ( actor?.statuses?.has("grappled") || swallowerOf(token)?.rule.escape || escapableRestraintsOf(actor).length ) return loc("Menu.Echapper");
  const endings = ownEndingsOf(actor);
  return (endings.length === 1) ? loc("Menu.MettreFin", { item: endings[0].item.name }) : loc("Menu.Echapper");
}
/** §102 : le menu de son propre token s'ouvre dès qu'il a une entrée — du moteur ou d'un module voisin. */
export const hasSelfMenu = token => selfEntries(token).length > 0;
export function selfEntries(token) {
  const entries = [];
  if ( canStandUp(token) ) entries.push({ icon: "fa-solid fa-person-arrow-up-from-line", label: loc("Menu.SeRelever"), run: () => standUp(token) });
  if ( grappledSelf(token) ) entries.push({ icon: "fa-solid fa-person-running", label: escapeLabel(token), run: event => escapeGrapple(token, { event }) });
  // §16.39 : quitter la Forme sauvage (action Bonus).
  const revert = revertActivityOf(token.actor);
  if ( revert ) entries.push({ icon: "fa-solid fa-paw", label: loc("Forme.Reprendre"), run: event => leaveForm(revert, event) });
  // §16.15 : les commandes qui ne visent que l'objet (Main interposée).
  const pilot = pilotOf(token);
  for ( const activity of pilot ? commandActivities(pilot, { self: true }) : [] ) {
    entries.push({ icon: "fa-solid fa-hand", label: loc("Menu.Utiliser", { name: commandLabel(activity) }), run: event => useCommand(token, activity, event) });
  }
  // §169 : retourner la face brûlante d'un Mur de feu qu'il a posé.
  if ( token.isOwner ) for ( const wall of wallsOfCaster(token) ) {
    const item = fromUuidSync(wall.getFlag("dnd5e", "item") ?? "", { strict: false });
    entries.push({ icon: "fa-solid fa-fire", label: loc("MurFace.Retourner", { item: item?.name ?? wall.name }), run: () => flipWallSide(wall) });
  }
  // §187 : ramasser des chausse-trapes, des billes répandues sur sa case ou au contact (hors combat).
  entries.push(...pickUpEntries(token));
  // §188 : allumer une flaque d'huile, une toile, au contact, avec une flamme.
  entries.push(...burningEntries(token));   // §212 : éteindre ses flammes
  entries.push(...igniteEntries(token));
  // §192 : grimper au mur qu'on touche ; en escalade, se laisser tomber.
  entries.push(...climbEntries(token));
  // §210 : coups non létaux (comme l'interrupteur de BG3) — activer ou couper.
  if ( token.isOwner && token.actor ) {
    const on = isNonLethal(token.actor);
    entries.push({ icon: on ? "fa-solid fa-hand-fist" : "fa-regular fa-hand-fist", label: loc(on ? "Menu.NonLetalCouper" : "Menu.NonLetalActiver"),
      run: () => setNonLethal(token.actor, !on).then(v => notice(token, loc(v ? "Assomme.Actif" : "Assomme.Inactif"))) });
  }
  // §38.2 : Troc du filou — depuis l'illusion ou depuis son lanceur.
  const swap = transposeOf(token);
  if ( swap ) entries.push({ icon: "fa-solid fa-arrows-rotate", label: loc("Menu.Echanger", { name: (swap.illusion === token ? swap.caster : swap.illusion).name }), run: () => transpose(token) });
  if ( canDismiss(token) ) entries.push({ icon: "fa-solid fa-xmark", label: loc("Menu.Renvoyer", { name: token.name }), run: () => dismissPilot(token) });
  // §107 : le familier part dans sa poche dimensionnelle (depuis son token) ; son maître l'en rappelle (depuis le sien).
  entries.push(...familiarEntries(token, token));
  // §41.3 : ce token suit quelqu'un.
  const leader = leaderOf(token);
  if ( leader ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.NePlusSuivre", { name: leader.name }), run: () => unfollow(token) });
  // §102 : les modules voisins ajoutent aussi leurs entrées sur son propre token (hook `tokenMenu`, `target === token`).
  const all = withNeighbourEntries(entries, token, token, false);
  // Le menu remplace le HUD du cœur au clic droit : son propriétaire (pas seulement le MJ) le retrouve par cette entrée.
  if ( all.length && token.isOwner ) all.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(token.object) });
  return all;
}

/**
 * §107 : sur un familier, « Renvoyer dans sa poche dimensionnelle » (pour qui possède son maître) ; sur le token d'un maître
 * dont la poche garde un familier, « Rappeler X » (son propre token seulement : la case se choisit autour de lui).
 */
function familiarEntries(token, target) {
  const entries = [];
  if ( canPocket(target) ) {
    entries.push({ icon: "fa-solid fa-box-archive", label: loc("Familier.Renvoyer", { name: target.name }), run: () => dismissFamiliar(target) });
  }
  if ( (token === target) && canRecall(token) ) {
    entries.push({ icon: "fa-solid fa-dove", label: loc("Familier.Rappeler", { name: pocketedFamiliar(token).name }), run: () => startRecall(token) });
  }
  return entries;
}

/**
 * §41.3 : suivre cette créature, ou — si elle est à soi (familier, invocation, autre personnage) — lui dire de suivre.
 * Rien sur une créature hostile.
 */
function followEntries(token, target) {
  const entries = [];
  if ( hostileTo(token, target) ) return entries;
  if ( leaderOf(token) === target ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.NePlusSuivre", { name: target.name }), run: () => unfollow(token) });
  else if ( canFollow(token, target) ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.Suivre", { name: target.name }), run: () => follow(token, target) });
  if ( target.isOwner ) {
    if ( leaderOf(target) === token ) entries.push({ icon: "fa-solid fa-hand", label: loc("Menu.ResteIci", { name: target.name }), run: () => unfollow(target) });
    else if ( canFollow(target, token) ) entries.push({ icon: "fa-solid fa-paw", label: loc("Menu.SuisMoi", { name: target.name }), run: () => follow(target, token) });
  }
  return entries;
}

/**
 * §43.2 : mettre fin, par son action, à un effet que porte une autre créature (contenu `actionEnds`, `by: "other"`) —
 * secouer un dormeur (Sommeil, Motif hypnotique), libérer par un test (Frappe piégeuse). Le token vient au contact d'abord.
 */
function endingEntries(token, target) {
  return endingsOn(target).map(ending => ({
    icon: (ending.rule.verb === "wake") ? "fa-solid fa-bell" : "fa-solid fa-hand-holding-hand",
    label: (ending.rule.verb === "wake") ? loc("Menu.Reveiller", { name: target.name }) : loc("Menu.Liberer", { name: target.name, item: ending.item.name }),
    run: () => endFor(token, target, ending)
  }));
}

function tokenEntries(token, target, { aggressive=true }={}) {
  const entries = [];
  // §16.15 : un objet piloté propose les activités de ses commandes (attaque de l'Arme spirituelle, effets de la Main).
  const pilot = pilotOf(token);
  // Des dégâts sans jet (« Écraser » de la Main agrippante) ne valent que contre la créature que l'objet agrippe.
  const heldByPilot = pilot && grappleEffectsOf(target.actor).some(e => grapplerOf(e)?.uuid === token.actor?.uuid);
  for ( const activity of pilot ? commandActivities(pilot) : [] ) {
    if ( (activity.type === "damage") && !heldByPilot ) continue;
    if ( !aggressive && ["attack", "damage", "save"].includes(activity.type) ) continue;
    const attack = activity.type === "attack";
    entries.push({ icon: attack ? "fa-solid fa-sword" : "fa-solid fa-wand-sparkles",
      label: loc(attack ? "Menu.Attaquer" : "Menu.Utiliser", { name: commandLabel(activity) }),
      run: event => engageWith(token, target, activity, { event }) });
  }
  if ( pilot ) {   // ni arme, ni mains nues, ni Lutte : un objet n'a que ses commandes
    entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
    return entries;
  }
  // §210 : premiers soins à une créature assommée au contact (Médecine DD 10), amie ou ennemie.
  if ( isKnockedOut(target.actor) && areAdjacent(token, target, readUnitFactors()) ) {
    entries.push({ icon: "fa-solid fa-kit-medical", label: loc("Menu.PremiersSoins", { name: target.name }), run: () => firstAid(token, target) });
  }
  // §16.44 : sur une créature neutre ou amicale, rien d'offensif (Maj, menu ouvert, pour le montrer).
  if ( !aggressive ) {
    // Relâcher n'a rien d'offensif : il reste sous la main, même sur une créature amicale.
    if ( holdsOf(token, target).length ) entries.push({ icon: "fa-solid fa-hand-holding", label: loc("Menu.Relacher"), run: () => releaseGrapple(token, target) });
    entries.push(...endingEntries(token, target));
    entries.push(...followEntries(token, target));
    entries.push(...familiarEntries(token, target));
    entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
    if ( game.user.isGM ) entries.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(target.object) });
    return entries;
  }
  for ( const { activity, melee } of weaponAttacks(token.actor) ) {
    entries.push({ icon: melee ? "fa-solid fa-sword" : "fa-solid fa-bow-arrow",
      label: loc("Menu.Attaquer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { event }) });
    // §15.2 : une arme Légère offre le mode « main secondaire » de dnd5e (action Bonus, ou Coup double).
    if ( activity.item.system.attackModes?.some(m => m.value === "offhand") ) {
      entries.push({ icon: "fa-solid fa-hand-back-fist",
        label: loc("Menu.MainSecondaire", { name: activity.item.name }), run: event => engageWith(token, target, activity, { mode: "offhand", event }) });
    }
    if ( canBeThrown(activity) ) {
      entries.push({ icon: "fa-solid fa-hand-point-right",
        label: loc("Menu.Lancer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { mode: "thrown", event }) });
    }
  }
  // §16.43 : l'action suivante d'un lien (Trait ensorcelé : 1d12, action Bonus), sur la créature liée.
  for ( const item of tetherItems(token.actor) ) {
    const activity = item.system.activities?.get(tetherRuleOf(item)?.activity ?? "");
    if ( activity && (tetheredToken(item) === target) ) {
      entries.push({ icon: "fa-solid fa-bolt", label: loc("Menu.Utiliser", { name: item.name }), run: event => engageWith(token, target, activity, { event }) });
    }
  }
  // §16.41 : une arme de sort invoquée (Lame de feu), tant que sa trace est là.
  for ( const activity of traceAttacks(token.actor) ) {
    entries.push({ icon: "fa-solid fa-fire", label: loc("Menu.Attaquer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { event }) });
  }
  // §15.2 : l'attaque à mains nues et sa Lutte / Bousculade (la nôtre, ou celle d'une classe), sur une autre créature.
  // §16.44 : un seul bouton, qui ouvre le choix (attaque à mains nues, Lutte, Bousculade : à terre, Bousculade : repoussé).
  const unarmed = unarmedAttackOf(token.actor);
  const grapple = grappleShoveOf(token.actor);
  const bare = [];
  if ( unarmed ) bare.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.MainsNues"), run: event => engageWith(token, target, unarmed, { event }) });
  // §18.23 : une créature qu'on agrippe déjà ne se ré-agrippe pas — la Lutte laisse place à « Relâcher ».
  const holding = holdsOf(token, target).length > 0;
  if ( holding ) bare.push({ icon: "fa-solid fa-hand-holding", label: loc("Menu.Relacher"), run: () => releaseGrapple(token, target) });
  for ( const profile of grapple?.effects ?? [] ) {
    const effect = effectOfProfile(profile, grapple.item);
    const name = effect?.name;
    if ( !name ) continue;
    if ( holding && effect.statuses?.has("grappled") ) continue;
    bare.push({ icon: "fa-solid fa-hands", label: name, run: event => engageWith(token, target, grapple, { event, choice: profile._id }) });
  }
  if ( bare.length === 1 ) entries.push(bare[0]);
  else if ( bare.length ) entries.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.MainsNuesChoix"), run: event => openMenu(event, bare) });
  // §18.22 : Soutien (partie attaque), en combat, sur un ennemi — s'avancer jusqu'à lui s'il est atteignable ce tour-ci.
  const help = helpActivityOf(token.actor);
  if ( help && inCombat() && hostileTo(token, target) ) {
    entries.push({ icon: "fa-solid fa-handshake-angle", label: loc("Menu.Soutien"), run: event => engageWith(token, target, help, { event }) });
  }
  entries.push(...endingEntries(token, target));
  entries.push(...followEntries(token, target));
  entries.push(...familiarEntries(token, target));
  entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
  if ( game.user.isGM ) entries.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(target.object) });
  return entries;
}
