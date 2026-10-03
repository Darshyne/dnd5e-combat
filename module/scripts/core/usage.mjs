/**
 * §68 : l'utilisation sans fenêtre — quel emplacement de sort prendre quand celui que dnd5e propose est vide.
 * Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * L'emplacement à dépenser : celui que dnd5e propose s'il en reste, sinon le plus bas qui en a encore, d'un niveau au moins égal
 * à celui du sort (emplacements de pacte compris, à leur niveau ; à niveau égal, l'emplacement ordinaire d'abord). null : plus aucun.
 * @param {Record<string, {value: number, level: number}>} slots  Les emplacements de l'acteur (`system.spells`, clés `spell1`… `pact`).
 * @param {string} proposed  La clé proposée par dnd5e (`usageConfig.spell.slot`).
 * @param {number} spellLevel  Le niveau du sort.
 * @returns {string|null}
 */
export function pickSpellSlot(slots, proposed, spellLevel) {
  const has = key => (Number(slots?.[key]?.value) || 0) > 0;
  if ( has(proposed) ) return proposed;
  const candidates = Object.entries(slots ?? {})
    .filter(([key, slot]) => /^(spell\d+|pact)$/.test(key) && has(key) && ((Number(slot.level) || 0) >= spellLevel))
    .sort(([ka, a], [kb, b]) => ((Number(a.level) || 0) - (Number(b.level) || 0)) || (Number(ka === "pact") - Number(kb === "pact")));
  return candidates[0]?.[0] ?? null;
}
