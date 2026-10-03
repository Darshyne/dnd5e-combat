/**
 * Compteur de sauvegardes répétées (SPEC §43.1) : « jusqu'à trois réussites ou trois échecs » — Contagion, Pétrification.
 * Les réussites et les échecs n'ont pas à se suivre ; seules comptent les sauvegardes REJOUÉES (pas celle du lancement).
 * Pur : l'état vit dans un flag de l'effet, le moteur l'écrit.
 */

/**
 * L'état du compteur après une sauvegarde.
 * @param {{successes?: number, failures?: number}|null} state   L'état d'avant (flag de l'effet), ou rien.
 * @param {boolean} success                                      La sauvegarde vient-elle d'être réussie ?
 * @param {{successes: number, failures: number}} rule           Les seuils.
 * @returns {{successes: number, failures: number, settled: boolean, outcome: "ended"|"settled"|null}}
 *   `ended` : le seuil de réussites est atteint, l'effet tombe ; `settled` : le seuil d'échecs est atteint, l'effet reste et
 *   plus aucune sauvegarde n'est rejouée.
 */
export function tallyAfter(state, success, rule) {
  const successes = (Number(state?.successes) || 0) + (success ? 1 : 0);
  const failures = (Number(state?.failures) || 0) + (success ? 0 : 1);
  const outcome = (successes >= rule.successes) ? "ended" : ((failures >= rule.failures) ? "settled" : null);
  return { successes, failures, settled: outcome === "settled", outcome };
}

/** Le compteur est-il clos (seuil d'échecs atteint) ? Plus de sauvegarde à rejouer. */
export const tallySettled = state => state?.settled === true;
