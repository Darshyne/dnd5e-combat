/**
 * §220 : l'état « Théâtre de l'esprit » — toutes les automatisations du moteur coupées (runtime/theater.mjs). Dans un fichier à part,
 * sans import : le routeur le lit à chaque hook (runtime/router.mjs), et le routeur est importé par presque tout le moteur.
 */

let active = false;

/** Le Théâtre de l'esprit est-il actif (les automatisations coupées) ? */
export const theaterActive = () => active;

/** Tenu par runtime/theater.mjs, d'après le réglage de monde. */
export function setTheaterState(on) {
  active = !!on;
}
