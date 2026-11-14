/**
 * Les utilisations d'un item (`system.uses` de dnd5e) dépensées par le moteur hors d'une activité : une réaction payée par un autre
 * item, un châtiment, un don qui sert une fois par repos…
 */

import { levelHidden } from "./level-gate.mjs";

/**
 * §438 : ce qui tient le compte d'une activité qui se dépense — l'activité si elle a ses propres utilisations (Manuel 2.2.0 : Frappe
 * effroyable, `activityUses`), sinon l'item dont elle consomme les utilisations (Manuel 3.0.0 : `itemUses` sans cible = son item ; une
 * cible = cet item de l'acteur). `{ left, spend() }`, ou null.
 */
export function usesHolderOf(activity) {
  if ( !activity ) return null;
  const own = activity.uses;
  if ( own && (own.max !== "") && (own.max != null) && Number.isFinite(Number(own.value)) ) {
    return { left: Math.max(0, Number(own.value) || 0), spend: () => activity.update({ "uses.spent": (Number(own.spent) || 0) + 1 }) };
  }
  const target = (activity.consumption?.targets ?? []).find(t => t.type === "itemUses");
  const item = target ? (target.target ? activity.actor?.items?.get(target.target) : activity.item) : null;
  if ( !item?.system?.uses ) return null;
  const n = Number(target.value) || 1;
  return { left: Math.max(0, Math.floor((Number(item.system.uses.value) || 0) / n)), spend: () => spendItemUses(item, n) };
}

/** §438 : la première activité de la liste que l'item porte et que la fiche montre à ce niveau (`ask.uses`), ou null. */
export function shownActivityOf(item, ids) {
  for ( const id of [ids].flat() ) {
    const a = item?.system?.activities?.get?.(id);
    if ( a && !levelHidden(a) ) return a;
  }
  return null;
}

/** Dépenser `n` utilisations de l'item (`system.uses.spent`). Rend la promesse de la mise à jour. */
export function spendItemUses(item, n=1) {
  return item.update({ "system.uses.spent": (Number(item.system.uses?.spent) || 0) + n });
}
