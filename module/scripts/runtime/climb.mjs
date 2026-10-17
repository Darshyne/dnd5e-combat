/**
 * Escalade (SPEC §192, lot 1 : les murs). Près d'un mur, une créature au sol grimpe : son token passe en mode `climb`, monte sur
 * place (même case, élévation + N cases — un déplacement mesuré en 3D par le cœur, payé au budget du tour : dnd5e ajoute 1 ft par
 * ft sans vitesse d'escalade, rien avec), puis marche le long du mur à cette hauteur (le mode `climb` laisse l'élévation libre,
 * runtime/altitude.mjs). Revenue au sol, elle reprend son mode d'avant.
 *  - Règles `2024` (défaut) : aucun jet (glossaire « Climbing » du Manuel des joueurs) ; `house` : DD 15 Force (Athlétisme) pour
 *    partir, puis à chaque tour en combat (au début du sien) ou toutes les 10 s hors combat — un échec fait tomber.
 *  - Chute : celle de dnd5e (`TokenDocument5e#updateFalling` puis `#plummet`, documents/token.mjs:398-444 — 1d6 par 10 ft, À terre
 *    si dégâts). dnd5e ne réévalue la chute qu'après un déplacement : un grimpeur mis À terre, Neutralisé, Agrippé ou sans vitesse
 *    est fait tomber par le MJ actif ; « Se laisser tomber » (menu) est une chute volontaire, sur le client du joueur.
 *  - Statut « En escalade » sur le token, tenu par le MJ actif d'après le mode.
 */

import { MODULE_ID } from "../constants.mjs";
import { CLIMB_DC, CLIMB_CHECK_SECONDS, climbableCells, climbCheckDue } from "../core/climb.mjs";
import { placementOf } from "../core/altitude.mjs";
import { CLIMB_RULES_SETTING, climbRules, isClimbing, wallsNear, climbingOf, climbFallReasonFor, aboveGround } from "../adapter/climb.mjs";
import { boundsUnder, groundModeOf, modeRefusalFor } from "../adapter/altitude.mjs";
import { MODE_STATUSES, setStatus } from "../adapter/conditions.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { closeRollDialogAfter } from "../adapter/dialogs.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { pilotOf, isIntangible } from "../adapter/pilot.mjs";
import { rulerShown } from "../adapter/movement.mjs";
import { historyCosts } from "../adapter/turn.mjs";
import { settingOr } from "../adapter/settings.mjs";
import { ALTITUDE_SETTING } from "./altitude.mjs";
import { movementCap, isGrappled } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { isExecutor, loc, locEsc, log, notice, say, waitForDice } from "./shared.mjs";

export const CLIMB_QUERY = `${MODULE_ID}.climbCheck`;
const CLIMB_FLAG = "climb";
/** Le joueur a ce temps pour son test (sa fenêtre se ferme avant, au délai des fenêtres de combat). */
const CHECK_TIMEOUT_MS = 40000;
/** Hors combat, le MJ actif relit les grimpeurs à cette cadence. */
const TICK_MS = 2500;

const ALTITUDE_OPTIONS = { [MODULE_ID]: { altitude: true } };

/** Une créature que l'escalade concerne : le réglage « Modes de déplacement et élévation » actif, pas un objet ni un objet piloté. */
function concerned(token) {
  if ( !settingOr(ALTITUDE_SETTING, true) || !token?.actor || (token.actor.system?.isCreature === false) ) return false;
  return !pilotOf(token) && !isIntangible(token) && !isObjectToken(token);
}

function tokensOf(actor) {
  if ( !actor ) return [];
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  return actor.getDependentTokens?.({ concreteOnly: true }) ?? [];
}

/* -------------------------------------------- */
/*  Grimper                                     */
/* -------------------------------------------- */

/** Ce token peut-il grimper (ou monter encore) : à soi, au sol ou déjà au mur, près d'un mur, ni agrippé ni sans vitesse. */
export function canClimb(token) {
  if ( !token?.isOwner || !concerned(token) ) return false;
  if ( !isClimbing(token) && (placementOf(token.movementAction) !== "ground") ) return false;   // en vol ou sous terre, on ne grimpe pas
  if ( isGrappled(token) || climbFallReasonFor(token) ) return false;
  return wallsNear(token).length > 0;
}

