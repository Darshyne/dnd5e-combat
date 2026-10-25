/**
 * Portes (SPEC §18.24) : ouvrir, fermer, et devant une porte verrouillée, la crocheter, la forcer ou l'ouvrir à la clé.
 * L'état se lit et s'écrit comme le fait le cœur au clic sur l'icône de porte (canvas/containers/elements/door-control.mjs,
 * `_onMouseDown` / `_onRightDown`) : `wall.document.ds`, mis à jour par le client, droit « WALL_DOORS » requis.
 *
 * §244 (issue #22) : la serrure réglée par le MJ (adapter/locks.mjs, core/locks.mjs). Le test se lance chez le joueur, visible ; le
 * MJ actif le juge contre le DD, qui reste caché, et déverrouille (crocheter, clé : fermée) ou ouvre (forcer). Sans DD : le MJ tranche,
 * comme avant. En combat, crocheter ou forcer coûte l'action (Utiliser). Chez le MJ actif, après les dés 3D, trois hooks publics :
 *  - `dnd5e-combat.lockAttempt` `({ door, token, method, outcome, total })` : chaque essai jugé (§247), réussi ou non ;
 *  - `dnd5e-combat.doorUnlocked` `({ door, token, method })` : la porte vient d'être déverrouillée (`method` : pick, force, key) ;
 *  - `dnd5e-combat.noise` `({ token, point, scene, cause, wall })` : un bruit (forcer une porte, réussi ou non), pour les modules
 *    qui font entendre les créatures (`api.vision.canHear`).
 */

import { MODULE_ID } from "../constants.mjs";
import { LOCK_FAILURE_MODES, judgeAttempt, alreadyTried, recordTry, lockChoices, stateAfter, triesKey, attemptReport } from "../core/locks.mjs";
import { LOCK_TRIES_FLAG, lockOf, triesOf, keyItemFor, doorPoint } from "../adapter/locks.mjs";
import { payAction } from "./action-end.mjs";
import { approachDoor } from "./actions.mjs";
import { log, loc, notice, say, esc, viaActiveGM, waitForDice } from "./shared.mjs";

export const LOCK_QUERY = `${MODULE_ID}.doorLock`;
export const LOCK_FAILURE_SETTING = "lockFailure";
export const DOOR_UNLOCKED_HOOK = `${MODULE_ID}.doorUnlocked`;
export const NOISE_HOOK = `${MODULE_ID}.noise`;
export const LOCK_ATTEMPT_HOOK = `${MODULE_ID}.lockAttempt`;

/**
 * §247 : chez le MJ actif, chaque essai jugé sur une serrure (crocheter, forcer, clé) — `({ door, token, method, outcome, total })`,
 * `outcome` success / failure / gm. Pour les modules voisins (une porte piégée qui part sur un crochetage raté) ; le moteur n'en attend rien.
 */
function announceAttempt(wall, token, method, outcome, total) {
  Hooks.callAll(LOCK_ATTEMPT_HOOK, { door: wall, token, ...attemptReport(method, outcome, total) });
}

const states = () => CONST.WALL_DOOR_STATES;

/** Réglage de monde : un échec ne coûte rien, ou un seul essai par personnage. */
export function lockFailureMode() {
  try { return game.settings.get(MODULE_ID, LOCK_FAILURE_SETTING); } catch { return "free"; }
}

/** L'état d'une porte (placeable ou document) : "open", "closed" ou "locked". */
export function doorState(wall) {
  const ds = wall?.document?.ds ?? wall?.ds;
  if ( ds === states().OPEN ) return "open";
  if ( ds === states().LOCKED ) return "locked";
  return "closed";
}

/** Le cœur refuse aux joueurs d'actionner une porte pendant la pause ; on fait de même. */
function mayUse() {
  if ( !game.user.can("WALL_DOORS") ) return false;
  if ( game.paused && !game.user.isGM ) {
    ui.notifications.warn("GAME.PausedWarning", { localize: true });
    return false;
  }
  return true;
}

/**
 * Ouvrir ou fermer, après s'être avancé au contact (`approachDoor`). Une porte verrouillée ne s'ouvre pas : le son de la
 * poignée qui résiste, comme au clic du cœur.
 */
