/**
 * §225 : le plan d'une créature lu dans dnd5e 6.0 — le statut `ethereal` (config.mjs, `statusEffects.ethereal`, que posent Forme
 * éthérée, Clignotement, l'Huile d'éthéréalité ; dnd5e n'en fait rien d'autre que `neverBlockMovement`). Règle au cœur
 * (core/plane.mjs).
 *
 * Lot 2, ce qui laisse voir l'Éthéré depuis le plan matériel :
 *  - « Ethereal Plane » dans les sens spéciaux (`system.attributes.senses.special`, chaîne libre) : Détection de l'invisibilité et le
 *    Troisième œil du Magicien l'y ajoutent dans leurs données (PHB 2024) — sans limite autre que la vue ;
 *  - Vision suprême (`senses.ranges.truesight`, data/shared/senses-field.mjs) : à sa portée ;
 *  - Vision éthérée (trait du MM, identifiant `ethereal-sight`) : 60 ft.
 */

import { samePlane as samePlaneOf, planeOf, perceivesAcross, ETHEREAL } from "../core/plane.mjs";
import { identifierOf } from "./content.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";

/** Portées de règle, en pieds (convertis à la grille de la scène). */
const ETHEREAL_SIGHT_FT = 60;   // Vision éthérée (MM 2024)
const BORDER_VIEW_FT = 60;      // depuis l'Éthéré, « rien au-delà de 60 ft » (Forme éthérée, Clignotement)
const SPECIAL_SENSE = /ethereal|éthéré/i;

/** Les statuts d'un token (document ou objet du canevas), d'un acteur, ou null. */
function statusesOf(thing) {
  const actor = thing?.actor ?? ((thing?.documentName === "Actor") ? thing : null) ?? thing?.document?.actor ?? null;
  return actor?.statuses ?? null;
}

/** La créature (token ou acteur) est-elle dans le plan Éthéré ? */
export function isEthereal(thing) {
  return planeOf(statusesOf(thing)) === ETHEREAL;
}

/** Deux créatures (tokens ou acteurs) sur le même plan ? Ce qui n'est pas une créature (null, un point) est sur le plan matériel. */
export function samePlane(a, b) {
  return samePlaneOf(statusesOf(a), statusesOf(b));
}

/** Jusqu'où l'acteur voit dans l'Éthéré depuis le plan matériel, dans l'unité de la grille ; null : il ne le voit pas. */
export function etherealSightOf(actor, gridUnits, factors=readUnitFactors()) {
  const senses = actor?.system?.attributes?.senses;
  if ( !senses ) return null;
  if ( SPECIAL_SENSE.test(senses.special ?? "") ) return Infinity;
  let range = null;
  const truesight = Number(senses.ranges?.truesight ?? 0);
  if ( truesight > 0 ) range = lengthIn(truesight, senses.units ?? "ft", gridUnits, factors);
  if ( actor.items?.some(i => identifierOf(i) === "ethereal-sight") ) {
    range = Math.max(range ?? 0, lengthIn(ETHEREAL_SIGHT_FT, "ft", gridUnits, factors));
  }
  return range;
}

/** Le fantôme du MM : sa Forme éthérée le laisse « visible sur le plan matériel … et inversement ». */
function visibleAcross(actor) {
  return !!actor?.items?.some(i => (i.type === "feat") && (identifierOf(i) === "etherealness"));
}

/**
 * L'observateur peut-il percevoir la cible, quant au plan (le reste de la vue décide ensuite) ? Tokens (documents).
 * Toujours vrai sur le même plan ; d'un plan à l'autre, la règle du cœur.
 */
export function perceivesPlane(observer, target) {
  if ( !observer || !target || (observer === target) ) return true;
  const observerPlane = planeOf(statusesOf(observer));
  const targetPlane = planeOf(statusesOf(target));
  if ( observerPlane === targetPlane ) return true;
  const units = target.parent?.grid?.units ?? "ft";
  const factors = readUnitFactors();
  return perceivesAcross({
    observerPlane, targetPlane,
    distance: distanceBetween(observer, target).value,
    etherealSight: etherealSightOf(observer.actor, units, factors),
    limit: lengthIn(BORDER_VIEW_FT, "ft", units, factors),
    visibleAcross: visibleAcross(target.actor)
  });
}
