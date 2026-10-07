/**
 * §105 : partager la case d'une autre créature (Forme d'air, de feu, d'eau ; Nuées ; Forme gazeuse ; Forme brumeuse). Pur.
 *
 * « can enter a creature's space and stop there » : celui qui bouge (`enter`) traverse toute créature, hostile comprise, et
 * peut finir dans sa case. « can occupy another creature's space and vice versa » (`mutual`) : aussi l'inverse — toute créature
 * peut entrer dans la sienne. Le reste ne change pas : la case occupée reste un terrain difficile, l'attaque d'opportunité
 * reste due.
 */

export const SHARE_KINDS = Object.freeze(["enter", "mutual"]);

/** La plus large de deux façons de partager (null < enter < mutual). */
export function widerShare(a, b) {
  return SHARE_KINDS.indexOf(b) > SHARE_KINDS.indexOf(a) ? b : (a ?? null);
}

/**
 * Celui qui bouge peut-il traverser la case de l'occupant et s'y arrêter ?
 * @param {"enter"|"mutual"|null} mover
 * @param {"enter"|"mutual"|null} occupant
 */
export function mayShareSpace(mover, occupant) {
  return !!mover || (occupant === "mutual");
}
