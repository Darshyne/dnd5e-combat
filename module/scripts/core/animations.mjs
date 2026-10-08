/**
 * §112 : synchroniser l'application d'une résolution avec les animations (Sequencer, que BLFX emploie) — quelles animations
 * attendre. Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * Les animations en cours qui concernent ces tokens : parties ou arrivées sur l'un d'eux, pas persistantes (une aura, une zone qui
 * dure ne finit jamais), commencées depuis moins de `recentMs` (l'animation d'un lancer de sort fini depuis longtemps ne compte pas).
 * @param {Array<{id: string, source: string|null, target: string|null, persist: boolean, started: number, ended: boolean}>} effects
 * @param {Iterable<string>} uuids   Les tokens de la résolution (l'auteur, les cibles).
 * @param {number} now
 * @param {{recentMs?: number}} [options]
 * @returns {string[]}  Les ids des animations à attendre.
 */
export function relevantAnimations(effects, uuids, now, { recentMs=3000 }={}) {
  const wanted = new Set([...uuids].filter(Boolean));
  if ( !wanted.size ) return [];
  return (effects ?? []).filter(e => !e.ended && !e.persist && ((now - e.started) <= recentMs)
    && (wanted.has(e.source) || wanted.has(e.target))).map(e => e.id);
}
