/**
 * Des tours d'affilée (clé de contenu `extraTurns`) : Arrêt du temps — « vous jouez 1d4 + 1 tours d'affilée, pendant lesquels vous
 * pouvez utiliser des actions et vous déplacer normalement ». Le compte restant est noté sur le lanceur ; à la fin de chacun de ses
 * tours, tant qu'il en reste, le combat revient à lui au lieu de passer au suivant. Fonctions pures.
 */

/**
 * Le tour qui vient de finir doit-il être rejoué par le même combattant ?
 * @param {{combat: string, left: number}|null|undefined} state  Ce que porte le combattant dont le tour finit.
 * @param {{combat: string, forward: boolean}} change         Le combat, et si le tracker a avancé (pas un retour arrière du MJ).
 */
export function takesAnotherTurn(state, { combat, forward }) {
  return !!state && (state.combat === combat) && (state.left > 0) && (forward === true);
}

/** Le tracker a-t-il avancé de `prior` à `current` ? (round suivant, ou même round et tour plus loin) */
export function movedForward(prior, current) {
  if ( !prior || !current ) return false;
  return (current.round > prior.round) || ((current.round === prior.round) && (current.turn > prior.turn));
}

/** Les erreurs de la clé. Vide = valide. */
export function validateExtraTurns(rule, at) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && (typeof rule.formula === "string") && rule.formula.trim()
    && Object.keys(rule).every(k => k === "formula");
  return ok ? [] : [`${at}extraTurns: { formula }`];
}
