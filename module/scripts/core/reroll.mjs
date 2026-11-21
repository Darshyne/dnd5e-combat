/**
 * La relance d'un jet raté que paie une activité (`rollBonus.reroll` avec `activity`, §280) : sa formule. Fonction pure.
 * @param {{bonus?: string, advantage?: true, sets?: number}|null} reroll  `advantage` — le nouveau jet a l'Avantage
 *   (Contre-charme) : deux d20, le meilleur gardé ; `sets` — rien n'est relancé, le d20 prend cette valeur (Coup de chance :
 *   « le jet devient un 20 »).
 * @returns {string}
 */
export function rerollFormula(reroll) {
  const die = Number.isInteger(reroll?.sets) ? String(reroll.sets) : (reroll?.advantage === true) ? "2d20kh" : "1d20";
  const bonus = String(reroll?.bonus ?? "").trim();
  return (bonus && (bonus !== "0")) ? `${die} + ${bonus}` : die;
}

/**
 * Cette relance se propose-t-elle ? Un jet raté contre un DD connu ; et, pour un d20 fixé (`sets`), aussi un test dont le moteur ne
 * connaît pas le DD (au joueur de juger, « après l'avoir vu ») — jamais quand le d20 vaut déjà autant. Fonction pure.
 * @param {{sets?: number}|null} reroll
 * @param {{d20: number|null, total: number, needed: number|null}} roll
 */
export function rerollOffered(reroll, { d20, total, needed }) {
  if ( !Number.isInteger(d20) ) return false;
  const fixed = Number.isInteger(reroll?.sets);
  if ( fixed && (d20 >= reroll.sets) ) return false;
  return Number.isFinite(needed) ? (total < needed) : fixed;
}

/** La question de cette relance (clé sous `DND5ECOMBAT.Relance.`). Fonction pure. */
export function rerollQuestion(reroll, needed) {
  if ( Number.isInteger(reroll?.sets) ) return Number.isFinite(needed) ? "QuestionFixe" : "QuestionFixeTest";
  return (reroll?.advantage === true) ? "QuestionAvantage" : "QuestionPayee";
}
