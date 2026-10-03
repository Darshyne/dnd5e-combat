/**
 * §66 : contresort à la manière de 2014 (SRD 5.1, « Counterspell ») — la réaction ne demande pas de sauvegarde au lanceur : un sort
 * du niveau du contresort ou moins échoue sans jet ; au-delà, celui qui contre fait un test de sa caractéristique d'incantation
 * contre un DD de 10 + le niveau du sort ; réussi, le sort échoue. Déclaré sur l'item qui contre (`counter: { level? }`,
 * core/content.mjs), joué par la porte `castsSpell` (runtime/gates.mjs). Le Contresort de 2024 (sauvegarde de Constitution du
 * lanceur) ne change pas.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

const level = value => (Number.isFinite(Number(value)) && (value !== null) && (value !== "")) ? Math.max(0, Math.trunc(Number(value))) : null;

/**
 * Le niveau auquel un sort est lancé, tel qu'on le connaît avant son lancement : le plus haut de son niveau, de son niveau mis à
 * l'échelle (`scaling`), de l'emplacement choisi (`slotLevel`) et du niveau que lui donne la capacité qui le lance
 * (`linkedLevel` : un sort lancé par une activité « cast », « Boule de feu (niveau 4) » d'un monstre).
 * @param {{level?: number, scaling?: number, slotLevel?: number|null, linkedLevel?: number|null}} data
 * @returns {number}
 */
export function castLevelOf({ level: base=0, scaling=0, slotLevel=null, linkedLevel=null }={}) {
  const own = level(base) ?? 0;
  const candidates = [own, own + (level(scaling) ?? 0), level(slotLevel), level(linkedLevel)].filter(v => v !== null);
  return Math.max(...candidates);
}

/**
 * Ce qui arrive au sort contré : `auto` (il échoue sans jet) ou un test contre `dc`.
 * @param {number} castLevel     Niveau de lancement du sort contré.
 * @param {number} counterLevel  Niveau du contresort.
 * @returns {{castLevel: number, level: number, auto: boolean, dc: number|null}}
 */
export function counterPlan(castLevel, counterLevel) {
  const cast = level(castLevel) ?? 0;
  const lvl = level(counterLevel) ?? 0;
  return (cast <= lvl) ? { castLevel: cast, level: lvl, auto: true, dc: null } : { castLevel: cast, level: lvl, auto: false, dc: 10 + cast };
}

/**
 * Le sort est-il dissipé ? D'office si le plan le dit ; sinon si le test a eu lieu et atteint le DD.
 * @param {{auto: boolean, dc: number|null}} plan
 * @param {number|null} total  Total du test de caractéristique (null : pas de test).
 */
export function counterSucceeds(plan, total) {
  if ( plan?.auto ) return true;
  return Number.isFinite(total) && Number.isFinite(plan?.dc) && (total >= plan.dc);
}
