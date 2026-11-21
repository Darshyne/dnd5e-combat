/**
 * Proie supérieure du chasseur (Rôdeur, Chasseur 11 — SRD 5.2) : « une fois par tour, quand vous infligez des dégâts à une créature
 * marquée par votre Marque du chasseur, vous pouvez aussi infliger les dégâts supplémentaires de ce sort à une autre créature que
 * vous voyez à 9 m ou moins de la première ». Fonctions pures.
 */

/**
 * Les créatures qui peuvent recevoir ces dégâts : pas la première, vues par le Rôdeur, ennemies, à portée de la première — de la
 * plus proche à la plus lointaine, `limit` au plus.
 * @param {Array<{id: string, name: string, distance: number, enemy: boolean, seen: boolean, first?: boolean}>} tokens
 *   `distance` : à la PREMIÈRE créature
 * @param {number} range
 * @param {number} [limit]
 */
export function splashTargets(tokens, range, limit=8) {
  return (tokens ?? []).filter(t => !t.first && t.enemy && t.seen && (t.distance <= range))
    .sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/** Une fois par tour : le tour de la dernière utilisation n'est pas celui-ci (hors combat, pas de tour à compter). */
export function splashAvailable(usedTurn, turn) {
  return (turn === null) || (usedTurn !== turn);
}

/** La formule des dégâts : celle de la règle, ou celle qu'une autre aptitude de la fiche lui substitue (Pourfendeur d'ennemis). */
export function splashFormula(rule, features) {
  const has = new Set(features ?? []);
  const upgrade = (rule.upgrades ?? []).find(u => has.has(u.feature));
  return upgrade?.formula ?? rule.formula;
}
