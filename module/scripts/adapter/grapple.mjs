/**
 * L'empoignade lue dans Foundry (SPEC §15.2, règles 2024) : l'état Agrippé est un effet (celui de la
 * Lutte, content/actions.mjs, ou celui de l'item du Barbare, du Moine, d'un monstre) ; son agrippeur se
 * lit dans l'origine que dnd5e écrit en l'appliquant (`system.origin.activity`,
 * applications/components/effect-application.mjs:252-259). Un Agrippé posé à la main n'a pas
 * d'agrippeur connu : ni désavantage ciblé, ni fin automatique, ni DD d'évasion — le MJ tranche.
 */

import { MODULE_ID } from "../constants.mjs";
import { rangeIssue } from "../core/range.mjs";
import { distanceBetween } from "./turn.mjs";
import { unarmedAttackOf } from "./basics.mjs";
import { pilotOfActor } from "./pilot.mjs";

/** Les effets actifs qui rendent cet acteur Agrippé. */
export function grappleEffectsOf(actor) {
  return (actor?.effects ?? []).filter(e => !e.disabled && e.statuses?.has("grappled"));
}

/**
 * L'acteur qui agrippe, d'après l'origine de l'effet ; null si inconnu. Si l'item qui a servi n'existe
 * plus (attaque à mains nues retirée), l'acteur se lit encore au début de l'UUID de l'activité
 * (`Actor.<id>.Item.…`, `Scene.<id>.Token.<id>.Actor.<id>.Item.…`) : l'empoignade reste jugeable.
 */
export function grapplerOf(effect) {
  // Un état posé par le moteur (étape `status`, Main agrippante §16.15) garde son origine dans le champ `origin` du
  // cœur : le modèle d'effet `condition` de dnd5e n'a pas de `system.origin` (adapter/saves.mjs, applyStatusToToken).
  const activityUuid = effect?.system?.origin?.activity ?? (effect?.origin?.includes?.(".Activity.") ? effect.origin : null);
  if ( !activityUuid ) return null;
  try {
    const actor = fromUuidSync(activityUuid)?.actor;
    if ( actor ) return actor;
    const actorUuid = activityUuid.split(".Item.")[0];
    return (actorUuid && (actorUuid !== activityUuid)) ? (fromUuidSync(actorUuid) ?? null) : null;
  }
  catch { return null; }
}

/**
 * L'attaquant, agrippé, vise-t-il une autre créature que son agrippeur ? (désavantage, règle 2024)
 * @returns {boolean|null}  null : pas agrippé, ou agrippeur inconnu.
 */
export function grappledElsewhere(attackerToken, targetToken) {
  const effects = grappleEffectsOf(attackerToken?.actor);
  if ( !effects.length ) return null;
  const grapplers = effects.map(grapplerOf).filter(Boolean);
  if ( !grapplers.length ) return null;
  const target = targetToken?.actor;
  return !grapplers.some(a => (a === target) || (a.uuid === target?.uuid));
}

/**
 * La scène où l'empoignade a eu lieu : celle de la carte de la Lutte (`system.origin.message`, son
 * `speaker.scene`). null si inconnue. Un acteur LIÉ porte ses effets sur tous ses tokens, dans toutes les
 * scènes : l'empoignade ne se juge que là où elle a été faite (vu le 2026-09-23 : Paladin et Magicien ont
 * aussi des tokens sur une autre scène, à 20 ft l'un de l'autre, et l'empoignade y était « rompue »).
 */
export function grappleSceneOf(effect) {
  const messageUuid = effect?.system?.origin?.message;
  if ( !messageUuid ) return null;
  try { return fromUuidSync(messageUuid)?.speaker?.scene ?? null; }
  catch { return null; }
}

/** DD pour s'échapper d'une empoignade : 8 + Force + maîtrise de l'agrippeur (`abilities.str.dc`). null si inconnu. */
export function escapeDcOf(effect) {
  const grappler = grapplerOf(effect);
  // Main agrippante (§16.15) : « DD d'évasion égal à votre DD de sort » — celui du lanceur de la main.
  const summoner = grappler ? pilotOfActor(grappler)?.summoner : null;
  if ( summoner ) {
    const spellDc = summoner.system?.attributes?.spell?.dc;
    if ( Number.isFinite(spellDc) ) return spellDc;
  }
  const dc = grappler?.system?.abilities?.str?.dc;
  return Number.isFinite(dc) ? dc : null;
}

