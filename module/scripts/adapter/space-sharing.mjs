/**
 * §105 : partager la case d'une autre créature, vu depuis Foundry. Une capacité de la fiche (contenu `sharesSpace`, par
 * identifiant : Forme d'air, Nuée…) vaut par sa présence ; un sort (Forme gazeuse) seulement par l'effet qu'il a posé — le
 * connaître ne suffit pas.
 */

import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { mayShareSpace, widerShare } from "../core/space-sharing.mjs";

/** @returns {"enter"|"mutual"|null} */
export function shareKindOf(actor) {
  if ( !actor ) return null;
  let kind = null;
  for ( const item of actor.items ?? [] ) {
    if ( item.type === "spell" ) continue;
    kind = widerShare(kind, contentOf(item).entry?.sharesSpace ?? null);
  }
  for ( const effect of actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item ) kind = widerShare(kind, contentOf(item).entry?.sharesSpace ?? null);
  }
  return kind;
}

/** Le token qui bouge peut-il traverser la case de l'autre et s'y arrêter ? Documents de token. */
export function sharesSpaceWith(mover, occupant) {
  if ( !mover?.actor || !occupant?.actor ) return false;
  return mayShareSpace(shareKindOf(mover.actor), shareKindOf(occupant.actor));
}
