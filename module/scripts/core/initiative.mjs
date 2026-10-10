/**
 * §120 : relancer un d20 d'initiative trop bas (clé `rerollInitiative`, Survivant — Hypervigilance : « quand vous lancez
 * l'initiative, vous pouvez relancer le d20 s'il fait 9 ou moins ; vous gardez le nouveau jet »). Fonctions pures, sans Foundry.
 */

/**
 * Faut-il relancer, et quoi ? Le d20 du jet (avec Avantage ou Désavantage, celui qui est gardé) de `atMost` ou moins : on relance le
 * d20 du jet entier (mêmes dés, même garde), et l'initiative change de la différence.
 * @param {{atMost: number}} rule
 * @param {{number: number, kept: number, keep?: string|null}} d20   `kept` : la valeur gardée ; `keep` : "kh" / "kl" ou rien.
 * @returns {string|null}  La formule à relancer, ou null.
 */
export function initiativeReroll(rule, d20) {
  if ( !rule || !d20 || !Number.isFinite(d20.kept) || (d20.kept > rule.atMost) ) return null;
  const n = Math.max(1, d20.number || 1);
  return `${n}d20${(n > 1) && d20.keep ? d20.keep : ""}`;
}

/** La nouvelle initiative : l'ancienne, moins l'ancien d20, plus le nouveau (bonus, départage et dés ajoutés gardés). */
export const rerolledInitiative = (initiative, oldD20, newD20) => initiative - oldD20 + newD20;
