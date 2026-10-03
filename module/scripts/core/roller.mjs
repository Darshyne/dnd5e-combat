/**
 * Qui lance un jet imposé à un acteur (sauvegarde, concentration) : son joueur s'il est connecté,
 * sinon le moteur. Fonction pure (SPEC, principe 2 : chacun lance ses propres dés).
 */

/**
 * @param {Array<{id: string, active: boolean, isGM: boolean, owner: boolean}>} users
 * @returns {string|null}  Id du joueur qui lance, ou null si c'est au moteur (client du MJ actif).
 */
export function chooseRoller(users) {
  const players = users.filter(u => u.active && !u.isGM && u.owner).map(u => u.id).sort();
  return players[0] ?? null;
}
