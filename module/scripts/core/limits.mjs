/**
 * Limites d'utilisation d'une activité que dnd5e ne contrôle pas (SPEC §16.40, clé `usageLimits` de core/content.mjs) :
 *  - `oncePerTurn` : « une fois à chacun de vos tours » — en combat, seulement à son tour, et une fois ;
 *  - `whenEmpty` : seulement quand l'item de cet identifiant n'a plus d'utilisation (Regain sauvage : « si vous n'avez plus
 *    d'utilisation de Forme sauvage ») ;
 *  - `lowestSlot` : l'emplacement de sort dépensé est d'office le plus bas disponible, sans fenêtre ;
 *  - `unmoved` : seulement si l'on ne s'est pas déplacé ce tour (Visée stable, §20) — en combat.
 * Fonctions pures.
 */

/**
 * Ce qui cloche, en mode souple (le joueur peut passer outre).
 * @param {{oncePerTurn?: boolean, whenEmpty?: string, unmoved?: boolean}} rule
 * @param {{inCombat: boolean, ownTurn: boolean, usedThisTurn: boolean, remaining: number|null, moved?: boolean}} state
 * @returns {string[]}  « notOwnTurn », « oncePerTurn », « notEmpty », « moved ».
 */
export function usageLimitIssues(rule, { inCombat, ownTurn, usedThisTurn, remaining, moved=false }) {
  const issues = [];
  if ( rule?.oncePerTurn && inCombat ) {
    if ( !ownTurn ) issues.push("notOwnTurn");
    else if ( usedThisTurn ) issues.push("oncePerTurn");
  }
  if ( rule?.whenEmpty && Number.isFinite(remaining) && (remaining > 0) ) issues.push("notEmpty");
  if ( rule?.unmoved && inCombat && moved ) issues.push("moved");
  return issues;
}

/**
 * §16.40 : le plus bas niveau d'emplacement de sort encore disponible, ou null. Pour une activité où le niveau ne change rien
 * (Regain de Forme sauvage : « en dépensant un emplacement de sort ») : dépenser plus haut, c'est gaspiller.
 * @param {Record<number, number>} available  Emplacements restants par niveau (1 à 9).
 */
export function lowestSlotLevel(available) {
  for ( let level = 1; level <= 9; level++ ) if ( (Number(available[level]) || 0) > 0 ) return level;
  return null;
}
