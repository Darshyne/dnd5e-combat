/**
 * Sort étendu (Métamagie, SRD 5.2) : « quand vous lancez un sort dont la durée est d'au moins 1 minute, vous pouvez dépenser
 * 1 point de sorcellerie pour doubler sa durée, jusqu'à 24 heures au plus ; si le sort demande la Concentration, vous avez
 * l'Avantage aux jets de sauvegarde pour la maintenir ». Fonction pure.
 */

const SECONDS = Object.freeze({ seconds: 1, second: 1, rounds: 6, round: 6, turns: 6, turn: 6, minutes: 60, minute: 60, hours: 3600,
  hour: 3600, days: 86400, day: 86400 });
const DAY = 86400;

/**
 * La durée doublée d'un effet, en secondes, ou null si le Sort étendu ne s'y applique pas (moins d'une minute, pas de durée
 * chiffrée).
 * Une durée déjà égale ou supérieure à 24 heures n'est pas allongée.
 * @param {{value?: number|string|null, units?: string|null}|null|undefined} duration
 * @returns {number|null}
 */
export function extendedSeconds(duration) {
  const value = Number(duration?.value);
  const unit = SECONDS[String(duration?.units ?? "")];
  if ( !Number.isFinite(value) || !(value > 0) || !unit ) return null;
  const seconds = value * unit;
  if ( (seconds < 60) || (seconds >= DAY) ) return null;
  return Math.min(seconds * 2, DAY);
}
