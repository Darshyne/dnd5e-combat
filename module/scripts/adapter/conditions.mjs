/**
 * États des créatures et situation d'une attaque, lus dans Foundry pour le cœur (core/conditions.mjs).
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - avant un jet, `roll.options.advantage` / `.disadvantage` sont des booléens que le système
 *    combine lui-même : les deux à la fois = jet normal (dice/d20-roll.mjs:95-99, 252-255). Le
 *    moteur ne fait qu'ajouter ses sources à celles du système (Empoisonné, effets, touches).
 *  - les états du système sont construits à `i18nInit` à partir de `CONFIG.DND5E.statusEffects`
 *    (dnd5e.mjs:447-467, 545) : y ajouter une entrée à `init` suffit à créer un état de token.
 */

import { areHostile } from "../core/reaction.mjs";
import { rangeIssue } from "../core/range.mjs";
import { verbalSpellBlocked, hampersRangedAttack, forbiddenAgainstCharmer, requiresSight, INCAPACITATING } from "../core/conditions.mjs";
import { distanceBetween, rangeOf } from "./turn.mjs";
import { visionFacts, isVisionAvailable, canSee, tokenOf } from "./vision.mjs";
import { originItemOf, revealedInvisible } from "./facts.mjs";
import { grappledElsewhere } from "./grapple.mjs";
import { helpedAgainst } from "./help.mjs";
import { spellCommandOf } from "./pilot.mjs";
import { declaredAttackModifiers } from "./triggers.mjs";
import { isDeadActor } from "./death.mjs";
import { contentOf } from "./content.mjs";
import { isObjectToken } from "./bodies.mjs";
import { isSpellCast } from "./scrolls.mjs";

/**
 * Effrayé « tant que la source de la peur est en vue » (P1) : les sources sont les acteurs d'où
 * viennent les effets Effrayé de l'attaquant. false si aucune source connue n'est en vue ;
 * null si l'attaquant n'est pas effrayé, si une source est inconnue, ou si la vision est hors service.
 */
export function frightenedSourceSeen(origin) {
  if ( !isVisionAvailable() || !origin?.actor?.statuses?.has("frightened") ) return null;
  let known = 0;
  for ( const effect of origin.actor.effects ) {
    if ( effect.disabled || effect.isSuppressed || !effect.statuses?.has("frightened") ) continue;
    const source = tokenOf(originItemOf(effect)?.actor);
    if ( !source ) return null;   // source inconnue : l'état s'applique
    known++;
    if ( canSee(origin, source) !== false ) return true;
  }
  return known ? false : null;
}

/** §17.3 : les tokens sources des effets Effrayé de cet acteur (connus et sur la scène de `token`). */
export function fearSources(token) {
  const out = [];
  for ( const effect of token?.actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || !effect.statuses?.has("frightened") ) continue;
    const source = tokenOf(originItemOf(effect)?.actor);
    if ( source && (source.parent === token.parent) && (source !== token) ) out.push(source);
  }
  return out;
}

/** §17.3 : les uuids des acteurs qui ont charmé cet acteur (origine des effets Charmé). */
export function charmersOf(actor) {
  const out = new Set();
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || !effect.statuses?.has("charmed") ) continue;
    const source = originItemOf(effect)?.actor;
    if ( source && (source !== actor) ) out.add(source.uuid);
  }
  return out;
}

/** §17.3 : l'utilisation est-elle interdite contre qui nous a charmé ? Attaque, dégâts, ou effet magique (un sort). */
export function hostileToCharmer(activity) {
  return forbiddenAgainstCharmer({
    attack: activity?.type === "attack",
    damage: (activity?.damage?.parts?.length ?? 0) > 0,
    magical: isSpellCast(activity?.item)   // §48 : un parchemin lance le sort
  });
}

/**
 * §17.3 : l'activité vise-t-elle « une créature que vous pouvez voir » ? D'après la description de l'item, pour une activité
 * qui vise des créatures sans gabarit (une zone se pose sur un point : sa cible n'a pas à être vue).
 */
export function sightRequired(activity) {
  if ( activity?.target?.template?.type ) return false;
  return requiresSight(activity?.item?.system?.description?.value);
}

/** États de tour tenus par le moteur, visibles sur le token. `dodging` est un état natif du système. */
export const TURN_STATUSES = Object.freeze({
  reactionUsed: { id: "reactionUsed", name: "DND5ECOMBAT.Etat.reactionUsed", img: "icons/svg/lightning.svg" },
  dashing: { id: "dashing", name: "DND5ECOMBAT.Etat.dashing", img: "icons/svg/wingfoot.svg" },
  disengaged: { id: "disengaged", name: "DND5ECOMBAT.Etat.disengaged", img: "icons/svg/door-exit.svg" },
  readied: { id: "readied", name: "DND5ECOMBAT.Etat.readied", img: "icons/svg/clockwork.svg" }
});

/** À appeler à `init`, avant que le système ne fige sa liste d'états. */
export function registerTurnStatuses() {
  for ( const status of Object.values(TURN_STATUSES) ) {
    CONFIG.DND5E.statusEffects[status.id] ??= { name: status.name, img: status.img, order: 90 };
  }
}

export function statusesOf(token) {
  const statuses = Array.from(token?.actor?.statuses ?? []);
  // §16.36 : « ne peut pas bénéficier de l'état Invisible » (Poussière d'étoile, Lueurs féeriques).
  return revealedInvisible(token?.actor) ? statuses.filter(s => s !== "invisible") : statuses;
}

