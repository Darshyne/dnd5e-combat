/**
 * §72 : le test en opposition (clé de contenu `contest`) — fonctions pures.
 */

/**
 * L'issue d'un test en opposition : l'auteur l'emporte s'il fait strictement plus ; à égalité, rien ne change (règles 2024,
 * « Contests » : la situation reste en l'état), donc l'auteur ne l'emporte pas.
 * @param {number} mine      Total de l'auteur.
 * @param {number} theirs    Total de la cible.
 * @returns {"win"|"lose"|"tie"}
 */
export function contestOutcome(mine, theirs) {
  if ( !Number.isFinite(mine) || !Number.isFinite(theirs) ) return "lose";
  if ( mine > theirs ) return "win";
  return (mine === theirs) ? "tie" : "lose";
}

/**
 * La compétence que la cible oppose : parmi celles permises, la meilleure pour elle (le plus grand bonus total).
 * @param {Record<string, number>} bonuses   Bonus total par compétence (`system.skills.<clé>.total`).
 * @param {string[]} allowed
 * @returns {string|null}
 */
export function bestSkill(bonuses, allowed) {
  let best = null;
  for ( const key of allowed ?? [] ) {
    if ( !(key in (bonuses ?? {})) ) continue;
    if ( (best === null) || ((Number(bonuses[key]) || 0) > (Number(bonuses[best]) || 0)) ) best = key;
  }
  return best ?? allowed?.[0] ?? null;
}
