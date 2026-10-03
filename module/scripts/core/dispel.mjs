/**
 * §37.2 : Dissipation de la magie (Manuel des joueurs 2024) — les sorts actifs sur la cible jusqu'au niveau 3 sont dissipés sans
 * jet ; au-delà, chacun demande un test de la caractéristique d'incantation contre un DD de 10 + son niveau. Lancée avec un
 * emplacement de niveau 4 ou plus, elle dissipe aussi sans jet tout sort dont le niveau ne dépasse pas celui de l'emplacement.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** Jusqu'à quel niveau un sort cesse d'office, pour une Dissipation lancée à ce niveau (3 au moins). */
export function autoDispelLevel(slotLevel) {
  return Math.max(3, Number(slotLevel) || 3);
}

/**
 * Ce qui arrive à chaque sort en cours : `auto` (il cesse), ou un test contre `dc`.
 * @param {Array<{key: string, level: number}>} spells  Un par sort lancé (niveau de lancement).
 * @param {number} slotLevel                            Niveau auquel la Dissipation est lancée.
 * @returns {Array<{key: string, level: number, auto: boolean, dc: number|null}>}
 */
export function dispelPlan(spells, slotLevel) {
  const upTo = autoDispelLevel(slotLevel);
  return spells.map(({ key, level }) => {
    const lvl = Math.max(0, Number(level) || 0);
    return (lvl <= upTo) ? { key, level: lvl, auto: true, dc: null } : { key, level: lvl, auto: false, dc: 10 + lvl };
  });
}
