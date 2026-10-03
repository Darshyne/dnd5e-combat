/**
 * Défenses de sorts (SPEC §16.46), sans Foundry.
 *  - Résistance (`damageShield`) : « quand la créature subit des dégâts du type retenu, elle réduit les dégâts subis de 1d4 ;
 *    une même créature ne peut bénéficier qu'une fois par tour de ce sort ».
 *  - Vigueur arcanique (`hitDiceHeal`) : un ou deux dés de vie dépensés pour se soigner, un dé de plus par niveau
 *    d'emplacement au-delà du 2e.
 * Fonctions pures.
 */

/**
 * Retire `amount` aux dégâts du type `type` (répartis sur leurs entrées, dans l'ordre), sans passer sous zéro.
 * @param {Array<{value: number, type: string}>} damages
 * @returns {{damages: Array<object>, reduced: number}}
 */
export function reduceDamageOfType(damages, type, amount) {
  let left = Math.max(0, Number(amount) || 0);
  let reduced = 0;
  const out = (damages ?? []).map(d => {
    if ( (d.type !== type) || (left <= 0) || !(d.value > 0) ) return d;
    const take = Math.min(left, d.value);
    left -= take;
    reduced += take;
    return { ...d, value: d.value - take };
  });
  return { damages: out, reduced };
}

/** Combien de dés de vie la Vigueur arcanique lance à ce niveau d'emplacement (au plus ceux qui restent). */
export function hitDiceAllowed({ base, spellLevel, slotLevel, available }) {
  const allowed = base + Math.max(0, (Number(slotLevel) || spellLevel) - spellLevel);
  return Math.max(0, Math.min(allowed, Number(available) || 0));
}
