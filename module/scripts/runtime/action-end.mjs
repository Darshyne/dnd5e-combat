/**
 * Une action met fin à un effet (SPEC §43.2, contenu `actionEnds`).
 *
 *  - Le porteur : par « S'échapper » (action de base, menu de son propre token — runtime/grapple.mjs les ajoute à ce dont on
 *    s'échappe). `roll: "check"` : le test de l'item, comme une entrave ; `roll: "save"` : la sauvegarde du sort rejouée
 *    (carte de sauvegarde répétée : réussie, l'effet tombe) ; sans jet : l'effet tombe.
 *  - Une autre créature : par le menu contextuel du porteur (« Réveiller », « Libérer ») — elle vient au contact, y laisse son
 *    action, fait le test s'il y en a un.
 * L'effet d'une autre créature ne se retire pas depuis le client d'un joueur, et une carte de sauvegarde répétée se joue chez
 * le MJ : le MJ actif fait le geste (requête du cœur), après avoir relu la règle dans le contenu.
 */

import { MODULE_ID } from "../constants.mjs";
import { checkUse, spendUse } from "../core/turn.mjs";
import { actionEndingsOf } from "../adapter/action-end.mjs";
import { resaveAgainst } from "../adapter/areas.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { setStatus } from "../adapter/conditions.mjs";
import { combatantFor, readBudget, writeBudget, isOwnTurn } from "../adapter/turn.mjs";
import { joinToken } from "./actions.mjs";
import { saveActivityOf } from "./triggers.mjs";
import { log, loc, notice } from "./shared.mjs";

export const ACTION_END_QUERY = `${MODULE_ID}.actionEnd`;

/** MJ actif : l'effet tombe, ou sa sauvegarde est rejouée. La règle est relue ici — un client ne fait pas tomber n'importe quoi. */
async function handleActionEnd({ effect: uuid }) {
  const effect = await fromUuid(uuid ?? "");
  const actor = effect?.parent;
  if ( actor?.documentName !== "Actor" ) return false;
  const ending = [...actionEndingsOf(actor, "bearer"), ...actionEndingsOf(actor, "other")].find(e => e.effect === effect);
  if ( !ending ) return false;
  const token = tokenOf(actor);
  if ( ending.rule.roll === "save" ) {
    const origin = await fromUuid(effect.system?.origin?.activity ?? "");
    const activity = saveActivityOf(origin ?? ending.item.system.activities?.find?.(a => a.type === "save") ?? null);
    if ( (activity?.type !== "save") || !token ) { log(`${ending.item.name} : sauvegarde par une action impossible (activité de sauvegarde ou token introuvable)`); return false; }
    log(`${ending.item.name} : ${actor.name} rejoue la sauvegarde (action)`);
    await resaveAgainst(effect, activity, token, "action");
    return true;
  }
  log(`${ending.item.name} : « ${effect.name} » cesse sur ${actor.name} (action)`);
  if ( token ) notice(token, loc("Retour.FinEffet", { item: effect.name }), "ended");
  await effect.delete();
  // §49 : « en vous infligeant l'état À terre et en vous roulant par terre » (feu grégeois).
  if ( ending.rule.status ) await setStatus(actor, ending.rule.status, true);
  return true;
}

async function askExecutor(effect) {
  const gm = game.users.activeGM;
  if ( !gm ) { ui.notifications.warn(loc("Fin.SansMJ")); return false; }
  if ( gm.isSelf ) return handleActionEnd({ effect: effect.uuid });
  return gm.query(ACTION_END_QUERY, { effect: effect.uuid }, { timeout: 10000 }).catch(() => false);
}

/** Les effets du porteur qu'il fait cesser lui-même par une action. */
export const ownEndingsOf = actor => actionEndingsOf(actor, "bearer");

/** Les effets de `target` (TokenDocument) qu'une autre créature fait cesser par une action. */
export const endingsOn = target => actionEndingsOf(target?.actor, "other");

/**
 * Le porteur met fin à son effet — sauvegarde rejouée, ou fin sans jet. L'action est déjà payée (action de base « S'échapper »,
 * ou budget débité pour un PNJ : runtime/grapple.mjs). Le test d'un `roll: "check"` passe par l'évasion d'une entrave.
 * @returns {Promise<boolean>}  Le geste a-t-il été fait (pas : l'effet est-il tombé — une sauvegarde reste à jouer) ?
 */
export async function endOwn(ending) {
  return (await askExecutor(ending.effect)) === true;
}

/** Paie l'action de `token` en combat ; false (et la raison dite) si elle n'est pas disponible. Le MJ n'est jamais retenu. */
async function payAction(token) {
  const combatant = combatantFor(token.actor);
  if ( !combatant ) return true;
  const request = { cost: "action", weaponAttack: false, usesSpellSlot: false };
  const before = readBudget(combatant);
  const own = isOwnTurn(combatant);
  const issues = checkUse(before, request, { isOwnTurn: own });
  if ( issues.length && !game.user.isGM ) { ui.notifications.warn(loc(`Souci.${issues[0]}`)); return false; }
  await writeBudget(combatant, spendUse(before, request, { isOwnTurn: own, attacksPerAction: 1 }));
  return true;
}

/**
 * `token` met fin à un effet de `target` : il vient au contact, y laisse son action, fait le test s'il y en a un.
 * @returns {Promise<boolean>}  L'effet est-il tombé ?
 */
export async function endFor(token, target, ending) {
  const near = await joinToken(token, target);
  if ( !near.arrived ) { notice(token, loc("Fin.TropLoin", { name: target.name })); return false; }
  if ( !(await payAction(token)) ) return false;
  if ( ending.check ) {
    const { ability, skill, dc } = ending.check;
    const rolls = skill
      ? await token.actor.rollSkill({ skill, ...(ability ? { ability } : {}), target: dc }, { configure: false })
      : await token.actor.rollAbilityCheck({ ability, target: dc }, { configure: false });
    const total = rolls?.[0]?.total;
    if ( !Number.isFinite(total) ) return false;
    log(`${token.name} ${total >= dc ? "libère" : "ne libère pas"} ${target.name} de ${ending.item.name} (${total} contre DD ${dc})`);
    if ( total < dc ) { ui.notifications.info(loc("Fin.Rate", { name: token.name, target: target.name, source: ending.item.name })); return false; }
  }
  const done = (await askExecutor(ending.effect)) === true;
  if ( done ) log(`${token.name} met fin à ${ending.item.name} sur ${target.name}`);
  return done;
}

export function registerActionEnd() {
  CONFIG.queries[ACTION_END_QUERY] = handleActionEnd;
}
