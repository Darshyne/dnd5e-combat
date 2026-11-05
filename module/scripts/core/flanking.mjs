/**
 * §369 (issue GitHub #27) : la prise en tenaille, règle optionnelle du DMG 2014 (absente du DMG 2024) — désactivée par défaut.
 * Une créature et un de ses alliés au contact d'un ennemi, de part et d'autre de lui, ont l'Avantage à leurs attaques au corps à
 * corps contre lui. « De part et d'autre » : la ligne qui joint le centre d'une case de l'un au centre d'une case de l'autre
 * traverse deux côtés opposés (ou deux coins opposés) de l'espace de l'ennemi ; pour une créature Grande ou plus, il suffit qu'une
 * de ses cases convienne.
 *
 * Grille carrée seulement. Les espaces sont des rectangles EN CASES ({x, y, w, h} : coin haut-gauche, largeur, hauteur) ; le
 * contact en hauteur (élévation) se juge à part, en 3D, par l'adaptateur. Pur : aucune dépendance à Foundry.
 */

const EPS = 1e-6;

/** Les modes du réglage `flanking`. */
export const FLANKING_MODES = Object.freeze(["off", "advantage"]);
/** Qui en profite (réglage `flankingSide`) : tout le monde, les PJ seulement, les PNJ seulement. */
export const FLANKING_SIDES = Object.freeze(["all", "pc", "npc"]);

/** Le centre de chaque case d'un espace (une demi-case au moins pour un Très petit). */
export function cellCenters({ x, y, w=1, h=1 }) {
  const offsets = size => ((size < 1) ? [size / 2] : Array.from({ length: Math.max(1, Math.round(size)) }, (_, k) => k + 0.5));
  return offsets(h).flatMap(oy => offsets(w).map(ox => ({ x: x + ox, y: y + oy })));
}

/** La case de centre `c` touche-t-elle l'espace `box` (côté ou coin), sans le chevaucher ? */
export function touchesBox(c, box) {
  const gapX = Math.max(box.x - (c.x + 0.5), (c.x - 0.5) - (box.x + box.w));
  const gapY = Math.max(box.y - (c.y + 0.5), (c.y - 0.5) - (box.y + box.h));
  if ( (gapX > EPS) || (gapY > EPS) ) return false;
  return (gapX > -EPS) || (gapY > -EPS);   // chevauchement strict sur les deux axes : la case est dans l'espace
}

/**
 * Le segment p → q traverse-t-il l'espace `box` d'un côté au côté opposé (ou d'un coin au coin opposé) ?
 * Découpe de Liang–Barsky, puis les côtés touchés à l'entrée et à la sortie.
 */
export function crossesOpposite(p, q, box) {
  const dx = q.x - p.x, dy = q.y - p.y;
  let t0 = 0, t1 = 1;
  const clip = (pk, qk) => {
    if ( Math.abs(pk) < EPS ) return qk >= -EPS;
    const r = qk / pk;
    if ( pk < 0 ) { if ( r > t1 ) return false; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return false; if ( r < t1 ) t1 = r; }
    return true;
  };
  const x0 = box.x, x1 = box.x + box.w, y0 = box.y, y1 = box.y + box.h;
  if ( !clip(-dx, p.x - x0) || !clip(dx, x1 - p.x) || !clip(-dy, p.y - y0) || !clip(dy, y1 - p.y) ) return false;
  if ( (t1 - t0) < EPS ) return false;   // ne fait qu'effleurer un coin
  const sides = t => {
    const x = p.x + (t * dx), y = p.y + (t * dy);
    return { L: Math.abs(x - x0) < EPS, R: Math.abs(x - x1) < EPS, T: Math.abs(y - y0) < EPS, B: Math.abs(y - y1) < EPS };
  };
  const a = sides(t0), b = sides(t1);
  return (a.L && b.R) || (a.R && b.L) || (a.T && b.B) || (a.B && b.T);
}

/**
 * Deux créatures prennent-elles cet ennemi en tenaille ? Chacune doit avoir au moins une case au contact de son espace, et une
 * paire de ces cases doit être de part et d'autre.
 * @param {{x:number,y:number,w:number,h:number}} target
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 */
export function flanks(target, a, b) {
  const near = space => cellCenters(space).filter(c => touchesBox(c, target));
  const ca = near(a), cb = near(b);
  return ca.some(p => cb.some(q => crossesOpposite(p, q, target)));
}

/**
 * Le réglage laisse-t-il cet attaquant profiter de la tenaille ?
 * @param {{mode: string, side: string, attackerIsPc: boolean}} options
 */
export function flankingApplies({ mode, side="all", attackerIsPc }) {
  if ( mode !== "advantage" ) return false;
  if ( side === "pc" ) return !!attackerIsPc;
  if ( side === "npc" ) return !attackerIsPc;
  return true;
}
