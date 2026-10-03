/**
 * Furtivité (Hide, règles 2024, glossaire du PHB : « L'action Furtivité vous permet d'essayer de vous
 * cacher ») lue dans Foundry. Conditions : Visibilité nulle, ou abri supérieur / total, ET hors du champ
 * de vision de tout ennemi. Le moteur juge la seconde exactement (vision simulée, adapter/vision.mjs) ;
 * la première en découle — si aucun ennemi ne vous voit, c'est l'obscurité, un abri ou ses sens —, sauf
 * des ennemis qui ne voient de toute façon rien (Aveuglés) : au MJ de trancher.
 * Réussie, la Furtivité est un effet « Invisible » sur l'acteur, qui porte le DD pour vous localiser.
 */

import { MODULE_ID } from "../constants.mjs";
import { areHostile } from "../core/reaction.mjs";
import { canSee, isVisionAvailable } from "./vision.mjs";
import { isObjectToken } from "./bodies.mjs";

export const OUT_OF_ACTION = ["incapacitated", "unconscious", "paralyzed", "petrified", "stunned", "dead"];

/**
 * Les ennemis actifs qui voient ce token, sur sa scène. null si la vision simulée est hors service
 * (on ne juge pas).
 * @returns {TokenDocument[]|null}
 */
export function enemiesSeeing(token) {
  if ( !isVisionAvailable() || !token?.parent ) return null;
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  return token.parent.tokens.filter(other => (other !== token) && other.actor && !other.hidden && !isObjectToken(other)
    && areHostile(token.disposition, other.disposition)
    && !OUT_OF_ACTION.some(s => other.actor.statuses.has(s)) && !other.actor.statuses.has(defeated)
    && (canSee(other, token) === true));
}

/** Les effets de Furtivité d'un acteur. */
export function hiddenEffectsOf(actor) {
  return (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "hidden"));
}

/** Données de l'effet de Furtivité réussie : l'état Invisible, et le DD pour vous localiser. */
export function hiddenEffectData(dc, name) {
  return {
    name, img: "icons/svg/cowled.svg", transfer: false, disabled: false, statuses: ["invisible"], changes: [],
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [MODULE_ID]: { hidden: { dc } } }
  };
}
