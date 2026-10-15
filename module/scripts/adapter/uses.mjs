/**
 * Les utilisations d'un item (`system.uses` de dnd5e) dépensées par le moteur hors d'une activité : une réaction payée par un autre
 * item, un châtiment, un don qui sert une fois par repos…
 */

/** Dépenser `n` utilisations de l'item (`system.uses.spent`). Rend la promesse de la mise à jour. */
export function spendItemUses(item, n=1) {
  return item.update({ "system.uses.spent": (Number(item.system.uses?.spent) || 0) + n });
}
