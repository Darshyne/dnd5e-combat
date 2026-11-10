/**
 * Ordre imposé (SPEC §16.59) : Injonction — « la cible doit réussir un jet de sauvegarde de Sagesse ou suivre l'ordre à son
 * prochain tour ». Les ordres du PHB 2024 et ce que chacun impose au tour de la cible :
 *
 *   approach  Approche : elle se déplace vers vous par le plus court chemin ; son tour s'achève si elle arrive à 1,50 m
 *   drop      Lâche : elle lâche ce qu'elle tient, et son tour s'achève
 *   flee      Fuis : elle consacre son tour à s'éloigner de vous par le moyen le plus rapide
 *   grovel    Rampe : elle tombe À terre, et son tour s'achève
 *   halt      Halte : elle ne se déplace pas et n'entreprend ni action ni action Bonus
 *
 * Un tour « achevé » : plus d'action, d'action Bonus ni de déplacement ; la Réaction reste (hors de son tour).
 */

export const ORDERS = Object.freeze(["approach", "drop", "flee", "grovel", "halt"]);

/**
 * @param {string} order
 * @returns {{move: "toward"|"away"|null, prone: boolean, drop: boolean, ends: "always"|"ifArrived"|"never"}|null}
 */
export function orderPlan(order) {
  switch ( order ) {
    case "approach": return { move: "toward", prone: false, drop: false, ends: "ifArrived" };
    case "drop": return { move: null, prone: false, drop: true, ends: "always" };
    case "flee": return { move: "away", prone: false, drop: false, ends: "always" };
    case "grovel": return { move: null, prone: true, drop: false, ends: "always" };
    case "halt": return { move: null, prone: false, drop: false, ends: "always" };
    default: return null;
  }
}

/**
 * Écart en cases entre deux emprises `{ i, j, w, h }` (diagonale = 1 case) ; 0 au contact, -1 si elles se chevauchent.
 * `i` est la ligne et `j` la colonne (`grid.getOffset`) : `i` va avec la hauteur `h`, `j` avec la largeur `w`.
 */
export function footprintDistance(a, b) {
  const di = Math.max(b.i - (a.i + a.h), a.i - (b.i + b.h));
  const dj = Math.max(b.j - (a.j + a.w), a.j - (b.j + b.w));
  if ( (di < 0) && (dj < 0) ) return -1;
  return Math.max(di, dj, 0);
}

/**
 * Les cases (coin haut-gauche) où poser une emprise `size` ({ w, h }) à `gap` cases de `anchor` ({ i, j, w, h }), dans
 * `bounds` ({ i0, j0, i1, j1 }, bornes incluses). `gap` 0 : au contact (Approche) ; plus : aussi loin (Fuis).
 */
export function cellsAtGap(anchor, size, gap, bounds) {
  const out = [];
  for ( let i = anchor.i - size.h - gap; i <= anchor.i + anchor.h + gap; i++ ) {
    for ( let j = anchor.j - size.w - gap; j <= anchor.j + anchor.w + gap; j++ ) {
      if ( (i < bounds.i0) || (j < bounds.j0) || ((i + size.h - 1) > bounds.i1) || ((j + size.w - 1) > bounds.j1) ) continue;
      if ( footprintDistance({ i, j, ...size }, anchor) === gap ) out.push({ i, j });
    }
  }
  return out;
}

/**
 * §403 : Compulsion — « une direction horizontale » désignée par le lanceur ; les huit de la grille (`n` = vers le haut de la scène).
 * `{ di, dj }` : pas en lignes (i, vers le bas) et en colonnes (j, vers la droite) — les décalages de grille du cœur.
 */
export const DIRECTIONS = Object.freeze({
  n: { di: -1, dj: 0 }, ne: { di: -1, dj: 1 }, e: { di: 0, dj: 1 }, se: { di: 1, dj: 1 },
  s: { di: 1, dj: 0 }, sw: { di: 1, dj: -1 }, w: { di: 0, dj: -1 }, nw: { di: -1, dj: -1 }
});

/**
 * §403 : la case visée par « autant de déplacement que possible dans cette direction » — `cells` pas depuis `cell`, bornée à la
 * scène (`bounds` : { rows, columns } ; i de 0 à rows-1, j de 0 à columns-1). Null si la direction est inconnue ou sans pas.
 * @param {{i: number, j: number}} cell
 * @param {string} dir
 * @param {number} cells
 * @param {{rows: number, columns: number}} [bounds]
 */
export function directionTarget(cell, dir, cells, bounds=null) {
  const d = DIRECTIONS[dir];
  if ( !d || !(cells > 0) ) return null;
  let steps = Math.floor(cells);
  if ( bounds ) {
    const room = (v, dv, size) => (dv > 0) ? (size - 1 - v) : (dv < 0) ? v : Infinity;
    steps = Math.min(steps, room(cell.i, d.di, bounds.rows), room(cell.j, d.dj, bounds.columns));
  }
  if ( !(steps > 0) ) return null;
  return { i: cell.i + (d.di * steps), j: cell.j + (d.dj * steps) };
}
