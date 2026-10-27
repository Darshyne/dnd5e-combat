/**
 * §105 : partager la case d'une autre créature. dnd5e décide qui bloque un déplacement dans
 * `TokenLayer5e#isOccupiedGridSpaceBlocking` (canvas/layers/tokens.mjs:10-49 : seuls les alliés, les créatures de deux tailles
 * d'écart et les Très petites se traversent) et publie ensuite `dnd5e.determineOccupiedGridSpaceBlocking(gridSpace, token,
 * options, found)`, dont l'ensemble `found` se modifie (tokens.mjs:36-47) : on en retire l'occupant dont on peut partager la
 * case. Le chemin contraint de dnd5e (canvas/token.mjs:113-118) et l'A* du moteur (adapter/movement.mjs, `blocked`) lisent
 * cette même fonction ; la fin de déplacement (« jamais sur une case occupée ») lit `sharesSpaceWith` elle-même.
 */

import { sharesSpaceWith } from "../adapter/space-sharing.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { route } from "./router.mjs";

function onBlocking(gridSpace, token, options, found) {
  if ( !found?.size || !token?.document ) return;
  for ( const other of Array.from(found) ) {
    if ( sharesSpaceWith(token.document, other.document) ) found.delete(other);
  }
}

export function registerSpaceSharing() {
  route("dnd5e.determineOccupiedGridSpaceBlocking", onBlocking, { label: "space sharing: passage refused" });
}

/**
 * §255 : un objet (piège posé, arme spirituelle : `flags.dnd5e-combat.object`) n'est pas une créature — il ne bloque pas le passage et
 * ne rend pas sa case difficile, quel que soit le niveau d'automatisation. dnd5e le jugeait créature d'un autre camp : un piège repéré,
 * redevenu visible, fermait le couloir (glisser du cœur et chemin du moteur).
 */
function dropObjects(gridSpace, token, options, found) {
  if ( !found?.size ) return;
  for ( const other of Array.from(found) ) if ( isObjectToken(other.document) ) found.delete(other);
}

export function registerObjectPassage() {
  route("dnd5e.determineOccupiedGridSpaceBlocking", dropObjects, { label: "objects: never block" });
  route("dnd5e.determineOccupiedGridSpaceDifficult", dropObjects, { label: "objects: no difficult terrain" });
}
