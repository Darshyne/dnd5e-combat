/**
 * Défenses de sorts en marche (SPEC §16.46). Résistance : dans l'application des dégâts par le moteur (adapter/messages.mjs,
 * runtime/engine.mjs). Vigueur arcanique : l'intention « dépenser ces dés de vie » (fenêtre de ui/vigor.mjs).
 */

import { spendHitDiceToHeal } from "../adapter/defenses.mjs";
import { log } from "./shared.mjs";

/** §16.46 : intention « dépenser `count` dés de vie `die` pour se soigner ». */
export async function healWithHitDice(activity, die, count) {
  const roll = await spendHitDiceToHeal(activity, die, count);
  if ( roll ) log(`${activity.actor.name}: ${activity.item.name}, ${count}${die} → ${roll.total} HP`);
  return roll;
}

export function registerDefenses() {
  // Rien à brancher : la réduction passe par l'application des dégâts du moteur (§16.46).
}
