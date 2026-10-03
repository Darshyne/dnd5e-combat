/**
 * Robustesse de la non-vie (Monster Manual 2024, §61) : quand des dégâts font tomber la créature à 0 PV, elle fait une
 * sauvegarde de Constitution de DD 5 + les dégâts subis, sauf si ces dégâts sont radiants ou viennent d'un coup critique ;
 * réussie, elle reste à 1 PV. Fonctions pures, aucune dépendance à Foundry.
 */

/** Ce que la règle n'admet pas : des dégâts de ce type. */
export const FORTITUDE_BREAKERS = Object.freeze(["radiant"]);

/** Le DD de base, auquel s'ajoutent les dégâts subis. */
export const FORTITUDE_BASE_DC = 5;

/**
 * La sauvegarde que demandent ces dégâts, ou null.
 * @param {object} hit
 * @param {number} hit.hp         PV avant les dégâts (hors PV temporaires).
 * @param {number} hit.through    Dégâts qui passent les PV temporaires (après résistances).
 * @param {number} hit.taken      Dégâts subis (après résistances, PV temporaires compris) : ils font le DD.
 * @param {string[]} [hit.types]  Types des dégâts subis.
 * @param {boolean} [hit.critical]
 * @returns {{ability: "con", dc: number}|null}
 */
export function fortitudeSave({ hp, through, taken, types=[], critical=false }) {
  if ( !(hp > 0) || !(through >= hp) || !(taken > 0) ) return null;   // ne tombe pas à 0 PV (ou y était déjà)
  if ( critical || types.some(t => FORTITUDE_BREAKERS.includes(t)) ) return null;
  return { ability: "con", dc: FORTITUDE_BASE_DC + Math.floor(taken) };
}
