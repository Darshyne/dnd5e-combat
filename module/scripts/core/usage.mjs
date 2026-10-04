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

/**
 * §77 : les consommations d'une activité qui dépensent ses PROPRES utilisations (`activityUses` sans cible) alors qu'elle n'en a pas,
 * quand l'item, lui, en porte (Monster Manual 2024 : « Nuage fétide (1/jour) » du Dretch — la charge est sur l'item) : à lire comme
 * les utilisations de l'item. Les index de ces consommations.
 * @param {Array<{type: string, target?: string}>} targets  Les consommations de l'activité.
 * @param {boolean} activityHasUses  L'activité a-t-elle un maximum d'utilisations ?
 * @param {boolean} itemHasUses  L'item a-t-il un maximum d'utilisations ?
 * @returns {number[]}
 */
export function misplacedSelfUses(targets, activityHasUses, itemHasUses) {
  if ( activityHasUses || !itemHasUses ) return [];
  return (targets ?? []).flatMap((t, i) => ((t?.type === "activityUses") && !t.target) ? [i] : []);
}
