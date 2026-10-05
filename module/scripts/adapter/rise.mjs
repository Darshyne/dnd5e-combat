/**
 * §95 : se relever à 0 PV (clé `atZero`) — Cosse nécrotique (Patron Mort-vivant : Résurrection impie), Puissance de l'ombre (Force du
 * tombeau), Puissance ancestrale (Courroux persistant, sous Courroux sauvage). L'item, sa règle et son activité, tant que la créature
 * est à 0 PV, pas morte, qu'il reste de quoi payer et que la condition tient ; une créature qui a déjà décidé (refusé, raté) est
 * notée jusqu'à ce que ses PV remontent.
 */

import { contentOf } from "./content.mjs";
import { carriesEffectFrom } from "./facts.mjs";
import { usesLeftFor } from "./inspiration.mjs";

const settled = new Set();
const pending = new Set();

/** La question ou la sauvegarde est en cours : la créature ne tombe pas encore (adapter/death.mjs). */
export const beginRise = actor => pending.add(actor.uuid);
export const endRise = actor => pending.delete(actor.uuid);
/** Se relèvera peut-être : une règle disponible, ou une décision en cours. */
export const risingAtZero = actor => !!actor && (pending.has(actor.uuid) || !!riseAtZeroOf(actor));

/** La créature a décidé (relevée, refusé, sauvegarde ratée) : plus de question jusqu'à ce que ses PV remontent. */
export const settleRise = actor => settled.add(actor.uuid);
export const resetRise = actor => settled.delete(actor.uuid);

/** @returns {{item: Item5e, rule: object, activity: Activity}|null} */
export function riseAtZeroOf(actor) {
  if ( !actor || settled.has(actor.uuid) || actor.statuses?.has("dead") ) return null;
  if ( (actor.system?.attributes?.hp?.value ?? 1) > 0 ) return null;
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.atZero;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !(usesLeftFor(activity) > 0) ) continue;
    if ( rule.whileEffect && !carriesEffectFrom(actor, rule.whileEffect) ) continue;
    return { item, rule, activity };
  }
  return null;
}
