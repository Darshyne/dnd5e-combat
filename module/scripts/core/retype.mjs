/**
 * Les types de dégâts qu'un sort peut prendre à la place du sien (clé `spellDamageTypes`) — Sorts psychiques : tout sort d'Occultiste
 * peut devenir psychique, sans rien payer ; Sort transmuté (SRD 5.2) : « quand vous lancez un sort qui inflige un type de dégâts de
 * la liste — acide, froid, feu, foudre, poison, tonnerre —, vous pouvez dépenser 1 point de sorcellerie pour changer ce type en l'un
 * des autres de la liste ». Fonctions pures.
 */

/**
 * Ce que les règles offrent à ce sort.
 * @param {Array<{types: string[], from?: string[], cost?: string|null, payable?: boolean}>} rules  celles qui valent pour ce sort
 *   (classe déjà jugée) ; `from` : le sort doit infliger l'un de ces types ; `cost` : l'activité qui paie le changement, `payable` :
 *   s'il lui reste de quoi
 * @param {string[]} own   les types que le sort inflige déjà
 * @returns {Array<{type: string, cost: string|null}>}  un type au plus une fois, le sien jamais ; gratuit de préférence
 */
export function retypeOffers(rules, own) {
  const mine = new Set(own ?? []);
  const out = new Map();
  for ( const rule of rules ?? [] ) {
    if ( rule.from && !rule.from.some(t => mine.has(t)) ) continue;
    if ( rule.cost && (rule.payable === false) ) continue;
    for ( const type of rule.types ?? [] ) {
      if ( mine.has(type) ) continue;
      const cost = rule.cost ?? null;
      if ( !out.has(type) || ((out.get(type) !== null) && (cost === null)) ) out.set(type, cost);
    }
  }
  return Array.from(out, ([type, cost]) => ({ type, cost }));
}
