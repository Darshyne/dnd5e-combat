/**
 * Issue GitHub #32 : « Succès à un prix », aide optionnelle du Guide du maître 2024 (chapitre 2). Quand un test d20 échoue de 1 ou 2,
 * le MJ peut offrir la réussite assortie d'une complication qu'il décrit lui-même ; le joueur accepte ou refuse. Rien n'est décidé ici :
 * le calcul de ce qui peut être offert, sans Foundry.
 *
 * Règles retenues :
 *  - un échec de 1 à `margin` (2) sous le seuil, seuil connu (CA, DD) ;
 *  - une attaque sur un 1 naturel (échec automatique) ou contre un abri total n'est jamais proposée ; un coup obtenu à un prix n'est
 *    jamais critique ;
 *  - un jet sans seuil connu ne peut pas « rater de 1 ou 2 » : rien.
 */

/** L'écart maximal de l'aide (« de 1 ou 2 »). */
export const AT_COST_MARGIN = 2;

/** Les durées bornées de la pause (secondes) : 0 = pas de pause, seulement les boutons des cartes. */
export const AT_COST_HOLD = Object.freeze({ min: 0, max: 30, byDefault: 5 });

/**
 * De combien le jet rate son seuil, quand c'est de 1 à `margin` ; 0 sinon (réussi, raté de plus, seuil inconnu).
 * @param {number} total
 * @param {number|null} needed
 * @param {number} [margin]
 */
export function nearMiss(total, needed, margin=AT_COST_MARGIN) {
  if ( !Number.isFinite(total) || !Number.isFinite(needed) || !(margin > 0) ) return 0;
  const by = needed - total;
  return ((by >= 1) && (by <= margin)) ? by : 0;
}

/**
 * Les cibles d'une attaque jugée qu'un succès à un prix ferait toucher : ratées sur le total (pas un 1 naturel, pas un abri total, pas
 * une réaction qui change le coup en échec sans autre jet), de 1 à `margin`, et affectées.
 * @param {{total: number}} roll
 * @param {Array<{token: string, hit: boolean|null, reason: string|null, ac: number|null, unaffected?: any}>} targets
 * @param {number} margin  0 : l'aide est éteinte pour ce jet.
 * @returns {Array<{token: string, by: number}>}
 */
export function nearMissTargets(roll, targets, margin) {
  if ( !(margin > 0) || !roll ) return [];
  return (targets ?? [])
    .filter(t => (t.hit === false) && (t.reason === "miss") && !t.unaffected)
    .map(t => ({ token: t.token, by: nearMiss(roll.total, t.ac, margin) }))
    .filter(t => t.by > 0);
}

/**
 * L'écart de l'aide pour un jet de cette créature : 0 si l'aide est éteinte ou si la créature n'est pas un personnage joueur — la
 * règle vise les joueurs (le MJ propose, le joueur choisit ; pour un PNJ, le MJ décide seul : décision de l'utilisateur, 2026-11-06).
 * `npc` reste ici pour une table qui le voudrait un jour ; aucun réglage ne le donne.
 * @param {{enabled: boolean, npc: boolean, isCharacter: boolean}} facts
 */
export function atCostMarginFor({ enabled, npc=false, isCharacter=false }) {
  if ( !enabled ) return 0;
  return (isCharacter || npc) ? AT_COST_MARGIN : 0;
}

/** La durée de la pause, bornée ; une valeur illisible prend celle par défaut. */
export function holdSeconds(value) {
  const n = Number(value);
  if ( !Number.isFinite(n) ) return AT_COST_HOLD.byDefault;
  return Math.min(AT_COST_HOLD.max, Math.max(AT_COST_HOLD.min, Math.round(n)));
}

/** Le texte du prix, nettoyé : une ligne, 300 caractères au plus. Vide : null (le prix reste à dire à voix haute). */
export function cleanCost(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : null;
}

/**
 * Un jet de groupe (§242) ou un jet natif à DD : la ligne peut-elle passer en réussite à un prix ? Lancée (total connu), pas encore
 * changée, et ratée de 1 à `margin`.
 * @param {{total: number|null, dc: number|null, atCost?: any}} row
 */
export function rowAtCost({ total, dc, atCost=null }, margin=AT_COST_MARGIN) {
  if ( atCost ) return 0;
  return nearMiss(total, dc, margin);
}
