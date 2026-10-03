/**
 * Soutien (Help, règles 2024), partie attaque : on distrait un ennemi à 1,50 m ; la prochaine attaque
 * d'un de NOS alliés contre lui a l'avantage, avant le début de notre prochain tour. La marque est un
 * effet sur l'ennemi (`flags["dnd5e-combat"].help`), posé et retiré par le MJ actif (runtime/help.mjs) ;
 * le client de l'attaquant la lit pour l'avantage (adapter/conditions.mjs).
 */

import { MODULE_ID } from "../constants.mjs";

/** Les marques de Soutien posées sur un acteur. */
export function helpMarksOn(actor) {
  return (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "help"));
}

/**
 * Cette attaque profite-t-elle d'un Soutien ? Il faut une marque sur la cible, posée par un allié de
 * l'attaquant (même disposition) qui n'est pas l'attaquant lui-même.
 */
export function helpedAgainst(attackerToken, targetToken) {
  return helpMarksOn(targetToken?.actor).some(effect => {
    const help = effect.getFlag(MODULE_ID, "help");
    return (help.disposition === attackerToken?.disposition) && (help.helper !== attackerToken?.uuid);
  });
}

/** Les marques qu'une attaque de cet attaquant consomme sur cette cible. */
export function helpMarksUsedBy(attackerToken, targetToken) {
  return helpMarksOn(targetToken?.actor).filter(effect => {
    const help = effect.getFlag(MODULE_ID, "help");
    return (help.disposition === attackerToken?.disposition) && (help.helper !== attackerToken?.uuid);
  });
}

/** Pose une marque de Soutien sur la cible, au nom de celui qui aide. */
export async function markHelped(targetToken, helperToken, { name, img }) {
  const actor = targetToken?.actor;
  if ( !actor ) return null;
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name, img, transfer: false, disabled: false, statuses: [], changes: [], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [MODULE_ID]: { help: { helper: helperToken.uuid, disposition: helperToken.disposition } } }
  }]);
  return effect ?? null;
}
