/**
 * §250 : les rounds d'un évènement d'initiative (runtime/combat-events.mjs). Pur.
 */

/**
 * Du round courant (0 avant le début du combat : il jouera au round 1) pour `rounds` rounds ; `rounds` null ou ≤ 0 : sans fin (`until`
 * null).
 * @returns {{ from: number, until: number|null }}
 */
export function eventRounds(round, rounds=1) {
  const from = Math.max(1, Math.floor(Number(round) || 0));
  const n = Math.floor(Number(rounds));
  return { from, until: (rounds === null) || !(n > 0) ? null : from + n - 1 };
}

/** L'évènement a-t-il fini, une fois joué son tour du round `round` ? */
export function eventEnded(event, round) {
  return Number.isFinite(event?.until) && Number.isFinite(Number(round)) && (Number(round) >= event.until);
}
