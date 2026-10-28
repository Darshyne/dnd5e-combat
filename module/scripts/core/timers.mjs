/**
 * §272 : minuteries au-dessus des tokens (fouille, désamorçage, tout geste qui prend du temps) — ce qui se calcule sans Foundry.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Le dégradé du logo DAS (site darshyne.github.io, `--logo`), de gauche à droite. */
export const TIMER_GRADIENT = Object.freeze(["#e005f4", "#ee0388", "#fc0016"]);

/** Dimensions de la jauge, en fraction de la largeur d'une case, et ses bords. */
export const TIMER_LAYOUT = Object.freeze({ width: 0.9, height: 0.12, gap: 0.08, outline: 2, iconSize: 0.26 });

/**
 * Où en est une minuterie lancée à `startedAt` (ms) pour `seconds` secondes, à l'instant `now` (ms).
 * @returns {{pct: number, left: number, done: boolean}}  `left` : secondes restantes, arrondies au-dessus.
 */
export function timerState({ startedAt, seconds }, now) {
  const total = Math.max(0, Number(seconds) || 0) * 1000;
  if ( !(total > 0) ) return { pct: 1, left: 0, done: true };
  const elapsed = Math.max(0, now - startedAt);
  const pct = Math.min(1, elapsed / total);
  return { pct, left: Math.max(0, Math.ceil((total - elapsed) / 1000)), done: elapsed >= total };
}

/** Le texte des secondes restantes (« 4 s »), ou rien quand la table les masque. */
export function timerSecondsText(left, { hideSeconds=false, unit="s" }={}) {
  if ( hideSeconds || !Number.isFinite(left) ) return "";
  return `${left} ${unit}`;
}