export async function setDoorOpen(token, wall, open) {
  if ( !mayUse() ) return;
  if ( !(await approachDoor(token, wall)) ) return;
  if ( doorState(wall) === "locked" ) {
    wall._playDoorSound?.("test");
    return ui.notifications.info(loc("Porte.Verrouillee"));
  }
  await wall.document.update({ ds: open ? states().OPEN : states().CLOSED });
}

/** MJ : verrouiller une porte fermée, ou la déverrouiller. Les essais déjà faits sur la serrure repartent de zéro. */
export async function setDoorLocked(wall, locked) {
  if ( !game.user.isGM || (doorState(wall) === "open") ) return;
  await wall.document.update({ ds: locked ? states().LOCKED : states().CLOSED, [`flags.${MODULE_ID}.-=${LOCK_TRIES_FLAG}`]: null });
}

/** MJ : remettre à zéro les essais faits sur cette serrure (réglage « un essai par personnage »). */
export async function resetLockTries(wall) {
  if ( !game.user.isGM ) return;
  await wall.document.unsetFlag(MODULE_ID, LOCK_TRIES_FLAG);
}

/** Des essais ont-ils été notés sur cette serrure ? */
export function hasLockTries(wall) {
  return Object.keys(triesOf(wall)).length > 0;
}

/**
 * Les entrées de serrure devant une porte verrouillée, pour ce token : `{ method, spent }` (core/locks.mjs, `lockChoices`).
 * La clé n'apparaît que si le personnage la porte ; « Forcer » disparaît d'une porte qui ne peut pas l'être.
 */
export function lockEntriesFor(token, wall) {
  const actor = token?.actor;
  const lock = lockOf(wall);
  return lockChoices(lock, { hasKey: !!keyItemFor(actor, lock), tries: triesOf(wall), who: triesKey(actor?.uuid), mode: lockFailureMode() });
}

/**
 * Le test, chez le joueur : `null` s'il a été annulé. On attend que les dés 3D se soient arrêtés (`waitForDice`, borné) : le verdict,
 * la porte qui cède et son animation (hooks publics) n'arrivent qu'après. dnd5e ne rend que les jets : le message est le dernier
 * message de jet de ce client créé pendant le test.
 */
