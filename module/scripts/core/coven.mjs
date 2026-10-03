/**
 * Cercles (SPEC §19.5) : des créatures qui partagent une même réserve de points de vie — tout dégât subi par l'un des membres
 * est retiré de la réserve commune, et des dégâts d'une même source subis par plusieurs membres comptent autant de fois. Chaque
 * membre garde ses PV, tenus égaux : l'ÉCART subi par l'un est reporté sur les autres — deux coups simultanés comptent deux
 * fois, sans qu'une écriture efface l'autre.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * Les PV d'un membre après l'écart subi par un autre, bornés à [0, max]. null : rien à écrire (déjà à 0 sous des dégâts,
 * ou valeur inchangée).
 * @param {{value: number, max: number}} hp  Les PV du membre.
 * @param {number} delta                     L'écart subi par l'autre (négatif : dégâts).
 */
export function sharedValue(hp, delta) {
  if ( !Number.isFinite(delta) || (delta === 0) || !hp ) return null;
  if ( (delta < 0) && (hp.value <= 0) ) return null;
  const next = Math.max(0, Math.min(hp.max ?? Infinity, hp.value + delta));
  return (next === hp.value) ? null : next;
}
