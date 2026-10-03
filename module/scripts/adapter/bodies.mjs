/**
 * Ce qui, sur la scène, n'est pas une créature (SPEC §16.60) : un objet piloté par le moteur (Arme spirituelle, Sphère de
 * feu : flag `dnd5e-combat.object`, §16.15). Ni cible, ni obstacle, ni allié, ni ennemi ; il ne donne pas d'abri et ne subit
 * pas de zone. (Jusqu'à la 0.149 : aussi un tas d'objets au sol d'Item Piles, un token — retiré au §44 ; ce qu'une créature
 * lâche est posé par un module voisin, qui en fait une région et une tuile.)
 */

import { MODULE_ID } from "../constants.mjs";

/** Pas une créature : objet piloté. */
export function isObjectToken(token) {
  return !!token?.flags?.[MODULE_ID]?.object;
}