async function rollFor(actor, method, event) {
  const known = new Set(game.messages.keys());
  const rolls = (method === "pick")
    ? await actor.rollToolCheck({ tool: "thief", ability: "dex", event }, { configure: false })
    : await actor.rollSkill({ skill: "ath", ability: "str", event }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return null;
  const message = game.messages.contents.findLast(m => !known.has(m.id) && m.isAuthor && m.rolls?.length);
  if ( message ) await waitForDice(message);
  return total;
}

const tokenUuid = token => token.document?.uuid ?? token.uuid;

/**
 * Crocheter (Manuel des joueurs 2024 : « Utiliser : crocheter une serrure » — test de Dextérité avec des outils de voleur ; dnd5e
 * ajoute la maîtrise si la créature l'a, actor.mjs `rollToolCheck`) ou forcer (Force (Athlétisme)). S'avance au contact, paie
 * l'action en combat, lance le test, puis le MJ actif le juge.
 * @returns {Promise<string|null>}  « success », « failure », « gm », ou null (rien n'a été tenté).
 */
async function attempt(token, wall, method, { event=null }={}) {
  const actor = token?.actor;
  if ( !actor || !mayUse() ) return null;
  if ( alreadyTried(triesOf(wall), triesKey(actor.uuid), method, lockFailureMode()) ) {
    ui.notifications.info(loc("Serrure.DejaEssaye", { name: token.name }));
    return null;
  }
  if ( !(await approachDoor(token, wall)) ) return null;
  if ( doorState(wall) !== "locked" ) return null;
  if ( !(await payAction(token)) ) return null;
  const total = await rollFor(actor, method, event);
  if ( total === null ) return null;
  const result = await viaActiveGM(LOCK_QUERY, handleLockQuery, { wall: wall.document.uuid, token: tokenUuid(token), method, total },
    { noGm: "Serrure.SansMJ", fallback: null, label: "doors: lock attempt" });
  return result?.outcome ?? null;
}

export const pickLock = (token, wall, options) => attempt(token, wall, "pick", options);
export const forceDoor = (token, wall, options) => attempt(token, wall, "force", options);

/** Déverrouiller avec la clé que porte le personnage : sans test ni coût (interagir avec un objet). */
export async function unlockWithKey(token, wall) {
  if ( !token?.actor || !mayUse() ) return null;
  if ( !(await approachDoor(token, wall)) ) return null;
  const result = await viaActiveGM(LOCK_QUERY, handleLockQuery, { wall: wall.document.uuid, token: tokenUuid(token), method: "key" },
    { noGm: "Serrure.SansMJ", fallback: null, label: "doors: unlock with a key" });
  return result?.outcome ?? null;
}

/**
 * Chez le MJ actif : juger un essai et déverrouiller. Tout se revérifie ici (porte verrouillée, token possédé par le demandeur,
 * clé portée, essai pas encore fait). Le test est celui que le joueur a lancé et que tous voient ; son total arrive avec la requête.
 */
async function handleLockQuery({ wall: wallUuid, token: tokUuid, method, total }, { user=game.user }={}) {
  const wall = await fromUuid(wallUuid);
  const token = await fromUuid(tokUuid);
  const actor = token?.actor;
  if ( !wall || !actor || !["pick", "force", "key"].includes(method) ) return { outcome: null };
  if ( !user.isGM && !actor.testUserPermission(user, "OWNER") ) return { outcome: null };
  if ( doorState(wall) !== "locked" ) return { outcome: null };
  const lock = lockOf(wall);
  const value = Number(total);
  if ( method === "force" ) Hooks.callAll(NOISE_HOOK, { token, point: doorPoint(wall), scene: wall.parent, cause: "forceDoor", wall });
  let outcome;
  if ( method === "key" ) outcome = keyItemFor(actor, lock) ? "success" : "failure";
  else {
    const mode = lockFailureMode();
    const who = triesKey(actor.uuid);
    if ( alreadyTried(triesOf(wall), who, method, mode) ) return { outcome: null };
    outcome = judgeAttempt(lock, method, value);
    if ( outcome === "failure" ) {
      const tries = recordTry(triesOf(wall), who, method, mode);
      if ( tries[who] ) await wall.setFlag(MODULE_ID, LOCK_TRIES_FLAG, tries);
    }
  }
  const speaker = { actor, token };
  const name = esc(token.name);
  const shown = Number.isFinite(value) ? ` (${value})` : "";
  if ( outcome === "gm" ) {
    log(`${token.name}: ${method} the lock${shown} — no DC set, the GM decides`);
    announceAttempt(wall, token, method, outcome, value);
    return { outcome };
  }
  if ( outcome === "failure" ) {
    if ( method !== "key" ) await say(speaker, loc((method === "pick") ? "Serrure.CrochetageRate" : "Serrure.ForcageRate", { name }));
    log(`${token.name}: ${method} the lock fails${shown}`);
    announceAttempt(wall, token, method, outcome, value);
    return { outcome };
  }
  const key = keyItemFor(actor, lock);
  const ds = (stateAfter(method) === "open") ? states().OPEN : states().CLOSED;
  await wall.update({ ds, [`flags.${MODULE_ID}.-=${LOCK_TRIES_FLAG}`]: null });
  const text = { pick: "Serrure.Crochetee", force: "Serrure.Forcee", key: "Serrure.OuverteCle" }[method];
  await say(speaker, loc(text, { name, key: esc(key?.name ?? "") }));
  notice(token, loc("Serrure.Deverrouillee"), "gain");
  log(`${token.name}: door unlocked (${method}${shown})`);
  announceAttempt(wall, token, method, outcome, value);
  Hooks.callAll(DOOR_UNLOCKED_HOOK, { door: wall, token, method });
  return { outcome };
}

export function registerDoors() {
  game.settings.register(MODULE_ID, LOCK_FAILURE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${LOCK_FAILURE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${LOCK_FAILURE_SETTING}.Aide`,
    scope: "world", config: true, type: String, default: "free",
    choices: Object.fromEntries(LOCK_FAILURE_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${LOCK_FAILURE_SETTING}.${m}`]))
  });
  CONFIG.queries[LOCK_QUERY] = handleLockQuery;
}

/** Pour les fonctions de test (runtime/testing-moves.mjs). */
export { handleLockQuery };
