/**
 * §212 : En feu (danger « Burning » du glossaire 2024) — qui brûle. dnd5e a l'état `burning` (config.mjs, `statusEffects.burning`,
 * pseudo-état du HUD du token, sans mécanique) ; s'y ajoutent les effets qu'un item déclare « En feu » (`burns` : le feu grégeois, dont
 * l'effet n'a que son nom).
 */

import { contentOf } from "./content.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";

export const BURNING = "burning";
/** « 1d4 dégâts de feu au début de chacun de ses tours ». */
export const BURN_DAMAGE = Object.freeze({ formula: "1d4", type: "fire" });

/** Cet effet met-il en feu son porteur ? */
export function isBurningEffect(effect) {
  if ( !effect || effect.disabled || effect.isSuppressed ) return false;
  if ( effect.statuses?.has?.(BURNING) ) return true;
  const ids = contentOf(originItemOf(effect)).entry?.burns ?? [];
  return ids.some(id => comesFromItemEffect(effect, id));
}

/** Les effets qui mettent cet acteur en feu. */
export const burningEffectsOf = actor => (actor?.effects ?? []).filter(isBurningEffect);

/** L'acteur est-il en feu ? */
export const isBurning = actor => burningEffectsOf(actor).length > 0;

/** Immunisé contre le feu (il ne prend pas feu par propagation) ? */
export const fireImmune = actor => !!actor?.system?.traits?.di?.value?.has?.("fire");
