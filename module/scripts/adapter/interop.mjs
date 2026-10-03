/**
 * Ce que d'autres modules automatisent déjà (SPEC §16.11) : un seul propriétaire par effet. Quand un module tiers marque
 * un effet comme le sien, le moteur s'efface au lieu de le faire une seconde fois.
 *
 * BLFX (Boss Loot, « boss-loot-assets-premium » 3.5.1, scripts/macros/spell/customSpells2.js, `wardingBondCreateAE`) :
 * le Lien protecteur pose sur l'effet `flags["boss-loot-assets-premium"].blfxCustom` avec `trigger: "applyDamage"`,
 * et son hook `dnd5e.applyDamage` (scripts/hooks.js, `_applyDamage`) fait subir au lanceur les dégâts du porteur.
 */

const BLFX = "boss-loot-assets-premium";

/**
 * Un autre module applique-t-il déjà les dégâts que cet effet partage ? Rend son nom, ou null.
 * @param {ActiveEffect} effect
 */
export function damageSharedElsewhere(effect) {
  if ( !effect ) return null;
  if ( game.modules.get(BLFX)?.active && (effect.flags?.[BLFX]?.blfxCustom?.trigger === "applyDamage") ) return "BLFX";
  return null;
}
