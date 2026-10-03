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

/** Écart en cases entre deux emprises `{ i, j, w, h }` (diagonale = 1 case) ; 0 au contact, -1 si elles se chevauchent. */
export function footprintDistance(a, b) {
  const dx = Math.max(b.i - (a.i + a.w), a.i - (b.i + b.w));
  const dy = Math.max(b.j - (a.j + a.h), a.j - (b.j + b.h));
  if ( (dx < 0) && (dy < 0) ) return -1;
  return Math.max(dx, dy, 0);
}

/**
 * Les cases (coin haut-gauche) où poser une emprise `size` ({ w, h }) à `gap` cases de `anchor` ({ i, j, w, h }), dans
 * `bounds` ({ i0, j0, i1, j1 }, bornes incluses). `gap` 0 : au contact (Approche) ; plus : aussi loin (Fuis).
 */
export function cellsAtGap(anchor, size, gap, bounds) {
  const out = [];
  for ( let i = anchor.i - size.w - gap; i <= anchor.i + anchor.w + gap; i++ ) {
    for ( let j = anchor.j - size.h - gap; j <= anchor.j + anchor.h + gap; j++ ) {
      if ( (i < bounds.i0) || (j < bounds.j0) || ((i + size.w - 1) > bounds.i1) || ((j + size.h - 1) > bounds.j1) ) continue;
      if ( footprintDistance({ i, j, ...size }, anchor) === gap ) out.push({ i, j });
    }
  }
  return out;
}
