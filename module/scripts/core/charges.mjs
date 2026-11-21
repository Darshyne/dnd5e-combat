/**
 * Utilisation d'objets magiques (Roublard, Voleur 13 — SRD 5.2), Charges : « chaque fois que vous utilisez une propriété d'objet
 * magique qui dépense des charges, lancez 1d6 ; sur un 6, vous utilisez la propriété sans dépenser les charges ». Fonctions pures.
 */

/**
 * Cette activité dépense-t-elle des charges d'un objet magique ? Un objet magique qui n'est pas un consommable (une potion bue, un
 * parchemin lu ne sont pas des charges), dont l'activité consomme ses propres utilisations, et qui en compte plusieurs ou les
 * regagne.
 * @param {object} use
 * @param {boolean} use.magical      l'objet est magique
 * @param {boolean} use.consumable   l'objet est un consommable
 * @param {number} use.usesMax       ses utilisations au maximum
 * @param {boolean} use.recovers     il regagne des utilisations (à l'aube…)
 * @param {Array<{type: string, target?: string}>} use.targets  les consommations de l'activité
 * @param {string} use.itemId
 */
export function spendsCharges({ magical, consumable, usesMax, recovers, targets, itemId }) {
  if ( !magical || consumable || !((usesMax > 1) || recovers) ) return false;
  return (targets ?? []).some(t => (t.type === "itemUses") && (!t.target || (t.target === itemId)));
}

/** Le dé garde-t-il les charges ? */
export function chargesKept(roll, rule) {
  return Number.isFinite(roll) && (roll >= (rule?.on ?? Infinity));
}
