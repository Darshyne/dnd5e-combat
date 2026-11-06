/**
 * #33 (suite) : la ligne de visée tracée de l'attaquant à sa cible pendant le ciblage — découpée en tronçons colorés. Pur.
 *  - « clear » (vert) : la partie dégagée ;
 *  - « cover » (orange) : à partir de l'obstacle qui donne un abri partiel ou supérieur ;
 *  - « blocked » (rouge) : à partir de l'obstacle qui donne un abri total, ou au-delà de la portée (inatteignable) ;
 *  - « unseen » (bleu) : la partie dégagée quand l'attaquant ne voit pas sa cible (invisible, cachée, dans le noir).
 * Les positions sont des fractions de la ligne (0 : l'attaquant, 1 : la cible).
 */

const RANK = { clear: 0, unseen: 0, cover: 1, blocked: 2 };

/**
 * @param {object} state
 * @param {"none"|"half"|"threeQuarters"|"total"} state.degree   L'abri de la cible (aperçu).
 * @param {number|null} [state.obstacleAt]  Où la ligne rencontre ce qui donne l'abri (0–1) ; absent : au milieu.
 * @param {number|null} [state.rangeEnd]    Où finit la portée (0–1) ; null : la cible est à portée.
 * @param {boolean} [state.unreachable]     Toute la ligne est inatteignable (l'approche n'arrive pas).
 * @param {boolean} [state.unseen]          L'attaquant ne voit pas la cible.
 * @returns {Array<{from: number, to: number, kind: "clear"|"unseen"|"cover"|"blocked"}>}
 */
export function attackLineSegments({ degree="none", obstacleAt=null, rangeEnd=null, unreachable=false, unseen=false }) {
  const base = unseen ? "unseen" : "clear";
  if ( unreachable ) return [{ from: 0, to: 1, kind: "blocked" }];
  const clamp = t => Math.min(1, Math.max(0, t));
  const marks = [];
  if ( degree !== "none" ) marks.push({ at: clamp(obstacleAt ?? 0.5), kind: (degree === "total") ? "blocked" : "cover" });
  if ( Number.isFinite(rangeEnd) && (rangeEnd < 1) ) marks.push({ at: clamp(rangeEnd), kind: "blocked" });
  const cuts = [...new Set([0, ...marks.map(m => m.at), 1])].sort((a, b) => a - b);
  const segments = [];
  for ( let i = 0; i < cuts.length - 1; i++ ) {
    const from = cuts[i], to = cuts[i + 1];
    if ( to - from < 1e-9 ) continue;
    let kind = base;
    for ( const m of marks ) if ( (m.at <= from + 1e-9) && (RANK[m.kind] > RANK[kind]) ) kind = m.kind;
    const last = segments.at(-1);
    if ( last?.kind === kind ) last.to = to;
    else segments.push({ from, to, kind });
  }
  return segments;
}

/**
 * Où le segment [a, b] entre dans un rectangle (fraction 0–1), ou null s'il ne le traverse pas (Liang–Barsky).
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number, width: number, height: number}} rect
 */
export function segmentEntry(a, b, rect) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for ( const [p, q] of [[-dx, a.x - rect.x], [dx, rect.x + rect.width - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.height - a.y]] ) {
    if ( p === 0 ) { if ( q < 0 ) return null; continue; }
    const r = q / p;
    if ( p < 0 ) { if ( r > t1 ) return null; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return null; if ( r < t1 ) t1 = r; }
  }
  return (t1 - t0 > 1e-9) ? t0 : null;
}
