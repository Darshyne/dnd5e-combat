/**
 * Ce qui, sur la scène, n'est pas une créature (SPEC §16.60) : un objet piloté par le moteur (Arme spirituelle, Sphère de
 * feu : flag `dnd5e-combat.object`, §16.15). Ni cible, ni obstacle, ni allié, ni ennemi ; il ne donne pas d'abri et ne subit
 * pas de zone. (Jusqu'à la 0.149 : aussi un tas d'objets au sol d'Item Piles, un token — retiré au §44 ; ce qu'une créature
 * lâche est posé par un module voisin, qui en fait une région et une tuile.)
 */

import { MODULE_ID } from "../constants.mjs";

/**
 * Les types d'acteur de dnd5e qui ne sont jamais une créature : un groupe (le contenant de butin d'un module voisin, le groupe
 * d'aventuriers) et une rencontre. §260 : posés sur une scène, ils étaient pris dans les zones, qui attendaient pour toujours leur
 * sauvegarde.
 */
const NON_CREATURE_TYPES = Object.freeze(["group", "encounter"]);

/** Pas une créature : objet piloté, ou acteur d'un type qui n'en est jamais une. */
export function isObjectToken(token) {
  return !!token?.flags?.[MODULE_ID]?.object || NON_CREATURE_TYPES.includes(token?.actor?.type);
}
