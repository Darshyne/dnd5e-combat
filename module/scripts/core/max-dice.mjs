/**
 * §233 : « ne lancez pas ces dés de soin ; retenez à la place la valeur maximale de chaque dé » (Retour à la vie du Domaine de la
 * Tombe, Guérison suprême, Lueur d'espoir). Les termes de dés d'une formule deviennent leur maximum, avant le jet : la carte montre la
 * valeur rendue. Pur.
 */

/**
 * Chaque terme de dés `NdF`, `dF` ou `(expression)dF` (avec ses modificateurs : `kh`, `r1`…) devient `(N*F)` ; le reste de la formule
 * (bonus, `@abilities.wis.mod`) ne bouge pas. Un mot qui contient « d » suivi d'un chiffre (`dnd5e`) n'est pas un dé.
 * @param {string} formula
 * @returns {string}
 */
export function maximizeDice(formula) {
  return String(formula ?? "").replace(/(?<![\w@.])(\d+|\([^()]*\))?d(\d+)(?:[a-z]+[<>=]*\d*)*/gi,
    (_, count, faces) => `(${count ?? 1}*${faces})`);
}
