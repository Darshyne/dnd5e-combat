/**
 * Des dégâts qui dépendent du nombre choisi à une autre activité de l'item (clé de contenu `damageByCount`) : Anneau des étoiles
 * filantes, Sphères de foudre — « la créature subit des dégâts de foudre selon le nombre de sphères que vous avez créées » (1 : 4d12,
 * 2 : 5d4, 3 : 2d6, 4 : 2d4). Le nombre est noté sur l'item à la création, la formule lue au jet de dégâts. Fonctions pures.
 */

/** Le nombre que dit une utilisation : 1, plus la montée choisie (une activité dont la consommation se monte « par sphère »). */
export function countOfUse(scaling) {
  const increase = Number(scaling);
  return 1 + (Number.isInteger(increase) && (increase > 0) ? increase : 0);
}

/** La formule pour ce nombre, ou null (rien de noté, ou hors table) : la donnée reste alors telle quelle. */
export function formulaForCount(rule, count) {
  const n = Number(count);
  return (rule && Number.isInteger(n) && (n >= 1)) ? (rule.formulas?.[n - 1] ?? null) : null;
}

/** Les erreurs de la clé. Vide = valide. */
export function validateDamageByCount(rules, at, isId) {
  const ok = rules && (typeof rules === "object") && !Array.isArray(rules) && Object.keys(rules).length
    && Object.entries(rules).every(([id, r]) => isId(id) && r && (typeof r === "object") && isId(r.from) && Array.isArray(r.formulas)
      && r.formulas.length && r.formulas.every(f => (typeof f === "string") && f.trim()) && Object.keys(r).every(k => ["from", "formulas"].includes(k)));
  return ok ? [] : [`${at}damageByCount: { <activity id>: { from: activity id, formulas: [formula, …] } }`];
}
