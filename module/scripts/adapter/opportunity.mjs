/**
 * M8 (SPEC §18.15) : les créatures qui ne provoquent pas d'attaque d'opportunité — contenu `noOpportunity`, par identifiant :
 *  - `always` : Agile (Cerf, Rat) — « doesn't provoke an Opportunity Attack when it moves out of an enemy's reach » ;
 *  - `flying` : Vol rasant (Hibou, Gargouille, Hippogriffe…) — « … when it flies out of an enemy's reach » ;
 *  - `afterUse` : une action « moves up to its Speed without provoking Opportunity Attacks » (Charge piétinante, Rôder…) —
 *    utilisée, le reste du tour se joue comme après Se désengager (runtime/turn.mjs). Le texte anglais d'origine doit le
 *    dire : deux « Engulf » du MM portent le même identifiant, un seul se déplace sans provoquer.
 */

import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";
import { isAirborne } from "./altitude.mjs";

const kindsOf = actor => new Set((actor?.items ?? []).map(i => contentOf(i).entry?.noOpportunity).filter(Boolean));

/**
 * Ce déplacement échappe-t-il aux attaques d'opportunité par une capacité passive ? Vol rasant : un pas en vol (action de
 * déplacement `fly` du cœur V14), ou un départ en l'air.
 * @param {Actor5e} actor
 * @param {TokenDocument} token
 * @param {object[]} waypoints
 */
export function avoidsOpportunity(actor, token, waypoints) {
  const kinds = kindsOf(actor);
  if ( kinds.has("always") ) return true;
  if ( !kinds.has("flying") ) return false;
  return waypoints.some(w => w.action === "fly") || (token ? isAirborne(token) : false);
}

/** L'item utilisé libère-t-il le reste du tour des attaques d'opportunité ? */
export function freesMovement(item) {
  if ( contentOf(item).entry?.noOpportunity !== "afterUse" ) return false;
  const text = englishDescription(item).replace(/&amp;/g, "&").replace(/&Reference\[([^\]]*)\](?:\{[^}]*\})?/g, "$1");
  return /without provoking\W+(?:an\W+)?opportunity\W*attacks?/i.test(text);
}
