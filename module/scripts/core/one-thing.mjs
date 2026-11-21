/**
 * Hébétement (Frappes sournoises du Roublard, SRD 5.2) : « à son prochain tour, la cible ne peut faire qu'une seule de ces
 * choses : se déplacer, prendre une action ou prendre une action Bonus ». Fonctions pures, sur le budget du tour (core/turn.mjs).
 */

/**
 * Le budget tel que la règle le laisse : ce qui a déjà été fait ferme les deux autres portes.
 * @param {{action: number, bonus: number, limited?: number}} budget  le budget en cours
 * @param {{action: number, bonus: number}} fresh                    le budget d'un tour neuf
 * @param {boolean} moved                                            la créature s'est déplacée à ce tour
 */
export function oneThingBudget(budget, fresh, moved) {
  const acted = budget.action < fresh.action;
  const bonused = budget.bonus < fresh.bonus;
  if ( moved ) return { ...budget, action: 0, bonus: 0, limited: 0 };
  if ( acted ) return { ...budget, bonus: 0 };
  if ( bonused ) return { ...budget, action: 0, limited: 0 };
  return budget;
}

/** La créature a pris une action ou une action Bonus : elle ne se déplace plus à ce tour. */
export function oneThingStopsMove(budget, fresh) {
  return (budget.action < fresh.action) || (budget.bonus < fresh.bonus);
}
