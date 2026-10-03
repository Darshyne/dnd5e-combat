/**
 * Niveau de lumière (SPEC §16.48, §16.52) : le réglage du monde que lit adapter/illumination.mjs.
 *  - `twilightDarkness` : crépuscule — au-delà de ce seuil d'obscurité, une lumière globale **vive** compte comme **faible**
 *    (aube et crépuscule en Lumière faible). 1 : jamais. Avec Simple Timekeeping (qui ne fait varier que l'obscurité, 0 à midi,
 *    0,25 à l'aube, 0,75 au coucher, interpolation linéaire — simple-timekeeping 2.0.3, SimpleTimekeeping.js:1131-1151),
 *    0,6 donne, avec l'aube et le coucher par défaut (0,23 et 0,77 de la journée), environ 1 h 20 de lumière faible avant le
 *    coucher (17 h 11 → 18 h 29) et une demi-heure avant l'aube (4 h 58 → 5 h 31) ; au-delà de la plage de la lumière
 *    globale (0,75 par défaut), ce sont les ténèbres.
 * L'image de Foundry, elle, reste vive : seul le jugement du moteur (Chercher, Perception passive, indicateur) change.
 */

import { MODULE_ID } from "../constants.mjs";

export function registerIllumination() {
  game.settings.register(MODULE_ID, "twilightDarkness", {
    name: "DND5ECOMBAT.Reglage.twilightDarkness.Nom", hint: "DND5ECOMBAT.Reglage.twilightDarkness.Aide",
    scope: "world", config: true, type: Number, default: 0.6, range: { min: 0, max: 1, step: 0.05 }
  });
}
