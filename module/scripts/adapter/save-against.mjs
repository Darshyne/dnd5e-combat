/**
 * `saveDisadvantageAgainst` (core/eligibility.mjs) : un objet porté — équipé, et harmonisé s'il l'exige — qui donne le Désavantage aux
 * sauvegardes imposées par une créature d'un sous-type (Armure démoniaque).
 */

import { saveDisadvantageAgainstHolds } from "../core/eligibility.mjs";
import { contentOf } from "./content.mjs";

const carried = item => (item.system?.equipped !== false) && ((item.system?.attunement !== "required") || (item.system?.attuned === true));

/** L'objet porté par `actor` qui lui donne le Désavantage contre une sauvegarde imposée par `source`, ou null. */
export function saveDisadvantageAgainst(actor, source) {
  const subtype = source?.system?.details?.type?.subtype;
  if ( !subtype || !actor || (actor === source) ) return null;
  return Array.from(actor.items ?? []).find(item => carried(item)
    && saveDisadvantageAgainstHolds(contentOf(item).entry?.saveDisadvantageAgainst, subtype)) ?? null;
}
