/**
 * §19.9 : la morsure qui renforce (contenu `empower`, Morsure vampirique du Dhampir) vue depuis dnd5e 6.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - les utilisations d'un item : `system.uses.value` = max - spent (data/shared/uses-field.mjs), qu'on dépense en écrivant
 *    `system.uses.spent` ;
 *  - un changement d'effet `system.bonuses.mwak.attack` (et rwak, msak, rsak) s'ajoute au jet d'attaque, et
 *    `system.bonuses.abilities.check` aux tests de caractéristique et de compétence : c'est ce que porte l'effet
 *    « Strengthened Attack or Check » du module Ravenloft, avec `@abilities.con.mod` en valeur — remplacée ici par le montant.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { creatureTypeOf } from "./facts.mjs";

/** La règle `empower` d'un item, ou null. */
export function empowerOf(item) {
  return item ? (contentOf(item).entry?.empower ?? null) : null;
}

/** La créature mordue peut-elle renforcer ? (ni Créature artificielle, ni Mort-vivant) */
export function feedsOn(rule, actor) {
  return !!actor && !(rule.excludeTypes ?? []).includes(creatureTypeOf(actor));
}

export const usesLeft = item => Math.max(0, item?.system?.uses?.value ?? 0);

export async function spendUse(item) {
  await item.update({ "system.uses.spent": (item.system.uses.spent ?? 0) + 1 });
}

/** Les effets de renforcement en cours d'un acteur (ceux que le moteur a posés). */
export const boostsOf = actor => (actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "consumeOn"));

/**
 * L'effet de renforcement de l'item, ses changements valant `n` : jusqu'au prochain jet d'attaque ou test de caractéristique,
 * une minute au plus. Rend les données à créer, ou null si l'item n'a pas l'effet.
 */
export function boostData(item, rule, n) {
  const effect = item.effects.get(rule.effect);
  if ( !effect ) return null;
  const data = effect.toObject();
  delete data._id;
  const changes = (data.system?.changes ?? data.changes ?? []).map(c => ({ ...c, value: String(n) }));
  if ( data.system?.changes ) data.system.changes = changes;
  else data.changes = changes;
  return foundry.utils.mergeObject(data, {
    name: `${effect.name} (+${n})`,
    disabled: false,
    transfer: false,
    origin: item.uuid,
    // La durée est celle de l'effet de l'item (60 secondes) ; le cœur V14 date son début à la création (`start`).
    duration: { value: 60, units: "seconds" },
    [`flags.${MODULE_ID}.consumeOn`]: ["attack", "check"],
    [`flags.${MODULE_ID}.boost`]: { item: item.uuid, amount: n }
  }, { inplace: false });
}