/** Ce que ce grimpeur peut monter maintenant : cases au plus (budget du tour, plafond), coût d'une case. */
export function climbRoom(token) {
  const grid = token.parent.grid;
  const { multiplier } = climbingOf(token);
  const cap = movementCap(token);
  const history = historyCosts(token);
  const remaining = Number.isFinite(cap) ? Math.max(0, cap - history.spent - history.excluded) : Infinity;
  const elevation = token._source.elevation ?? 0;
  const { ceiling } = boundsUnder(token);
  const ceilingCells = Number.isFinite(ceiling) ? (ceiling - elevation) / grid.distance : Infinity;
  const max = climbableCells({ remaining, gridDistance: grid.distance, multiplier, ceilingCells });
  return { max, multiplier, cost: multiplier * grid.distance, units: grid.units, ceiling: Number.isFinite(ceiling) ? ceiling : null, remaining };
}

/** La fenêtre « Combien de cases ? » ; null si elle est annulée. */
async function askCells(token, room) {
  const content = `<p>${loc("Escalade.Question", { max: room.max, cost: room.cost, units: room.units })}</p>
    <div class="form-group"><label>${loc("Escalade.Cases")}</label>
    <input type="number" name="cells" min="1" max="${room.max}" step="1" value="${room.max}" autofocus></div>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Escalade.Titre") }, content, rejectClose: false,
    buttons: [
      { action: "climb", label: loc("Escalade.Monter"), icon: "fa-solid fa-mountain", default: true,
        callback: (event, button) => Number(button.form?.elements?.cells?.value) },
      { action: "cancel", label: loc("Escalade.Annuler"), icon: "fa-solid fa-xmark" }
    ]
  });
  return Number.isFinite(answer) ? Math.floor(answer) : null;
}

/**
 * Grimper : la hauteur demandée (ou choisie dans la fenêtre), le test des règles « maison », puis le mode `climb` et la montée sur
 * place. Si le cœur refuse la montée (budget, plafond, mur de sort au-dessus), le mode d'avant est rendu.
 * @param {TokenDocument} token
 * @param {{cells?: number|null}} [options]  Cases à monter, sans fenêtre (scénarios).
 * @returns {Promise<boolean>}
 */
export async function startClimb(token, { cells=null }={}) {
  if ( !canClimb(token) ) return false;
  const room = climbRoom(token);
  if ( room.max < 1 ) {
    ui.notifications.warn(loc((room.remaining < room.cost) ? "Escalade.PasDeDeplacement" : "Escalade.Plafond", { name: token.name }));
    return false;
  }
  const wanted = Number.isFinite(cells) ? Math.floor(cells) : await askCells(token, room);
  if ( !(wanted >= 1) ) return false;
  const n = Math.min(wanted, room.max);
  const already = isClimbing(token);   // déjà au mur : on monte encore, sans nouveau test (il se refait à chaque tour)
  if ( !already && (climbRules() === "house") && !climbingOf(token).native ) {
    const result = await handleClimbQuery({ token: token.uuid, configure: true });
    if ( !result?.success ) {
      notice(token, loc("Retour.Escalade.Rate"));
      log(`${token.name}: fails to climb (${result?.total ?? "no roll"} vs DC ${CLIMB_DC})`);
      return false;
    }
  }
  const grid = token.parent.grid;
  const from = token._source.elevation ?? 0;
  const mode = token._source.movementAction ?? null;
  if ( !already ) {
    await token.update({ movementAction: "climb", [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { from: mode, checkedAt: Date.now() } }, ALTITUDE_OPTIONS);
    // Le statut (et son immunité à la chute) avant la montée : posé par le MJ actif (`updateToken`, seul à l'écrire — deux clients qui
    // l'écrivaient se marchaient dessus) ; on l'attend, sinon dnd5e mettrait le grimpeur « En chute » entre la montée et le statut.
    await statusSettled(token, true);
  }
  await token.move([{ elevation: from + (n * grid.distance), action: "climb" }], { showRuler: rulerShown() });
  if ( Math.abs((token._source.elevation ?? 0) - from) < 1e-6 ) {
    if ( !already ) await token.update({ movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  notice(token, loc("Retour.Escalade.Grimpe"), "gain");
  log(`${token.name}: climbs ${n} cell(s), ${from} → ${token._source.elevation} (${climbRules()}, ×${room.multiplier})`);
  return true;
}

/* -------------------------------------------- */
/*  Tomber, atterrir                            */
/* -------------------------------------------- */

/** Le mode au sol qu'un grimpeur reprend : celui d'avant l'escalade (un vol accordé entre-temps : la marche). */
function groundModeFor(token) {
  const from = token.getFlag(MODULE_ID, CLIMB_FLAG)?.from ?? null;
  if ( ["air", "under"].includes(placementOf(from)) ) return groundModeOf(token.actor);
  return from;
}

/** La fin de l'animation de déplacement du token (au plus `ms`), sinon on l'arrête : l'élévation visuelle rejoint la source. */
async function settleAnimation(token, ms=5000) {
  const animation = token.object?.movementAnimationPromise;
  if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, ms))]);
  if ( Math.abs((token.elevation ?? 0) - (token._source.elevation ?? 0)) > 1e-6 ) token.object?.stopAnimation?.();
}

/**
 * Le grimpeur lâche le mur : son mode d'avant, puis la chute de dnd5e s'il est en l'air (`updateFalling` pose l'état « En chute »
 * d'après la surface sous lui et ses vitesses ; `plummet` le fait tomber, dégâts compris). Une créature qui vole reste en l'air, en vol.
 * Sur un client qui peut modifier le token (son propriétaire, le MJ).
 */
async function letGo(token) {
  const mode = groundModeFor(token);
  // Mis À terre, le token est déjà en mode ramper (runtime/prone.mjs, même hook, ordre libre) : on garde ramper, et le mode que le
  // relevé rendra est celui d'avant l'escalade, pas `climb`.
  const crawling = token._source.movementAction === "crawl";
  const changes = crawling
    ? { [`flags.${MODULE_ID}.crawl.from`]: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }
    : { movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null };
  await token.update(changes, { [MODULE_ID]: { altitude: true, forced: true } });
  // Le statut doit être parti avant la chute : il porte l'immunité, dnd5e ne ferait pas tomber le grimpeur avec (le MJ actif le retire
  // sur la mise à jour du token : mode ou drapeau).
  await statusSettled(token, false);
  if ( !aboveGround(token) ) return "ground";
  if ( typeof token.updateFalling === "function" ) await token.updateFalling();
  if ( token.actor?.statuses?.has("falling") && (typeof token.plummet === "function") ) {
    // `plummet` mesure la chute depuis l'élévation VISUELLE du token (documents/token.mjs : `this.elevation`, qui suit l'animation) :
    // lâché juste après la montée, le token n'était visuellement qu'à 1,5 ft et la chute ne faisait aucun dégât (vu le 2026-10-17).
    // On attend la fin de l'animation en cours (jamais dans un onglet masqué : au plus 5 s, puis on l'arrête).
    await settleAnimation(token);
    await token.plummet();   // dnd5e retire lui-même « En chute » après le déplacement de chute (`_onUpdateMovement`)
    return "fell";
  }
  if ( !modeRefusalFor(token.actor, "fly") ) {
    await token.update({ movementAction: "fly" }, ALTITUDE_OPTIONS);
    return "flies";
  }
  return "stays";
}

/** « Se laisser tomber » (menu) : chute volontaire. */
export async function dropDown(token) {
  if ( !token?.isOwner || !isClimbing(token) ) return false;
  const outcome = await letGo(token);
  if ( outcome === "fell" ) await say({ token }, locEsc("Escalade.SeLaisseTomber", { name: token.name }));
  log(`${token.name}: lets go of the wall (${outcome})`);
  return true;
}

/** Les tokens en train de tomber : un même effet (À terre) passe par plusieurs hooks, la chute ne se joue qu'une fois. */
const falling = new Set();

/** Un grimpeur qui ne tient plus (À terre, Neutralisé, Agrippé, sans vitesse) ou qui rate son test tombe. MJ actif. */
async function fall(token, reason) {
  if ( falling.has(token.id) ) return;
  falling.add(token.id);
  try {
    notice(token, loc("Retour.Escalade.Tombe"));
    const outcome = await letGo(token);
    await say({ token }, locEsc("Escalade.Chute", { name: token.name, reason: loc(`Escalade.Raison.${reason}`) }));
    log(`${token.name}: falls off the wall (${reason}: ${outcome})`);
  } finally { falling.delete(token.id); }
}

/** Un grimpeur : en mode `climb`, ou déjà passé en mode ramper par À terre mais encore au mur (le drapeau d'escalade est là). */
const climber = token => isClimbing(token) || !!token.getFlag(MODULE_ID, CLIMB_FLAG);

/** Les grimpeurs de cet acteur qui ne tiennent plus au mur tombent. MJ actif. */
async function checkClimbers(actor) {
  for ( const token of tokensOf(actor) ) {
    if ( !climber(token) || !concerned(token) ) continue;
    const reason = climbFallReasonFor(token);
    if ( reason ) await fall(token, reason);
  }
}

/**
 * Le statut « En escalade » suit le mode — écrit par le MJ actif seulement, en file par acteur : deux mises à jour qui se suivent (le
 * mode ramper d'À terre, le drapeau retiré par la chute) ne retirent pas le même effet en même temps (« ActiveEffect … does not exist »).
 */
const syncStatus = token => enqueue(`climb-status:${token.actor?.uuid}`, () => setStatus(token.actor, MODE_STATUSES.climbing.id, isClimbing(token))).catch(() => {});

/** Le client du grimpeur attend que le MJ actif ait posé (ou retiré) le statut — au plus `ms` ; sans MJ actif, on n'attend pas. */
async function statusSettled(token, wanted, ms=3000) {
  if ( !game.users.activeGM ) return false;
  const until = Date.now() + ms;
  while ( (token.actor?.statuses?.has(MODE_STATUSES.climbing.id) !== wanted) && (Date.now() < until) ) await new Promise(resolve => setTimeout(resolve, 50));
  return token.actor?.statuses?.has(MODE_STATUSES.climbing.id) === wanted;
}

/** Un grimpeur revenu au sol (descendu le long du mur) reprend son mode d'avant. MJ actif. */
async function onTokenUpdated(token, changes) {
  if ( !token.actor || !concerned(token) ) return;
  if ( ("movementAction" in changes) || (changes.flags?.[MODULE_ID] && (CLIMB_FLAG in changes.flags[MODULE_ID])) ) await syncStatus(token);
  if ( ("elevation" in changes) && isClimbing(token) && !aboveGround(token) ) {
    await token.update({ movementAction: groundModeFor(token), [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    log(`${token.name}: back on the ground, climbing over`);
  }
}

/**
 * La carte de dégâts de chute de dnd5e (`postFallDamage`, rules/falling.mjs:36 : `flags.dnd5e.context.fall`, cibles dans
 * `system.targets`) n'applique rien d'elle-même — c'est le plateau de dégâts du MJ. Le moteur l'applique aux cibles, par
 * `applyDamage` avec la carte pour origine : dnd5e lit alors son contexte et met À terre (`applyFallProne`, attributes.mjs:684).
 * MJ actif, une fois par carte.
 */
async function onFallCard(message) {
  if ( message.getFlag("dnd5e", "context")?.fall !== true || message.getFlag(MODULE_ID, "fallApplied") ) return;
  const targets = Array.from(message.system?.targets ?? []);
  const damages = (message.rolls ?? []).filter(r => Number.isFinite(r.total)).map(r => ({ value: r.total, type: r.options?.type ?? "bludgeoning" }));
  if ( !targets.length || !damages.length ) return;
  await message.setFlag(MODULE_ID, "fallApplied", true);
  await waitForDice(message);
  for ( const target of targets ) {
    // Un descripteur de cible de dnd5e porte l'uuid du token (`uuid`) — ou, selon la version, sous `token`.
    const doc = fromUuidSync(target.uuid ?? target.token ?? "", { strict: false });
    const actor = (doc?.documentName === "Actor") ? doc : (doc?.actor ?? null);
    if ( !actor ) continue;
    await actor.applyDamage(damages, { origin: message });
    log(`${actor.name}: fall damage applied (${damages.map(d => d.value).join(" + ")})`);
  }
}

/* -------------------------------------------- */
/*  Le test des règles « maison »               */
/* -------------------------------------------- */

/**
 * Côté de celui qui grimpe : le test de Force (Athlétisme) DD 15, dans la fenêtre de jet de dnd5e (où l'interface propose ses aides,
 * §113) ; fermée ou au délai, lancé sans fenêtre. Rend `{ total, success }`, ou null sans jet.
 */
export async function handleClimbQuery({ token: uuid, configure=true }) {
  const token = await fromUuid(uuid);
  const actor = token?.actor;
  if ( !actor ) return null;
  ui.notifications.info(loc("Escalade.Test", { name: token.name, dc: CLIMB_DC }));
  const cancel = configure ? closeRollDialogAfter(actor, () => {}) : () => {};
  let rolls = await actor.rollSkill({ skill: "ath", ability: "str", target: CLIMB_DC }, { configure });
  cancel();
  if ( !rolls?.length && configure ) rolls = await actor.rollSkill({ skill: "ath", ability: "str", target: CLIMB_DC }, { configure: false });
  const total = rolls?.[0]?.total;
  return Number.isFinite(total) ? { total, success: total >= CLIMB_DC } : null;
}

const busy = new Set();

/** MJ actif : le test demandé au joueur qui possède le grimpeur (chez lui), sinon lancé ici ; un échec fait tomber. */
async function requestClimbCheck(token) {
  if ( busy.has(token.id) ) return;
  busy.add(token.id);
  try {
    await token.setFlag(MODULE_ID, CLIMB_FLAG, { ...(token.getFlag(MODULE_ID, CLIMB_FLAG) ?? {}), checkedAt: Date.now() });
    const userId = rollerFor(token.actor);
    const user = userId ? game.users.get(userId) : null;
    let result = null;
    if ( user && !user.isSelf ) result = await user.query(CLIMB_QUERY, { token: token.uuid }, { timeout: CHECK_TIMEOUT_MS }).catch(() => null);
    if ( !result ) result = await handleClimbQuery({ token: token.uuid, configure: false });
    if ( !isClimbing(token) ) return;
    if ( result && !result.success ) await fall(token, "check");
    else log(`${token.name}: holds on to the wall (${result?.total ?? "no roll"} vs DC ${CLIMB_DC})`);
  } finally { busy.delete(token.id); }
}

/** Le test est-il dû pour ce grimpeur (règles « maison », sans vraie vitesse d'escalade) ? */
const checkWanted = token => (climbRules() === "house") && isClimbing(token) && concerned(token) && !climbingOf(token).native;

/** Le tour d'un grimpeur commence : son test. MJ actif. */
async function onTurnChange(combat) {
  const token = combat.combatant?.token;
  if ( !token || !checkWanted(token) ) return;
  await requestClimbCheck(token);
}

/** Hors combat, toutes les 10 s. MJ actif, scène affichée. */
function tick() {
  if ( !isExecutor() || !canvas?.ready || game.combat?.started || (climbRules() !== "house") ) return;
  for ( const token of canvas.scene?.tokens ?? [] ) {
    if ( !checkWanted(token) || !climbCheckDue(token.getFlag(MODULE_ID, CLIMB_FLAG)?.checkedAt, Date.now(), CLIMB_CHECK_SECONDS * 1000) ) continue;
    requestClimbCheck(token).catch(err => console.error(`${MODULE_ID} | climb check`, err));
  }
}

/* -------------------------------------------- */

/** Les entrées du menu de son propre token : « Grimper » près d'un mur, « Se laisser tomber » en escalade. */
export function climbEntries(token) {
  const entries = [];
  if ( canClimb(token) ) entries.push({ icon: "fa-solid fa-mountain", label: loc("Menu.Grimper"), run: () => startClimb(token) });
  if ( token?.isOwner && isClimbing(token) ) entries.push({ icon: "fa-solid fa-person-falling", label: loc("Menu.SeLaisserTomber"), run: () => dropDown(token) });
  return entries;
}

export function registerClimb() {
  game.settings.register(MODULE_ID, CLIMB_RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: { 2024: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.2024`, house: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.house` },
    default: "2024"
  });
  CONFIG.queries[CLIMB_QUERY] = handleClimbQuery;
  const executor = { executor: true };
  route("updateToken", onTokenUpdated, { ...executor, label: "climbing: status or landing not applied" });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => checkClimbers(actorOfEffect(effect)), { ...executor, label: "climbing: fall not triggered" });
  }
  route("combatTurnChange", onTurnChange, { ...executor, label: "climbing: check not asked" });
  route("createChatMessage", onFallCard, { ...executor, label: "fall damage not applied" });
  route("ready", () => { setInterval(tick, TICK_MS); }, { label: "climbing: out-of-combat checks" });
}
