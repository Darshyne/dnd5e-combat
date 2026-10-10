/**
 * §129 : les dons d'origine du Manuel des joueurs — ce qui se calcule sans Foundry.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** Un terme de dés d'une formule, avec ses modificateurs (« 1d12 », « 2d6min3 », « 1d4r1 »). */
const DICE = /(\d*d\d+(?:[a-z]+\d*)*)/g;

/**
 * Sauvagerie martiale : « lancez les dés de dégâts de l'arme deux fois et utilisez l'un ou l'autre jet ». Chaque terme de dés de la
 * part devient une réserve des deux jets dont on garde le meilleur (« {1d12,1d12}kh ») ; le reste de la part (modificateur) ne bouge pas.
 * @param {string} part
 * @returns {string}
 */
export function twiceKeepHighest(part) {
  return String(part).replace(DICE, term => `{${term},${term}}kh`);
}

/**
 * Guérisseur : « vous pouvez relancer le dé s'il fait 1, et vous devez utiliser le nouveau résultat » — une fois (« r1 » : Foundry relance une fois, « rr » relancerait sans fin). Un terme
 * qui relance déjà n'est pas touché.
 * @param {string} part
 * @returns {string}
 */
export function rerollOnesOnce(part) {
  return String(part).replace(DICE, term => (/r/.test(term.replace(/^\d*d\d+/, "")) ? term : `${term}r1`));
}

/**
 * Vigilant : les alliés avec qui échanger l'initiative — même camp, une initiative déjà lancée, ni Neutralisés ni à 0 PV, autres que soi.
 * @param {{id: string, disposition: number, initiative: number|null, incapacitated?: boolean, down?: boolean}} self
 * @param {Array<typeof self>} others
 * @returns {string[]}  Les ids, dans l'ordre reçu.
 */
export function swapPartners(self, others) {
  if ( self.incapacitated || self.down || !Number.isFinite(self.initiative) ) return [];
  return others.filter(o => (o.id !== self.id) && (o.disposition === self.disposition) && Number.isFinite(o.initiative)
    && !o.incapacitated && !o.down).map(o => o.id);
}
