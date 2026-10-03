/**
 * Chercher (SPEC §16.49) lu dans Foundry : les créatures cachées que l'observateur pourrait trouver, et ce qui décide de
 * chacune (core/search.mjs). Une créature est cachée tant qu'elle porte l'effet de Furtivité du moteur (adapter/hide.mjs),
 * qui garde son total de Discrétion : le DD pour la trouver.
 */

import { MODULE_ID } from "../constants.mjs";
import { areHostile } from "../core/reaction.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { hiddenEffectsOf, OUT_OF_ACTION } from "./hide.mjs";
import { canSee, blockedBetween, hasLineOfSight } from "./vision.mjs";
import { perceivedOnToken, sensesToward, tokenPoint } from "./illumination.mjs";
import { committedPosition } from "./turn.mjs";
import { isObjectToken } from "./bodies.mjs";

/** Le DD pour trouver cet acteur caché (le plus haut de ses effets de Furtivité), ou null s'il n'est pas caché. */
export function hiddenDcOf(actor) {
  const dcs = hiddenEffectsOf(actor).map(e => Number(e.getFlag(MODULE_ID, "hidden")?.dc)).filter(Number.isFinite);
  return dcs.length ? Math.max(...dcs) : null;
}

/**
 * Les créatures cachées, hostiles à l'observateur, sur sa scène, avec ce qui décide de chacune.
 * @param {TokenDocument} searcher
 * @returns {Array<{id: string, token: TokenDocument, dc: number, sensed: boolean, seeable: boolean, disadvantage: boolean}>}
 */
export function searchCandidates(searcher) {
  const scene = searcher?.parent;
  if ( !scene || !canvas?.ready ) return [];
  const out = [];
  for ( const token of scene.tokens ) {
    if ( (token === searcher) || token.hidden || !token.actor || isObjectToken(token) ) continue;
    if ( !areHostile(searcher.disposition, token.disposition) ) continue;
    const dc = hiddenDcOf(token.actor);
    if ( dc === null ) continue;
    out.push({ id: token.uuid, token, dc, ...sightingOf(searcher, token) });
  }
  return out;
}

/**
 * Ce que l'observateur perçoit d'une créature cachée : `sensed` (ses sens la perçoivent malgré Invisible, `canSee`),
 * `seeable` (ni Aveuglé, ligne de vue, ni brume ni ténèbres entre les deux qu'il ne perce pas, lumière perçue autre que
 * ténèbres au point de la cachette), `disadvantage` (zone légèrement obscurcie pour lui). Partagé par Chercher et la
 * Perception passive (§16.49, §16.51).
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @returns {{sensed: boolean, seeable: boolean, disadvantage: boolean}}
 */
export function sightingOf(observer, target) {
  const sensed = canSee(observer, target) === true;
  if ( sensed || observer.actor?.statuses?.has("blinded") ) return { sensed, seeable: false, disadvantage: false };
  const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? tokenPoint(observer);
  if ( !hasLineOfSight(eye, target, observer.parent.levels?.get?.(observer.level)) ) return { sensed, seeable: false, disadvantage: false };
  const blocked = blockedBetween(observer, target);
  const senses = sensesToward(observer, tokenPoint(target));
  const throughDarkness = senses.devilsSight || senses.truesight;
  const light = perceivedOnToken(observer, target);
  const seeable = !blocked.fog && (!blocked.darkness || throughDarkness) && !!light && (light.perceived !== LIGHT.DARK);
  return { sensed, seeable, disadvantage: seeable && light.perceptionDisadvantage };
}

/**
 * Perception passive (§16.51) : les ennemis de la créature cachée, sur sa scène, en état d'agir (ni Neutralisés, ni
 * Inconscients…, ni vaincus), non cachés par le MJ, avec leur Perception passive (`skills.prc.passive` de dnd5e) et ce qu'ils
 * perçoivent d'elle.
 * @param {TokenDocument} hidden
 * @returns {Array<{token: TokenDocument, passive: number, sensed: boolean, seeable: boolean, disadvantage: boolean}>}
 */
export function passiveObservers(hidden) {
  const scene = hidden?.parent;
  if ( !scene || !canvas?.ready || (scene !== canvas.scene) ) return [];
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const out = [];
  for ( const token of scene.tokens ) {
    const actor = token.actor;
    if ( (token === hidden) || token.hidden || !actor || isObjectToken(token) ) continue;
    if ( !areHostile(hidden.disposition, token.disposition) ) continue;
    if ( OUT_OF_ACTION.some(s => actor.statuses.has(s)) || actor.statuses.has(defeated) ) continue;
    const passive = Number(actor.system?.skills?.prc?.passive);
    out.push({ token, passive, ...sightingOf(token, hidden) });
  }
  return out;
}

/**
 * Le test de Perception tel que core/search.mjs le lit. Les d20 ne sont rendus que pour un test au Désavantage (deux d20, le
 * plus bas gardé) : c'est le seul cas où l'on en tire le total sans Désavantage. Les d20 relancés (Chanceux…) sont écartés.
 * @param {D20Roll} roll
 * @returns {{total: number, d20: number[], kept: number|null}}
 */
export function perceptionRollParts(roll) {
  const total = roll?.total;
  if ( !roll?.hasDisadvantage ) return { total, d20: [], kept: null };
  const results = (roll.dice?.[0]?.results ?? []).filter(r => !r.rerolled);
  const d20 = results.map(r => r.result);
  const kept = results.find(r => r.active)?.result ?? null;
  return { total, d20, kept };
}
