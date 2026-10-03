/**
 * §70 : l'orage d'Appel de la foudre — géométrie pure (aucune dépendance à Foundry).
 */

/**
 * Le point le plus proche de `point` à l'intérieur d'un cercle (le nuage) : le point lui-même s'il y est, sinon sa projection
 * sur le bord. « Un point que vous voyez sous le nuage » : l'éclair ne tombe pas hors de l'orage.
 * @param {{x: number, y: number}} point
 * @param {{x: number, y: number}} center
 * @param {number} radius
 * @returns {{x: number, y: number}}
 */
export function clampToCircle(point, center, radius) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const d = Math.hypot(dx, dy);
  if ( (d <= radius) || !(d > 0) ) return { x: point.x, y: point.y };
  return { x: center.x + ((dx / d) * radius), y: center.y + ((dy / d) * radius) };
}
