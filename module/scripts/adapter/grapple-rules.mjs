import { contentOf } from "./content.mjs";

/**
 * §281 : ce que les items d'un agrippeur ajoutent à l'empoignade — `grappleSize` (`bonus` tailles de plus pour Agripper et Pousser,
 * `dragFree` : traîner sans surcoût une victime d'au plus tant de tailles de plus), `inescapable` (Désavantage contre sa prise),
 * `grappleCover` (abri contre les autres pendant qu'il agrippe).
 */
export function grappleRulesOf(actor) {
  const out = { bonus: 0, dragFree: null, inescapable: false, cover: null };
  for ( const item of actor?.items ?? [] ) {
    const entry = contentOf(item).entry;
    if ( !entry ) continue;
    if ( entry.grappleSize ) {
      out.bonus = Math.max(out.bonus, entry.grappleSize.bonus ?? 0);
      if ( Number.isInteger(entry.grappleSize.dragFree) ) out.dragFree = Math.max(out.dragFree ?? -Infinity, entry.grappleSize.dragFree);
    }
    if ( entry.inescapable === true ) out.inescapable = true;
    if ( entry.grappleCover ) out.cover = entry.grappleCover;
  }
  return out;
}
