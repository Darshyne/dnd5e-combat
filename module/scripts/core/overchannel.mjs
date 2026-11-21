/**
 * Surcharge (Magicien, Évocateur 14 — SRD 5.2) : « quand vous lancez un sort de magicien avec un emplacement de niveau 1 à 5 qui
 * inflige des dégâts, vous pouvez infliger les dégâts maximaux avec ce sort au tour où vous le lancez. La première fois, sans
 * contrecoup. Si vous l'utilisez de nouveau avant un Repos long, vous subissez 2d12 dégâts nécrotiques par niveau de
 * l'emplacement juste après l'avoir lancé ; ces dégâts ignorent la Résistance et l'Immunité. À chaque nouvelle utilisation avant un
 * Repos long, les dégâts nécrotiques par niveau augmentent de 1d12. » Fonctions pures.
 */

/**
 * Ce lancement peut-il être surchargé ?
 * @param {{maxLevel: number, class?: string}} rule
 * @param {{isSpell: boolean, baseLevel: number, castLevel: number, sourceClass?: string|null}} cast  `sourceClass` vide :
 *   inconnu, admis
 */
export function overchannelApplies(rule, { isSpell, baseLevel, castLevel, sourceClass=null }) {
  if ( !rule || !isSpell || !(baseLevel >= 1) || !(castLevel >= 1) || (castLevel > rule.maxLevel) ) return false;
  return !rule.class || !sourceClass || (sourceClass === rule.class);
}

/**
 * Les dés de dégâts à leur maximum : ce qui change à l'agrégat, part par part (type et propriétés).
 * @param {Array<{type: string|null, properties: string[], value: number, faces: number}>} dice
 * @returns {Array<{type: string|null, properties: string[], old: number, now: number}>}  rien pour une part déjà au maximum
 */
export function maximizedDeltas(dice) {
  const parts = new Map();
  for ( const die of dice ?? [] ) {
    const key = `${die.type ?? ""}|${[...(die.properties ?? [])].sort().join(",")}`;
    const part = parts.get(key) ?? { type: die.type ?? null, properties: [...(die.properties ?? [])], old: 0, now: 0 };
    part.old += Number(die.value) || 0;
    part.now += Number(die.faces) || 0;
    parts.set(key, part);
  }
  return [...parts.values()].filter(p => p.now !== p.old);
}

/**
 * Le nombre de d12 du contrecoup : rien à la première utilisation depuis le Repos long, puis (rang de l'utilisation) par niveau
 * d'emplacement — 2 par niveau à la deuxième, 3 à la troisième…
 * @param {number} use        le rang de cette utilisation depuis le dernier Repos long (1 = la première)
 * @param {number} castLevel
 */
export function backlashDice(use, castLevel) {
  return (use >= 2) ? use * castLevel : 0;
}
