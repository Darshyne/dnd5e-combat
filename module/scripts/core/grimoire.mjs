/**
 * §139 : le grimoire du Magicien — rituels (Savoir rituel, et la règle générale des rituels) et Restauration magique. Ce qui se
 * calcule sans Foundry.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * Comment lancer un sort qui a l'étiquette Rituel (règle 2024 : « si vous l'avez préparé, vous pouvez le lancer en rituel : 10 minutes
 * de plus, sans dépenser d'emplacement » ; Savoir rituel du Magicien : « tout sort de votre grimoire qui a l'étiquette Rituel, même non
 * préparé, mais seulement en rituel »). Un rituel prend 10 minutes : jamais en combat.
 * @param {{ritual: boolean, requiresSlot: boolean, inCombat: boolean, prepared: boolean, adept: boolean, slotLeft: boolean}} c
 *   `adept` : le lanceur a Savoir rituel et le sort vient de son grimoire ; `slotLeft` : un emplacement du niveau du sort ou plus.
 * @returns {"none"|"ritual"|"ask"}  « ritual » : en rituel d'office ; « ask » : rituel ou emplacement, au joueur.
 */
export function ritualMode({ ritual, requiresSlot, inCombat, prepared, adept, slotLeft }) {
  if ( !ritual || !requiresSlot || inCombat ) return "none";
  if ( !prepared ) return adept ? "ritual" : "none";
  return slotLeft ? "ask" : "ritual";
}

/**
 * Restauration magique : « des emplacements dépensés dont la somme des niveaux ne dépasse pas la moitié de votre niveau de Magicien
 * (arrondie au supérieur), aucun du 6e niveau ou plus ».
 * @param {number} classLevel
 */
export function recoveryBudget(classLevel) {
  return Math.ceil((Number(classLevel) || 0) / 2);
}

/**
 * Les niveaux d'emplacement qu'on peut encore récupérer : dépensés (valeur sous le maximum), au plus `maxLevel` et au plus ce qui reste
 * du budget.
 * @param {Record<number, {value: number, max: number}>} slots  Par niveau.
 * @param {number} budget  Ce qui reste à récupérer, en niveaux.
 * @param {number} [maxLevel=5]
 * @returns {number[]}  Croissants.
 */
export function recoverableLevels(slots, budget, maxLevel=5) {
  const out = [];
  for ( let level = 1; level <= Math.min(maxLevel, budget); level++ ) {
    const s = slots?.[level];
    if ( s && (Number(s.value) < Number(s.max)) ) out.push(level);
  }
  return out;
}
