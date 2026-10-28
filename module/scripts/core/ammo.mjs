/**
 * §274 : le choix de la munition d'une arme (issue #23). dnd5e ne propose la liste des munitions que dans sa fenêtre de jet
 * d'attaque ; sans cette fenêtre (jets sans dialogue), il reprend la dernière munition retenue sur l'arme
 * (`flags.dnd5e.last.<activité>.ammunition`, activity/attack.mjs:94), même épuisée, et une munition oubliée devient « aucune ».
 *
 * Pur : aucune dépendance à Foundry.
 */

/**
 * La munition qu'une attaque tirera, et s'il faut la demander.
 * @param {object} state
 * @param {Array<{id: string, quantity: number}>} state.options  Les munitions que l'arme peut tirer (dnd5e `ammunitionOptions`).
 * @param {string|null} [state.remembered]  La dernière munition retenue par dnd5e sur l'activité.
 * @param {string|null} [state.explicit]    Une munition imposée par l'appelant (configuration d'utilisation, voisin).
 * @returns {{use: string|null, ask: boolean, usable: string[]}}
 *   `use` : la munition retenue (ou présélectionnée quand `ask`) ; `ask` : plusieurs munitions utilisables et aucun choix imposé.
 */
export function ammoChoice({ options=[], remembered=null, explicit=null }={}) {
  const usable = options.filter(o => o.quantity > 0).map(o => o.id);
  if ( explicit && options.some(o => o.id === explicit) ) return { use: explicit, ask: false, usable };
  // Plus rien d'utilisable : on laisse dnd5e et la légalité (§142) dire « plus de munitions ».
  if ( !usable.length ) return { use: options.some(o => o.id === remembered) ? remembered : (options[0]?.id ?? null), ask: false, usable };
  const use = usable.includes(remembered) ? remembered : usable[0];
  return { use, ask: usable.length > 1, usable };
}
