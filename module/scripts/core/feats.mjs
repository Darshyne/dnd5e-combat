/**
 * §129 : les dons d'origine du Manuel des joueurs — ce qui se calcule sans Foundry.
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** Le premier terme de dés d'une part : nombre, faces, modificateurs. */
const FIRST_DIE = /(\d*)d(\d+)((?:[a-z]+\d*)*)/;

/**
 * §132 : Perforeur — « relancez l'un des dés de dégâts de l'attaque, vous devez garder le nouveau résultat ». Le moteur ne relance pas
 * après coup : le premier terme de dés de la part lance un dé de plus et garde les meilleurs (« 1d8 » → « 2d8kh1 », « 2d6 » →
 * « 3d6kh2 ») — c'est relancer le plus bas en gardant le meilleur des deux, un peu plus favorable que la lettre. Une part déjà en
 * réserve (Sauvagerie martiale) ou qui garde déjà n'est pas touchée.
 * @param {string} part
 * @returns {string}
 */
export function oneMoreKeepBest(part) {
  const s = String(part);
  if ( s.includes("{") ) return s;
  return s.replace(FIRST_DIE, (term, n, faces, mods) => (/k/.test(mods) ? term : `${(Number(n) || 1) + 1}d${faces}${mods}kh${Number(n) || 1}`));
}

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

/**
 * §130 : la condition d'un effet de don (`effectWhile`) tient-elle ? Ce que le Manuel ne dit pas dans ses données :
 *  - `armor` : l'armure portée est de l'un de ces types (Défense : « tant que vous portez une armure légère, intermédiaire ou lourde ») ;
 *  - `oneHanded` : une seule arme maniée, de corps à corps et sans la propriété Deux mains (Duel : « une arme de corps à corps dans une
 *    main et aucune autre arme » — un bouclier n'est pas une arme) ;
 *  - `inCombat` : la créature se bat (Rôdeur furtif, Brouillard de guerre : « l'action Se cacher pendant un combat ») ;
 *  - `abilityAtLeast` : valeurs de caractéristique minimales (Maître des armures intermédiaires : Dextérité 16).
 * @param {{armor?: string[], oneHanded?: true, inCombat?: true, abilityAtLeast?: Record<string, number>}} rule
 * @param {{armor: string|null, weapons: Array<{melee: boolean, twoHanded: boolean}>, inCombat: boolean, abilities: Record<string, number>}} facts
 * @returns {boolean}
 */
export function effectHolds(rule, facts) {
  if ( rule.armor && !rule.armor.includes(facts.armor) ) return false;
  if ( rule.oneHanded ) {
    const w = facts.weapons ?? [];
    if ( (w.length !== 1) || !w[0].melee || w[0].twoHanded ) return false;
  }
  if ( rule.inCombat && !facts.inCombat ) return false;
  for ( const [ability, min] of Object.entries(rule.abilityAtLeast ?? {}) ) {
    if ( !((facts.abilities?.[ability] ?? 0) >= min) ) return false;
  }
  return true;
}

/** Les changements d'un effet sont-ils déjà ceux que la règle demande (clé, type, valeur — dans l'ordre) ? */
export function sameChanges(current=[], wanted=[]) {
  const norm = list => list.map(c => `${c.key}|${c.type ?? ""}|${String(c.value)}`);
  return JSON.stringify(norm(current)) === JSON.stringify(norm(wanted));
}

/** §131 : les arbalètes du Manuel des joueurs (identifiants d'arme de base de dnd5e). */
export const CROSSBOWS = Object.freeze(["handcrossbow", "heavycrossbow", "lightcrossbow"]);

/**
 * §131 : ce que les dons de tir accordent à CETTE attaque (Tireur d'élite, Expert des arbalètes, Sniper de sorts). Chaque règle
 * `rangedFeat` vaut pour un genre d'attaque (`kind`) : « weapon » (attaque à distance avec une arme, lancée comprise), « crossbow »
 * (une arbalète), « spell » (jet d'attaque d'un sort).
 * @param {object[]} rules  Les règles `rangedFeat` des items du porteur.
 * @param {{weapon: boolean, ranged: boolean, crossbow: boolean, spell: boolean}} attack
 * @returns {{cover: boolean, closeCombat: boolean, longRange: boolean, offhandModifier: boolean, spellRange: object|null}}
 */
export function rangedFeatsFor(rules, attack) {
  const out = { cover: false, closeCombat: false, longRange: false, offhandModifier: false, spellRange: null };
  for ( const r of rules ?? [] ) {
    const fits = (r.kind === "weapon") ? (attack.weapon && attack.ranged)
      : (r.kind === "crossbow") ? (attack.weapon && attack.crossbow)
      : (r.kind === "spell") ? attack.spell : false;
    if ( !fits ) continue;
    for ( const k of ["cover", "closeCombat", "longRange", "offhandModifier"] ) if ( r[k] === true ) out[k] = true;
    if ( r.spellRange ) out.spellRange = r.spellRange;
  }
  return out;
}

/** §131 : l'abri que la règle laisse : un abri partiel ou aux trois quarts ignoré ; l'abri total reste. */
export function coverLeft(cover, ignores) {
  if ( !cover || !ignores ) return cover;
  return (cover.degree === "total") ? cover : null;
}
