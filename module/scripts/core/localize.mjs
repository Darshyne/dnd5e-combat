/**
 * §202 : les effets recopiés d'un compendium par le diagnostic du monde (runtime/diagnostic/checks.mjs). L'effet d'un objet magique
 * porte d'ordinaire le nom de l'objet (« Walloping Ammunition » sur « Walloping Ammunition ») ; une traduction qui traduit le nom de
 * l'objet sans celui de ses effets laissait l'effet recopié en anglais (retour de table du 2026-10-18 : « Projectile percutant »,
 * enchantement « Walloping Ammunition »). Un effet qui porte le nom d'origine (anglais) de l'objet prend son nom affiché.
 *
 * Pur : aucune dépendance à Foundry.
 */

/**
 * @param {object[]} effects        Données d'effets (`toObject()`), modifiées sur une copie.
 * @param {string|null} originalName Le nom d'origine de l'objet de référence (`flags.babele.originalName`), ou null.
 * @param {string} displayName       Le nom de l'objet tel qu'il est montré (traduit).
 * @returns {object[]}
 */
export function localizeEffectNames(effects, originalName, displayName) {
  if ( !originalName || !displayName || (originalName === displayName) ) return effects.map(e => ({ ...e }));
  return effects.map(e => ((e.name === originalName) ? { ...e, name: displayName } : { ...e }));
}
