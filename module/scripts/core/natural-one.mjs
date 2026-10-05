/**
 * §93 : un Test d20 dont le d20 GARDÉ fait 1 (avec Avantage ou Désavantage, le dé retenu). Pur : des jets décrits par leur premier
 * terme (`d20.total`, celui de dnd5e : D20Roll#d20, le total des résultats actifs).
 * @param {Array<{d20?: {total?: number}}>} rolls
 * @returns {boolean}
 */
export function rolledNaturalOne(rolls) {
  return (rolls ?? []).some(r => Number(r?.d20?.total) === 1);
}
