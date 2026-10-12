/**
 * Ce que d'autres modules automatisent aussi (SPEC §16.11, §156) : la règle appartient au moteur, qui doit marcher sans eux ; un
 * module d'animations ne garde que ses images et ses sons.
 *
 * BLFX (Boss Loot, « boss-loot-assets-premium » 3.5.2, scripts/macros/spell/customSpells2.js, `wardingBondCreateAE`) : le Lien
 * protecteur pose sur l'effet `flags["boss-loot-assets-premium"].blfxCustom` avec `trigger: "applyDamage"`, et son hook
 * `dnd5e.applyDamage` (scripts/hooks.js:710, `_applyDamage`) fait alors subir au lanceur les dégâts du porteur
 * (`wardingBondApplyDamage`). Le moteur partageant lui-même, ce déclencheur est désarmé : sa valeur change, le reste de la marque
 * (rayon persistant, retrait) est gardé. Rien n'est patché : on écrit un flag sur l'effet, comme BLFX lui-même.
 */

import { MODULE_ID } from "../constants.mjs";

const BLFX = "boss-loot-assets-premium";

/** La valeur que prend le déclencheur désarmé : `_applyDamage` ne retient que `"applyDamage"`. */
export const DISARMED_TRIGGER = `${MODULE_ID}:applyDamage`;

/**
 * Un autre module ferait-il aussi subir au lanceur les dégâts que cet effet partage ? Rend son nom, ou null.
 * @param {ActiveEffect} effect
 */
export function foreignDamageShare(effect) {
  if ( !effect ) return null;
  if ( game.modules.get(BLFX)?.active && (effect.flags?.[BLFX]?.blfxCustom?.trigger === "applyDamage") ) return "BLFX";
  return null;
}

/**
 * Désarme le partage de dégâts d'un autre module sur cet effet. MJ actif.
 * @param {ActiveEffect} effect
 * @returns {Promise<string|null>}  Le module désarmé, ou null.
 */
export async function disarmForeignDamageShare(effect) {
  const owner = foreignDamageShare(effect);
  if ( owner !== "BLFX" ) return null;
  await effect.update({ [`flags.${BLFX}.blfxCustom.trigger`]: DISARMED_TRIGGER });
  return owner;
}
