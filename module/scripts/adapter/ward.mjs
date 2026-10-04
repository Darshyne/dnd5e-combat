/**
 * §73 : Protection contre la mort (`death-ward`, clé de contenu `wardsAtZero`) — « la première fois que la cible devrait tomber à 0 point
 * de vie avant la fin du sort, elle tombe à 1 point de vie à la place, et le sort prend fin ». À `dnd5e.preApplyDamage`, avant tout
 * le reste de la mort (adapter/death.mjs, `planDamageAtZero`) : des dégâts qui la feraient tomber à 0 — même assez pour la tuer sur le
 * coup, puisqu'elle n'y tombe pas — la laissent à 1 PV, et l'effet du sort est retiré. « Un effet qui la tuerait sur le coup sans
 * infliger de dégâts » est annulé : au MJ.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** L'effet actif d'un sort `wardsAtZero` que porte l'acteur, ou null. */
export function deathWardOf(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    if ( contentOf(originItemOf(effect)).entry?.wardsAtZero === true ) return effect;
  }
  return null;
}

/**
 * Des dégâts qui feraient tomber la créature à 0 PV : elle reste à 1 PV (dans la même mise à jour), et l'effet tombe. Rend l'effet
 * retiré, ou null. `through` : les dégâts qui passent les PV temporaires.
 */
export function wardAtZero(actor, through, updates) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !(hp.value > 0) || (through < hp.value) ) return null;
  const effect = deathWardOf(actor);
  if ( !effect ) return null;
  updates["system.attributes.hp.value"] = 1;
  effect.delete().catch(err => console.warn(`${MODULE_ID} | ${effect.name} : effet non retiré`, err));
  return effect;
}
