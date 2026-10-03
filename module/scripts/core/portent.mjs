/**
 * §36 : Présage (Divination 3, Manuel des joueurs 2024) — à chaque Repos long, le devin tire deux d20 qu'il garde en réserve.
 * Chacun peut prendre la place du résultat d'un Test d20 du devin ou d'une créature qu'il voit, à annoncer avant le jet et au
 * plus une fois par tour ; un d20 de réserve ne sert qu'une fois et ceux qui restent sont perdus au Repos long suivant.
 * Présage supérieur (14) : trois d20.
 *
 * L'état tenu sur le devin : { rolls: number[], turn: string|null } — `turn` : le tour de jeu où il a servi (« combat.round.turn »,
 * adapter/turn.mjs), null hors combat (hors combat, pas de limite).
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** L'état lu tel quel, rendu propre : des d20 (1 à 20, entiers), un tour ou null. */
export function readPortent(state) {
  const rolls = Array.isArray(state?.rolls) ? state.rolls.filter(n => Number.isInteger(n) && (n >= 1) && (n <= 20)) : [];
  return { rolls, turn: (typeof state?.turn === "string") ? state.turn : null };
}

/** Peut-il s'en servir maintenant ? Des jets restants, et pas déjà ce tour-ci (en combat). */
export function canForetell(state, turnKey) {
  const { rolls, turn } = readPortent(state);
  return (rolls.length > 0) && !((turnKey !== null) && (turn === turnKey));
}

/** Les valeurs proposables, sans doublon, de la plus haute à la plus basse. */
export function portentChoices(state) {
  return [...new Set(readPortent(state).rolls)].sort((a, b) => b - a);
}

/**
 * Le jet noté est dépensé : une seule occurrence de la valeur retirée, le tour retenu. null si la valeur n'est pas (ou plus) notée.
 * @returns {{rolls: number[], turn: string|null}|null}
 */
export function spendPortent(state, value, turnKey) {
  const { rolls } = readPortent(state);
  const at = rolls.indexOf(value);
  if ( at < 0 ) return null;
  return { rolls: rolls.filter((_, i) => i !== at), turn: turnKey };
}

/** Le d20 remplacé : bornes du jet égales à la valeur notée (dnd5e : « 1d20min7max7 » vaut 7, Avantage compris). */
export function foretoldRange(value) {
  return { minimum: value, maximum: value };
}
