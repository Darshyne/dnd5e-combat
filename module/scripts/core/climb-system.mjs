/**
 * §224 : l'état du système d'escalade et de chute — allumé, le moteur aligne chaque déplacement sur le sol, fait grimper et tomber ;
 * coupé (bouton du MJ, réglage de monde `climbSystem`), on se déplace librement en hauteur et chacun garde son élévation
 * (runtime/climb-system.mjs). Dans un fichier sans import, au cœur : l'A* (adapter/path-world.mjs), l'altitude, l'escalade et les
 * chutes le lisent.
 *
 * Pur : aucune dépendance à Foundry.
 */

let on = true;

/** Le système d'escalade et de chute est-il allumé ? */
export const climbSystemOn = () => on;

/** Tenu par runtime/climb-system.mjs, d'après le réglage de monde. */
export function setClimbSystemState(value) {
  on = value !== false;
}

/** Ce que le système propose (entrées de menu, rebords) : `make()` allumé, rien (sans le calculer) quand il est coupé. */
export const whileClimbSystem = (make, active=on) => (active ? make() : []);