/** Deux tokens sont-ils à 5 ft ou moins l'un de l'autre ? */
export function areAdjacent(a, b, factors, positions={}) {
  return rangeIssue(distanceBetween(a, b, positions), { value: 5, units: "ft" }, factors) === null;
}

/** L'attaque est-elle à distance ? Une arme de mêlée lancée en est une. */
export function isRangedAttack(activity, attackMode) {
  return (activity.attack?.type?.value === "ranged") || (attackMode?.startsWith("thrown") === true);
}

/**
 * Un ennemi qui voit ce token et n'est pas Neutralisé se tient-il à 5 ft ? (PHB 2024 « Attaques à distance en combat
 * rapproché », core/conditions.mjs `hampersRangedAttack`.) Un mort ne compte pas ; la vue est celle de la position
 * actuelle de l'attaquant.
 */
export function hasHostileAdjacent(token, factors, posA=undefined) {
  // La vue en dernier : c'est le seul test coûteux.
  return token.parent.tokens.some(other => (other !== token) && other.actor && !other.hidden && !isObjectToken(other)
    && areHostile(token.disposition, other.disposition) && areAdjacent(token, other, factors, { posA })
    && hampersRangedAttack({
      hostile: areHostile(token.disposition, other.disposition),
      statuses: Array.from(other.actor.statuses),
      dead: isDeadActor(other.actor),
      seesAttacker: isVisionAvailable() ? canSee(other, token) : null
    }));
}

/** Un item de l'acteur porte-t-il cette règle du contenu (`true`), sans qu'il soit Neutralisé ? (§20 : Esquive totale, Insaisissable.) */
function activeRule(actor, key) {
  if ( !actor || INCAPACITATING.some(s => actor.statuses?.has?.(s)) ) return false;
  return Array.from(actor.items ?? []).some(i => contentOf(i).entry?.[key] === true);
}

/** §20 : Esquive totale — « vous ne pouvez pas utiliser cette aptitude si vous avez l'état Neutralisé ». */
export const evades = actor => activeRule(actor, "evasion");

/** §20 : Insaisissable — « aucun jet d'attaque ne peut avoir l'Avantage contre vous si vous ne subissez pas l'état Neutralisé ». */
export const isElusive = token => activeRule(token?.actor, "elusive");

/** Un item de l'attaquant lui retire-t-il le Désavantage du tir au contact d'un ennemi ? */
const ignoresCloseCombat = token => Array.from(token?.actor?.items ?? []).some(i => contentOf(i).entry?.ignoresCloseCombat === true);

/**
 * Contexte d'attaque attendu par attackModifiers(), pour une cible. `posA` : position hypothétique
 * de l'attaquant (au bout d'une approche, pour la chance de toucher au survol) ; la vision reste
 * celle de sa position actuelle.
 */
export function attackContext(origin, target, activity, attackMode, factors, { posA }={}) {
  const ranged = isRangedAttack(activity, attackMode);
  return {
    attacker: statusesOf(origin),
    target: statusesOf(target),
    adjacent: areAdjacent(origin, target, factors, { posA }),
    ranged,
    longRange: ranged && (rangeIssue(distanceBetween(origin, target, { posA }), rangeOf(activity, attackMode), factors) === "longRange"),
    // §19 : pas de Désavantage aux attaques à distance malgré un ennemi au contact
    // (contenu `ignoresCloseCombat` : déclaré par un module de créatures tiers).
    closeCombat: ranged && hasHostileAdjacent(origin, factors, posA) && !ignoresCloseCombat(origin),
    // P1 : qui voit qui. null si la vision n'est pas en service — les états gardent alors leur effet forfaitaire.
    vision: isVisionAvailable() ? visionFacts(origin, target) : null,
    frightenedSourceSeen: frightenedSourceSeen(origin),
    // Agrippé (2024) : désavantage contre toute cible autre que l'agrippeur (adapter/grapple.mjs).
    grappledElsewhere: grappledElsewhere(origin, target),
    // Soutien (2024) : un allié de l'attaquant a distrait la cible (adapter/help.mjs).
    helped: helpedAgainst(origin, target),
    // Ce que le contenu déclare (§16, B6) : Lueurs féeriques, Tactique de meute, Protection contre le mal et le bien.
    declared: declaredAttackModifiers(origin, target, activity),
    // §20 : Insaisissable — aucun Avantage contre la cible.
    elusive: isElusive(target)
  };
}

/**
 * L'état qui empêche d'utiliser cette activité parce qu'elle lance un sort verbal (Silence), ou null.
 * dnd5e 6.0.3 ne fait rien de l'état « silenced » (pseudo-état, config.mjs:3755-3759) : c'est au moteur
 * de le tenir. Un sort lancé par un objet arrive ici comme item de sort dont les composantes ignorées
 * ont déjà été retirées (documents/activity/cast.mjs:171-174).
 */
export function verbalBlockOf(activity) {
  const item = activity?.item;
  if ( spellCommandOf(activity) ) return null;   // commander les lumières d'un sort déjà lancé n'est pas lancer un sort (§16.17)
  return verbalSpellBlocked(Array.from(activity?.actor?.statuses ?? []), {
    spell: isSpellCast(item),   // §48 : lire un parchemin, c'est lancer le sort
    verbal: !!item?.system?.properties?.has?.("vocal")
  });
}

/** Pose ou retire un état sur un acteur, sans rien faire s'il est déjà dans l'état voulu. */
export async function setStatus(actor, id, active) {
  if ( !actor || (actor.statuses.has(id) === active) ) return;
  await actor.toggleStatusEffect(id, { active });
}
