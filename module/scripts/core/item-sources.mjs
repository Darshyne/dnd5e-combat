/**
 * §276 : d'où vient un objet, pour les réparations du diagnostic (`runtime/diagnostic/checks.mjs`). Pur : aucune dépendance à Foundry.
 *  - "reference" : les compendiums de référence (Manuel des joueurs, Manuel des monstres, dnd5e) — ceux où l'on cherche un remplaçant ;
 *  - "premium"   : un autre module officiel (`dnd-…` : Ravenloft, Guide du maître…) — c'est déjà l'objet officiel, on ne le remplace
 *    jamais par un homonyme d'un autre livre (le « Survivant » de Ravenloft n'est pas le « Survivor » du Champion, même identifiant) ;
 *  - "other"     : un module tiers ou un import (CPR, D&D Beyond, monde) — à reprendre ;
 *  - "none"      : sans source.
 */

export const REFERENCE_SOURCE = /^Compendium\.(dnd-players-handbook|dnd-monster-manual|dnd5e)\./;
export const PREMIUM_SOURCE = /^Compendium\.dnd-[a-z0-9-]+\./;

/** @param {string|null|undefined} src  `_stats.compendiumSource` */
export function sourceKind(src) {
  if ( !src ) return "none";
  if ( REFERENCE_SOURCE.test(src) ) return "reference";
  if ( PREMIUM_SOURCE.test(src) ) return "premium";
  return "other";
}
