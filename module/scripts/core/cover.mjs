/**
 * L'abri (SPEC §14.1, P1 b ; règles 2024 et méthode du DMG sur quadrillage) : depuis un coin de
 * l'espace de l'attaquant — le meilleur pour lui —, tracer une ligne vers chacun des quatre coins
 * de l'espace de la cible. Aucune ligne bloquée : pas d'abri ; une ou deux : abri partiel (+2 CA) ;
 * trois : abri supérieur (+5) ; quatre : abri total (intouchable). Une créature interposée
 * ne donne jamais plus qu'un abri partiel (2024), qu'elle soit alliée ou ennemie de la cible.
 *
 * Géométrie en pixels ; ce qui bloque une ligne (murs, surfaces) est un prédicat fourni par
 * l'adaptateur. Les coins sont rentrés d'un peu (`inset`) : une ligne qui longe exactement un mur
 * ou frôle le coin d'une créature ne compte pas. Fonctions pures, aucune dépendance à Foundry.
 */

/** Tailles dont le corps, même mort, reste un obstacle (demande de l'utilisateur 2026-09-26). */
const CORPSE_COVER_SIZES = Object.freeze(["lg", "huge", "grg"]);

/**
 * Le corps d'une créature interposée donne-t-il l'abri ? Vivante, toujours ; morte, seulement si elle est Grande ou plus
 * (un cadavre de taille moyenne ou moins, couché au sol, ne couvre pas).
 * @param {{dead: boolean, size?: string}} body
 */
export function bodyGivesCover({ dead, size }) {
  return !dead || CORPSE_COVER_SIZES.includes(size);
}

/** Les degrés d'abri et leur bonus à la CA ; `null` = intouchable. */
export const COVER = Object.freeze({
  none: { bonus: 0 },
  half: { bonus: 2 },
  threeQuarters: { bonus: 5 },
  total: { bonus: null }
});

const DEGREES = ["none", "half", "half", "threeQuarters", "total"];

/**
 * @typedef {object} Rect
 * @property {number} x  Coin haut-gauche.
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/** Le rectangle rentré de `inset` de chaque côté (jamais au-delà de son centre). */
export function shrink(rect, inset) {
  const dx = Math.min(inset, rect.width / 2 - 1e-6);
  const dy = Math.min(inset, rect.height / 2 - 1e-6);
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width - 2 * dx, height: rect.height - 2 * dy };
}

/** Les quatre coins d'un rectangle. */
export function corners({ x, y, width, height }) {
  return [{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }];
}

/** Le segment [a, b] traverse-t-il l'INTÉRIEUR du rectangle ? (Liang–Barsky ; longer un bord ne compte pas) */
export function segmentCrossesRect(a, b, rect) {
  const eps = 1e-6;
  const x0 = rect.x + eps, y0 = rect.y + eps, x1 = rect.x + rect.width - eps, y1 = rect.y + rect.height - eps;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for ( const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] ) {
    if ( p === 0 ) { if ( q < 0 ) return false; continue; }
    const r = q / p;
    if ( p < 0 ) { if ( r > t1 ) return false; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return false; if ( r < t1 ) t1 = r; }
  }
  return t1 - t0 > 1e-9;   // une simple tangence (un coin effleuré) ne compte pas
}

/**
 * L'abri dont une cible bénéficie contre un attaquant.
 * @param {object} context
 * @param {Rect} context.attacker                     Espace de l'attaquant.
 * @param {Rect} context.target                       Espace de la cible.
 * @param {Rect[]} [context.bodies]                   Espaces des autres créatures (ni l'attaquant, ni la cible).
 * @param {(a: {x,y}, b: {x,y}) => boolean} [context.blocked]  Un obstacle (mur, surface) coupe-t-il la ligne ?
 * @param {number} [context.inset]                    Retrait des coins et des corps, en pixels.
 * @returns {{degree: "none"|"half"|"threeQuarters"|"total", bonus: number|null, blockedLines: number, byCreature: boolean}}
 */
export function coverBetween({ attacker, target, bodies=[], blocked=() => false, inset=0 }) {
  const from = corners(shrink(attacker, inset));
  const to = corners(shrink(target, inset));
  const solids = bodies.map(r => shrink(r, inset));
  let best = null;
  for ( const a of from ) {
    let walls = 0;
    let creatures = 0;
    for ( const b of to ) {
      if ( blocked(a, b) ) walls++;
      else if ( solids.some(r => segmentCrossesRect(a, b, r)) ) creatures++;
    }
    let degree = DEGREES[walls];
    let byCreature = false;
    if ( (degree === "none") && creatures ) { degree = "half"; byCreature = true; }
    const rank = DEGREES.indexOf(degree);
    // L'attaquant choisit le coin qui laisse le moins d'abri à sa cible.
    if ( !best || (rank < best.rank) ) best = { rank, degree, blockedLines: walls + (byCreature ? creatures : 0), byCreature };
    if ( best.rank === 0 ) break;
  }
  return { degree: best.degree, bonus: COVER[best.degree].bonus, blockedLines: best.blockedLines, byCreature: best.byCreature };
}
