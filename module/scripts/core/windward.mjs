/**
 * §403 : Bourrasque — « chaque mètre parcouru en direction de vous coûte 2 m de déplacement » dans la Ligne. Le surcoût d'un trajet :
 * pour chaque pas qui commence ou finit dans la zone et rapproche du lanceur, son coût une fois de plus. Pur.
 * @param {Array<{x: number, y: number, inside: boolean, cost?: number}>} points  Départ puis chaque point du trajet (`cost` : celui du
 *                                                                                  pas qui y mène).
 * @param {{x: number, y: number}} caster
 * @returns {number}
 */
export function windwardExtra(points, caster) {
  let extra = 0;
  const d = p => Math.hypot(p.x - caster.x, p.y - caster.y);
  for ( let i = 1; i < (points?.length ?? 0); i++ ) {
    const a = points[i - 1], b = points[i];
    if ( !(a.inside || b.inside) ) continue;
    if ( d(b) < d(a) - 1e-6 ) extra += Number(b.cost) || 0;
  }
  return extra;
}
