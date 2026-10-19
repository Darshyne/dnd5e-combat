/**
 * §208 : le saut des règles 2024 (glossaire du Manuel des joueurs, « Long Jump » et « High Jump » ; relevé `prive/RELEVE_REGLES.md`).
 *  - Saut en longueur : jusqu'à la valeur de Force en pieds avec élan (au moins 3 m à pied juste avant), la moitié sans élan.
 *  - Saut en hauteur : 3 + modificateur de Force pieds (0 au moins) avec élan, la moitié sans.
 *  - Chaque pied de saut coûte un pied de déplacement.
 *  - Atterrir en terrain difficile : test de Dextérité (Acrobaties) DD 10, sinon À terre.
 * Ce qui le change, par le contenu (`jump`) : Athlète (élan de 1,50 m), Monte-en-l'air (la Dextérité au lieu de la Force), Pas du vent
 * (distance doublée pour le tour), sort *Saut* et Bottes de saut et de célérité (une fois par tour, jusqu'à 9 m pour 3 m de déplacement).
 * Toutes les longueurs sont en pieds ; la conversion vers la grille est faite par l'appelant.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** L'élan demandé par les règles, en pieds. */
export const RUN_UP = 10;
/** Le DD du test d'atterrissage en terrain difficile. */
export const LANDING_DC = 10;

const modOf = score => Math.floor(((Number(score) || 10) - 10) / 2);

/**
 * Les distances de saut, en pieds (arrondies à l'inférieur).
 * @param {object} data
 * @param {number} data.str            Valeur de Force.
 * @param {number} [data.dex]          Valeur de Dextérité.
 * @param {boolean} [data.useDex]      La Dextérité peut remplacer la Force (Monte-en-l'air) : la meilleure des deux.
 * @param {boolean} data.runningStart  Élan pris.
 * @param {boolean} [data.double]      Distance doublée (Pas du vent).
 * @returns {{long: number, high: number, score: number}}
 */
export function jumpLimits({ str, dex=10, useDex=false, runningStart, double=false }) {
  const score = useDex ? Math.max(Number(str) || 10, Number(dex) || 10) : (Number(str) || 10);
  const factor = double ? 2 : 1;
  const long = Math.floor((runningStart ? score : score / 2) * factor);
  const high0 = Math.max(0, 3 + modOf(score));
  const high = Math.floor((runningStart ? high0 : high0 / 2) * factor);
  return { long, high, score };
}

/**
 * Ce que coûte un saut de `distance` pieds et s'il est permis. Un saut « fixe » (sort *Saut*, Bottes) : une fois par tour, jusqu'à
 * `fixed.distance` pour `fixed.cost` — pris s'il permet le saut ou le rend moins cher.
 * @param {number} distance        La longueur (ou la hauteur) du saut, en pieds.
 * @param {number} limit           La limite ordinaire (`jumpLimits`), en pieds.
 * @param {{distance: number, cost: number}|null} [fixed]  Le saut fixe disponible ce tour, ou null.
 * @returns {{ok: boolean, cost: number, fixed: boolean, limit: number}}  `cost` en pieds ; `limit` : la plus grande distance permise.
 */
export function jumpCost(distance, limit, fixed=null) {
  const d = Math.max(0, Number(distance) || 0);
  const viaFixed = !!fixed && (d <= fixed.distance) && ((d > limit) || (fixed.cost < d));
  if ( viaFixed ) return { ok: true, cost: fixed.cost, fixed: true, limit: Math.max(limit, fixed.distance) };
  return { ok: d <= limit + 1e-6, cost: d, fixed: false, limit: Math.max(limit, fixed?.distance ?? 0) };
}

/**
 * L'élan : la dernière marche du token, juste avant le saut, fait-elle au moins `needed` pieds ? `steps` : les longueurs des derniers
 * pas, du plus ancien au plus récent, et le mode de chacun ; la marche compte depuis la fin, tant que le token marchait.
 * @param {{distance: number, action: string|null}[]} steps
 * @param {number} needed
 */
export function hasRunningStart(steps, needed=RUN_UP) {
  let run = 0;
  for ( let i = steps.length - 1; i >= 0; i-- ) {
    const s = steps[i];
    if ( !["walk", null, undefined].includes(s.action) ) break;
    run += Math.max(0, Number(s.distance) || 0);
    if ( run + 1e-6 >= needed ) return true;
  }
  return false;
}
