/**
 * Robustesse de la non-vie (§61) vue depuis Foundry : l'item qui la porte (contenu `fortitude`, par identifiant) et la sauvegarde
 * en attente. Les dégâts qui la déclenchent sont lus dans `dnd5e.preApplyDamage` (adapter/death.mjs, `planDamageAtZero`) : la
 * sauvegarde due part dans la même écriture que les PV, en drapeau de l'acteur, et le MJ actif la joue ensuite
 * (runtime/fortitude.mjs). Tant qu'elle attend, la créature n'est ni Morte ni Inconsciente (`ensureDowned`).
 */

import { MODULE_ID } from "../constants.mjs";
import { fortitudeSave } from "../core/fortitude.mjs";
import { contentOf } from "./content.mjs";

const FLAG = "fortitude";

/** L'item de Robustesse de la non-vie de l'acteur, ou null. */
export function fortitudeOf(actor) {
  return (actor?.items ?? []).find(i => contentOf(i).entry?.fortitude === true) ?? null;
}

/** La sauvegarde en attente : `{ dc, item }`, ou null. */
export const pendingFortitude = actor => actor?.getFlag(MODULE_ID, FLAG) ?? null;

/**
 * `dnd5e.preApplyDamage` : si ces dégâts font tomber l'acteur à 0 PV et que la règle s'applique, la sauvegarde due est inscrite
 * dans `updates` (écrite avec les PV). Rend la sauvegarde, ou null.
 */
export function planFortitude(actor, hit, updates) {
  const item = fortitudeOf(actor);
  if ( !item ) return null;
  const save = fortitudeSave(hit);
  if ( !save ) return null;
  updates[`flags.${MODULE_ID}.${FLAG}`] = { dc: save.dc, item: item.name };
  return save;
}

export const clearFortitude = actor => actor.unsetFlag(MODULE_ID, FLAG);
