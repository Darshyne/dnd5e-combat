/**
 * Discrétion naturelle (Halfelin, SRD 5.2) : « vous pouvez prendre l'action Se cacher même quand vous n'êtes masqué que par une
 * créature d'au moins une taille de plus que vous ». Le moteur demande, pour se cacher, qu'aucun ennemi ne vous voie ; une créature ne
 * coupe pas la vue. Pour le porteur de ce trait, un ennemi dont la ligne de vue passe par l'espace d'une telle créature ne compte
 * plus. Fonctions pures : des points et des rectangles en pixels.
 */

const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];

/** `size` est-elle d'au moins `steps` tailles au-dessus de `than` ? Taille inconnue : non. */
export function largerBy(size, than, steps=1) {
  const a = SIZES.indexOf(size), b = SIZES.indexOf(than);
  return (a >= 0) && (b >= 0) && (a - b >= steps);
}

/** Le segment [p, q] traverse-t-il le rectangle (bords compris) ? Liang–Barsky. */
export function segmentCrossesRect(p, q, rect) {
  const dx = q.x - p.x, dy = q.y - p.y;
  let t0 = 0, t1 = 1;
  for ( const [d, lo, hi, o] of [[dx, rect.x, rect.x + rect.width, p.x], [dy, rect.y, rect.y + rect.height, p.y]] ) {
    if ( d === 0 ) { if ( (o < lo) || (o > hi) ) return false; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if ( a > b ) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if ( t0 > t1 ) return false;
  }
  return true;
}

const center = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/**
 * L'observateur ne voit-il le porteur qu'à travers une créature d'au moins une taille de plus que lui ? La ligne d'un centre à l'autre
 * doit traverser l'espace de cette créature.
 * @param {{x: number, y: number, width: number, height: number}} observer  l'espace de l'observateur
 * @param {{rect: object, size: string}} hider                             l'espace et la taille de qui se cache
 * @param {Array<{rect: object, size: string}>} bodies                     les autres créatures debout de la scène
 */
export function screenedByLarger(observer, hider, bodies) {
  const from = center(observer), to = center(hider.rect);
  return (bodies ?? []).some(b => largerBy(b.size, hider.size) && segmentCrossesRect(from, to, b.rect));
}