/** Portée d'une empoignade : l'allonge de l'attaque à mains nues de l'agrippeur, 5 ft à défaut. */
function grappleReachOf(grappler) {
  const range = unarmedAttackOf(grappler)?.item?.system?.range;
  return { value: range?.reach ?? 5, units: range?.units ?? "ft" };
}

/**
 * Le token d'un acteur dans une scène donnée — pas celle qu'affiche ce client (`getActiveTokens` ne voit
 * que la scène affichée : un MJ sur une autre scène ne trouvait pas l'agrippeur, vu le 2026-09-23).
 */
function tokenIn(scene, actor) {
  if ( actor.isToken ) return (actor.token?.parent === scene) ? actor.token : null;
  return scene.tokens.find(t => t.actorLink && (t.actorId === actor.id)) ?? null;
}

/**
 * Faits d'une empoignade pour le cœur (`grappleHolds`) : états de l'agrippeur et distance.
 * null si l'agrippeur est inconnu ou n'a pas de token sur la scène de l'agrippé.
 */
export function grappleFacts(effect, grappledToken, factors) {
  const grappler = grapplerOf(effect);
  const grapplerToken = grappler ? tokenIn(grappledToken.parent, grappler) : null;
  if ( !grapplerToken ) return null;
  const distance = distanceBetween(grapplerToken, grappledToken);
  const reach = grappleReachOf(grappler);
  const within = rangeIssue(distance, reach, factors) === null;
  return { grapplerStatuses: Array.from(grappler.statuses ?? []), withinReach: within, grappler, grapplerToken, distance, reach };
}

/* -------------------------------------------- */
/*  L'agrippeur : sa marque, ses victimes       */
/* -------------------------------------------- */

/** Les marques « Agrippe : … » d'un acteur agrippeur (une par victime). */
export function grapplingMarksOf(actor) {
  return (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "grappling"));
}

/** Données de la marque posée sur l'agrippeur : icône toujours visible, liée à l'effet Agrippé de la victime. */
export function grapplingMarkData(name, victimToken, grappleEffect) {
  return {
    name, img: "systems/dnd5e/icons/svg/statuses/grappled.svg", transfer: false, disabled: false, statuses: [], changes: [],
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [MODULE_ID]: { grappling: { target: victimToken.uuid, effect: grappleEffect.uuid } } }
  };
}

/**
 * L'acteur qui porte un effet. Piège V14, vu le 2026-09-23 : pour un token NON LIÉ, l'effet vit dans le
 * delta du token (`ActorDelta`), et le hook `createActiveEffect` le reçoit avec ce delta pour parent
 * (client/data/client-backend.mjs:164) — pas l'acteur synthétique.
 */
export function actorOfEffect(effect) {
  const parent = effect?.parent;
  if ( parent?.documentName === "ActorDelta" ) return parent.parent?.actor ?? parent.syntheticActor ?? null;
  return (parent?.documentName === "Actor") ? parent : null;
}

/** Le token d'un acteur agrippé, dans la scène de l'empoignade (ou celle de son premier token). */
export function grappledTokenOf(effect) {
  if ( effect?.parent?.documentName === "ActorDelta" ) return effect.parent.parent ?? null;   // le token du delta
  const actor = actorOfEffect(effect);
  if ( !actor ) return null;
  if ( actor.isToken ) return actor.token;
  const sceneId = grappleSceneOf(effect);
  const scene = (sceneId && game.scenes.get(sceneId)) || null;
  if ( scene ) return tokenIn(scene, actor);
  return actor.getDependentTokens?.({ concreteOnly: true })[0] ?? null;
}

/** Rang de taille numérique d'un acteur (dnd5e : `CONFIG.DND5E.actorSizes[...].numerical`, M = 2). */
export function sizeRankOf(actor) {
  return CONFIG.DND5E.actorSizes?.[actor?.system?.traits?.size]?.numerical ?? 2;
}

/** Les victimes qu'un token agrippeur traîne en marchant (tokens), d'après ses marques. */
export function victimsOf(grapplerToken) {
  return grapplingMarksOf(grapplerToken?.actor)
    .map(mark => fromUuidSync(mark.getFlag(MODULE_ID, "grappling").target))
    .filter(t => t && (t.parent === grapplerToken.parent));
}
