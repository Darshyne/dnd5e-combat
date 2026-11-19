/**
 * La relance d'un jet raté que paie une activité (`rollBonus.reroll` avec `activity`, §280) : sa formule. Fonction pure.
 * @param {{bonus?: string, advantage?: true}|null} reroll  `advantage` — le nouveau jet a l'Avantage (Contre-charme) : deux d20,
 *   le meilleur gardé.
 * @returns {string}
 */
export function rerollFormula(reroll) {
  const die = (reroll?.advantage === true) ? "2d20kh" : "1d20";
  const bonus = String(reroll?.bonus ?? "").trim();
  return (bonus && (bonus !== "0")) ? `${die} + ${bonus}` : die;
}
