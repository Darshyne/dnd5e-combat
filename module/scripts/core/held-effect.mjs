/**
 * Paume vibratoire (Moine, Main ouverte 17 — SRD 5.2) : « quand vous touchez une créature avec une attaque à mains nues, vous
 * pouvez dépenser 4 points de crédo pour déclencher des vibrations […] Vous ne pouvez avoir qu'une seule créature sous l'effet de
 * cette aptitude à la fois. […] Quand vous y mettez fin, la cible doit faire un jet de sauvegarde de Constitution ». Fonctions
 * pures, sur la règle `heldEffect` : un effet de l'item qu'une seule créature porte, et que l'une de ses activités fait cesser.
 */

/**
 * Les effets à retirer quand celui-ci vient d'être posé : les autres effets du même item, sur d'autres créatures.
 * @param {{single?: true}} rule
 * @param {{id: string, bearer: string}} placed                          l'effet posé, son porteur
 * @param {Array<{id: string, bearer: string}>} others                   tous les effets de cet effet d'item dans la scène
 * @returns {Array<{id: string, bearer: string}>}
 */
export function supersededEffects(rule, placed, others) {
  if ( rule?.single !== true ) return [];
  return (others ?? []).filter(e => (e.id !== placed.id) && (e.bearer !== placed.bearer));
}

/** Cette activité met-elle fin à l'effet tenu ? */
export function endsHeldEffect(rule, activityId) {
  return !!rule && !!activityId && (rule.endedBy === activityId);
}

/** Une faveur de coup peut-elle se payer ? Il faut `cost` utilisations (une par défaut). */
export function riderAffordable(left, cost=1) {
  return left >= Math.max(1, Number(cost) || 1);
}
