/**
 * Chercher (Search, SPEC §16.49, règles 2024) contre les créatures cachées : un test de Sagesse (Perception) contre le DD de
 * chaque cachette (le total de Discrétion, porté par l'effet de Furtivité). Ici : les verdicts, sans Foundry.
 *
 * Par candidat, dans l'ordre :
 *  - `sensed` : l'observateur la perçoit déjà malgré l'état Invisible (vision aveugle, vision véritable…) → trouvée, sans jet ;
 *  - `seeable` faux : hors de vue (mur, plancher, brume, ténèbres qu'il ne perce pas — zone fortement obscurcie pour lui) →
 *    pas trouvée, quel que soit le jet ;
 *  - sinon le jet ; `disadvantage` : la cachette est en zone légèrement obscurcie pour lui (lumière perçue faible,
 *    core/illumination.mjs).
 *
 * Un seul test pour l'action. Si une cachette seulement est en lumière faible, le test est lancé avec le Désavantage et, pour
 * les cachettes en pleine lumière, on garde le PREMIER d20 : c'est exactement le test sans Désavantage.
 */

/**
 * Le mode du test : Désavantage si une cachette à juger au jet est en zone légèrement obscurcie.
 * @param {Array<{sensed?: boolean, seeable?: boolean, disadvantage?: boolean}>} candidates
 * @returns {"normal"|"disadvantage"}
 */
export function searchRollMode(candidates) {
  return candidates.some(c => !c.sensed && c.seeable && c.disadvantage) ? "disadvantage" : "normal";
}

/**
 * Le total sans Désavantage tiré d'un test lancé avec : le total, moins le d20 gardé, plus le premier d20.
 * @param {{total: number, d20: number[], kept: number|null}} roll   `d20` : les d20 lancés, dans l'ordre (hors relances) ;
 *                                                                  `kept` : celui qui compte dans `total`.
 * @returns {number}
 */
export function normalTotal({ total, d20=[], kept=null }) {
  if ( (d20.length < 2) || !Number.isFinite(kept) ) return total;
  return total - kept + d20[0];
}

/**
 * Les verdicts.
 * @param {Array<{id: string, dc: number, sensed?: boolean, seeable?: boolean, disadvantage?: boolean}>} candidates
 * @param {{total: number, d20?: number[], kept?: number|null}} roll   Le test tel que lancé (mode de `searchRollMode`).
 * @returns {Array<{id: string, found: boolean, reason: "senses"|"unseen"|"roll", total?: number, dc: number}>}
 */
export function searchVerdicts(candidates, roll) {
  const withDisadvantage = roll.total;
  const without = normalTotal(roll);
  return candidates.map(c => {
    if ( c.sensed ) return { id: c.id, found: true, reason: "senses", dc: c.dc };
    if ( !c.seeable ) return { id: c.id, found: false, reason: "unseen", dc: c.dc };
    const total = c.disadvantage ? withDisadvantage : without;
    return { id: c.id, found: total >= c.dc, reason: "roll", total, dc: c.dc };
  });
}

/** Désavantage sur une valeur passive : −5 (règles 2024, glossaire du PHB). */
export const PASSIVE_DISADVANTAGE = 5;

/**
 * Perception passive (SPEC §16.51) : l'observateur remarque-t-il la créature cachée sans la chercher ? Perçue par ses sens →
 * oui ; hors de vue → non ; sinon sa Perception passive, −5 si la cachette est en zone légèrement obscurcie pour lui, contre
 * le DD de la cachette.
 * @param {{passive: number, sensed?: boolean, seeable?: boolean, disadvantage?: boolean}} observer
 * @param {number} dc
 * @returns {{notices: boolean, score: number|null}}  `score` : la valeur comparée au DD (null sans comparaison).
 */
export function passiveNotice({ passive, sensed=false, seeable=false, disadvantage=false }, dc) {
  if ( sensed ) return { notices: true, score: null };
  if ( !seeable || !Number.isFinite(passive) ) return { notices: false, score: null };
  const score = passive - (disadvantage ? PASSIVE_DISADVANTAGE : 0);
  return { notices: score >= dc, score };
}
