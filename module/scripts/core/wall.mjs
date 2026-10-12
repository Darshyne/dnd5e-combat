/**
 * §162 : un mur posé par points (Mur de feu, Mur de force en panneaux, Barrière de lames…). Le joueur désigne deux points ou plus ; le
 * mur suit la ligne brisée, au plus sa longueur totale. Chaque segment devient une forme « line » de la région (origine, angle,
 * longueur, épaisseur — comme une ligne visée, adapter/self-area.mjs), et le moteur pose, le long de chacun, les murs du cœur que le sort
 * demande (`walls` du contenu). Géométrie pure, en pixels ; aucune dépendance à Foundry.
 */

/** Longueur d'une ligne brisée. */
export function polylineLength(points) {
  let total = 0;
  for ( let i = 1; i < points.length; i++ ) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

/**
 * La ligne brisée ramenée à `max` de long : les points au-delà sont retirés, le dernier segment raccourci. Les points confondus sont
 * écartés.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} max   Longueur maximale (Infinity : sans limite).
 * @returns {Array<{x: number, y: number}>}
 */
export function clampPolyline(points, max=Infinity) {
  const out = [];
  let left = max;
  for ( const p of points ) {
    if ( !out.length ) { out.push({ x: p.x, y: p.y }); continue; }
    const a = out.at(-1);
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if ( d < 1e-6 ) continue;
    if ( d <= left + 1e-6 ) { out.push({ x: p.x, y: p.y }); left -= d; continue; }
    if ( left > 1e-6 ) out.push({ x: a.x + ((p.x - a.x) * left) / d, y: a.y + ((p.y - a.y) * left) / d });
    break;
  }
  return out;
}

/**
 * Les formes « line » d'une ligne brisée : une par segment, de l'épaisseur donnée.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} width   Épaisseur, en pixels.
 * @returns {Array<{type: "line", x: number, y: number, rotation: number, length: number, width: number}>}
 */
export function wallLineShapes(points, width) {
  const shapes = [];
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if ( length < 1e-6 ) continue;
    shapes.push({ type: "line", x: a.x, y: a.y, rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, length, width });
  }
  return shapes;
}

/** L'axe d'une forme « line » : ses deux extrémités, arrondies au pixel (les murs du cœur ont des coordonnées entières). */
export function lineAxis({ x, y, rotation, length }) {
  const r = (rotation * Math.PI) / 180;
  return [Math.round(x), Math.round(y), Math.round(x + (Math.cos(r) * length)), Math.round(y + (Math.sin(r) * length))];
}

/** Les arêtes d'un polygone fermé (`[x0, y0, x1, y1, …]`), en segments `[x1, y1, x2, y2]` arrondis. */
export function polygonEdges(flat) {
  const n = Math.floor(flat.length / 2);
  const edges = [];
  for ( let i = 0; i < n; i++ ) {
    const j = (i + 1) % n;
    const edge = [flat[2 * i], flat[(2 * i) + 1], flat[2 * j], flat[(2 * j) + 1]].map(Math.round);
    if ( (edge[0] !== edge[2]) || (edge[1] !== edge[3]) ) edges.push(edge);
  }
  return edges;
}
