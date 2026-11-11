/**
 * §410 (issue #44, lot 3) : ce qui manque pour utiliser une activité — emplacement de sort, utilisations, quantité. Pur : aucune
 * dépendance à Foundry. Le moteur le dit dans la fenêtre de légalité (forçable : forcer = ne pas dépenser ce qui manque).
 */

/**
 * Reste-t-il un emplacement pour lancer à ce niveau ? `slotKey` : l'emplacement demandé (« spell3 », « pact ») ; sans lui, n'importe quel
 * emplacement de ce niveau ou plus haut, pacte compris (ce que proposerait la fenêtre de dnd5e).
 * @param {Record<string, {value?: number, max?: number, level?: number}>} spells  `actor.system.spells`.
 * @param {number} level
 * @param {string|null} [slotKey]
 */
export function slotLeft(spells, level, slotKey=null) {
  if ( !spells ) return false;
  if ( slotKey ) return (Number(spells[slotKey]?.value) || 0) > 0;
  for ( let n = Math.max(1, Number(level) || 1); n <= 9; n++ ) if ( (Number(spells[`spell${n}`]?.value) || 0) > 0 ) return true;
  const pact = spells.pact;
  return !!pact && ((Number(pact.value) || 0) > 0) && ((Number(pact.level) || 0) >= (Number(level) || 1));
}

/**
 * Le coût d'une consommation, s'il se lit sans jet : un entier ; une formule (« 1d4 ») compte pour 1 (on ne refuse pas d'avance ce qu'un
 * jet pourrait permettre).
 */
export function plainCost(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Les raisons « ressource » d'une utilisation, dans l'ordre : `noSlot`, `noUses`, `noQuantity`, `unprepared`.
 * @param {object} use
 * @param {boolean} [use.slotMissing]    Un emplacement à dépenser (lancement ou consommation) manque.
 * @param {boolean} [use.usesShort]      Des utilisations à dépenser manquent.
 * @param {boolean} [use.quantityShort]  Une quantité à dépenser manque, ou l'objet utilisé est épuisé.
 * @param {boolean} [use.unprepared]     Un sort à préparer, pas préparé.
 * @returns {string[]}
 */
export function resourceIssues({ slotMissing=false, usesShort=false, quantityShort=false, unprepared=false }) {
  return [slotMissing && "noSlot", usesShort && "noUses", quantityShort && "noQuantity", unprepared && "unprepared"].filter(Boolean);
}

/** Une consommation qui manque : coût positif, plus que ce qui reste. */
export const isShort = t => (t.cost > 0) && (t.available < t.cost);
