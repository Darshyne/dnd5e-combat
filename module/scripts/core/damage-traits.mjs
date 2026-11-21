/**
 * Un trait qui répond à un type de dégâts subi (clé de contenu `onDamageTaken`) : « s'il subit des dégâts de froid, sa Vitesse diminue de
 * 6 m jusqu'à la fin de son prochain tour » (Élémentaire de l'eau, Gel), « s'il subit des dégâts de feu, il a le Désavantage aux jets
 * d'attaque et aux tests de caractéristique jusqu'à la fin de son prochain tour » (Golem de chair, Aversion au feu). Ce n'est pas une
 * Réaction : rien n'est demandé, rien n'est dépensé — l'effet du trait est posé sur son porteur. Fonctions pures.
 */

/**
 * La règle vaut-elle pour ces dégâts ?
 * @param {{types: string[], effect: string}|null|undefined} rule  `onDamageTaken` de l'entrée.
 * @param {string[]} taken  Les types des dégâts réellement subis (valeur > 0, après résistances et immunités).
 */
export function damageTraitHits(rule, taken) {
  if ( !rule?.effect || !Array.isArray(rule.types) || !rule.types.length ) return false;
  return (taken ?? []).some(t => rule.types.includes(t));
}

/** Les erreurs de la clé. Vide = valide. */
export function validateOnDamageTaken(rule, at, damageTypes, isId) {
  const errors = [];
  const shape = `${at}onDamageTaken: { types: [damage types], effect: effect id }`;
  if ( !rule || (typeof rule !== "object") || Array.isArray(rule) ) return [shape];
  if ( !Array.isArray(rule.types) || !rule.types.length || !rule.types.every(t => damageTypes.includes(t)) ) errors.push(shape);
  else if ( !isId(rule.effect) ) errors.push(shape);
  for ( const key of Object.keys(rule) ) if ( !["types", "effect"].includes(key) ) errors.push(`${at}onDamageTaken.${key}: unknown key`);
  return errors;
}
