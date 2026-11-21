/**
 * `castFromBearer` (core/cast-from-bearer.mjs) : les tokens d'où un acteur peut aussi mesurer la portée de ses sorts — ceux qui
 * portent un effet d'un de ses items déclarant la clé, à la distance dite (Regard de deux esprits).
 */

import { linkHolds } from "../core/cast-from-bearer.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { distanceBetween } from "./turn.mjs";
import { lengthIn } from "./units.mjs";

/** Les tokens de la scène de `origin` liés à `actor` par un effet `castFromBearer`, assez près de lui. */
export function linkedBearers(actor, origin, factors) {
  const out = [];
  if ( !actor || !origin?.parent ) return out;
  for ( const token of origin.parent.tokens ) {
    if ( token === origin ) continue;
    for ( const effect of token.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.isSuppressed ) continue;
      const item = originItemOf(effect);
      const rule = (item?.actor === actor) ? contentOf(item).entry?.castFromBearer : null;
      if ( !rule ) continue;
      const limit = lengthIn(rule.distance, rule.units, origin.parent.grid.units, factors);
      if ( linkHolds(distanceBetween(origin, token).value, limit) ) { out.push(token); break; }
    }
  }
  return out;
}
