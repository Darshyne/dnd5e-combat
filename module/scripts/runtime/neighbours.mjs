/**
 * §102 : ce que le moteur offre aux modules voisins pour le budget du tour — savoir si une dépense est possible, et la faire
 * (Darsh Loot : « Fouiller les environs » coûte l'action Observation en combat). Le moteur n'en connaît aucun : c'est l'API
 * publique `api.budget`. Même schéma que le déplacement d'une zone (runtime/zones.mjs `handleMoveZone`).
 */
import { checkUse, spendUse, basicAction, BASIC_ACTION_FLAGS } from "../core/turn.mjs";
import { windowDisengaged } from "./reactions.mjs";
import { combatantFor, isOwnTurn, readBudget, writeBudget } from "../adapter/turn.mjs";

const request = cost => ({ cost, weaponAttack: false, usesSpellSlot: false });

/** Le combattant de cet acteur dans le combat commencé, ou null (hors combat : rien ne coûte). */
function combatantOf(actor) {
  if ( !actor || !game.combat?.started ) return null;
  return combatantFor(actor) ?? null;
}

/**
 * Ce qui empêche cette dépense (« notYourTurn », « noAction », « noBonus », « noReaction ») ; liste vide si elle est possible,
 * ou si l'acteur n'est pas en combat.
 * @param {Actor} actor
 * @param {"action"|"bonus"|"reaction"} [cost="action"]
 */
export function budgetIssues(actor, cost="action") {
  const combatant = combatantOf(actor);
  if ( !combatant ) return [];
  return checkUse(readBudget(combatant), request(cost), { isOwnTurn: isOwnTurn(combatant) });
}

/**
 * Dépenser une action (ou une action Bonus, une réaction) du budget de cet acteur, s'il est en combat. À appeler chez le MJ
 * actif (le budget est un drapeau du combattant). Rend vrai si une dépense a été écrite.
 */
export async function spendBudget(actor, cost="action") {
  const combatant = combatantOf(actor);
  if ( !combatant ) return false;
  await writeBudget(combatant, spendUse(readBudget(combatant), request(cost), { isOwnTurn: isOwnTurn(combatant), attacksPerAction: 1 }));
  return true;
}

/** §179 : les actions de base qu'un voisin peut faire prendre à une créature sans item (un PNJ n'a pas ceux du moteur). */
export const TAKEABLE_BASICS = Object.freeze(["dash", "disengage", "dodge"]);

/**
 * §179 : faire prendre une action de base à une créature en combat (Foncer, Se désengager, Esquiver), comme son item le ferait :
 * l'action dépensée et l'état du tour posé (déplacement doublé, pas d'attaque d'opportunité, Esquive) ; Se désengager ouvre aussi
 * les réactions à un désengagement (Sentinelle). Chez le MJ actif. Rend vrai si c'est fait ; faux hors combat, hors de son tour,
 * sans action, ou déjà pris.
 * @param {Actor} actor
 * @param {"dash"|"disengage"|"dodge"} kind
 */
export async function takeBasicAction(actor, kind) {
  if ( !TAKEABLE_BASICS.includes(kind) ) throw new Error(`basic action "${kind}" cannot be taken this way (${TAKEABLE_BASICS.join(", ")})`);
  const combatant = combatantOf(actor);
  if ( !combatant ) return false;
  const before = readBudget(combatant);
  if ( before[BASIC_ACTION_FLAGS[kind]] ) return false;
  if ( checkUse(before, request("action"), { isOwnTurn: isOwnTurn(combatant) }).length ) return false;
  await writeBudget(combatant, basicAction(before, kind));
  if ( (kind === "disengage") && combatant.token ) windowDisengaged(combatant.token);
  return true;
}
