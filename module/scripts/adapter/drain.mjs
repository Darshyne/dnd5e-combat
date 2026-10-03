/**
 * M8 (SPEC §18.16) : le drain du maximum de PV vu depuis Foundry — l'item (contenu `drain`, par identifiant ; le texte anglais
 * d'origine doit le dire : « bite » et « slam » sont des identifiants partagés), et la réduction par le type de dégâts
 * `maximum` de dnd5e 6 (documents/actor/actor.mjs:877, 940-950 : `hp.tempmax` baisse ; un repos long le remet à zéro,
 * actor.mjs:2578).
 */

import { readDrain } from "../core/drain.mjs";
import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";

/** @returns {{equal: boolean, type: string|null, regains: boolean, fixed: string|null}|null} */
export function drainOf(item) {
  if ( !item || (contentOf(item).entry?.drain !== true) ) return null;
  const rule = readDrain(englishDescription(item));
  return (rule.equal || rule.fixed) ? rule : null;
}

/** L'item d'où viennent des dégâts : le message d'origine (`originatingMessage` des boutons de carte, `origin` du moteur). */
export function damageSourceItem(options) {
  const message = options?.originatingMessage ?? options?.origin ?? null;
  return message?.getAssociatedActivity?.()?.item ?? message?.getAssociatedItem?.() ?? null;
}

/**
 * Baisse le maximum de PV de `n` (les PV suivent s'ils dépassent le nouveau maximum). Rend le maximum en vigueur :
 * `hp.effectiveMax` = `max` + `tempmax` (data/actor/templates/attributes.mjs:468) — `hp.max` reste le maximum de base.
 */
export async function reduceMaximum(actor, n) {
  if ( n > 0 ) await actor.applyDamage([{ value: n, type: "maximum" }], { ignore: true });
  const hp = actor.system.attributes.hp;
  return hp.effectiveMax ?? (hp.max + (hp.tempmax ?? 0));
}
