/**
 * Lot 1 des chantiers du 2026-10-30 : échec d'un sort lancé sous un effet qui le gêne (Lenteur, PHB 2024 — « si elle lance un sort
 * avec une composante somatique, il y a 25 % de chances que le sort échoue »). Pur : les règles se lisent dans le contenu des items
 * d'origine des effets du lanceur (`spellFailure`), le jet se fait ailleurs.
 */

/** Les composantes qu'une règle peut nommer (propriétés dnd5e d'un sort). */
export const SPELL_COMPONENTS = Object.freeze(["vocal", "somatic", "material"]);

/**
 * La règle d'échec qui s'applique à un sort, ou null. `rules` : les `spellFailure` des effets du lanceur, avec le nom de l'item qui
 * les porte (`{ chance, component?, name }`) ; `properties` : les propriétés du sort lancé. La plus forte chance l'emporte (deux
 * Lenteurs ne se cumulent pas).
 */
export function failureFor(rules, properties) {
  const has = new Set(properties ?? []);
  let best = null;
  for ( const rule of rules ?? [] ) {
    const chance = Number(rule?.chance);
    if ( !(chance > 0) ) continue;
    if ( rule.component && !has.has(rule.component) ) continue;
    if ( !best || (chance > best.chance) ) best = { ...rule, chance };
  }
  return best;
}

/** Le sort échoue-t-il sur ce jet de d100 ? (« 25 % de chances » : 1 à 25.) */
export function spellFailed(chance, d100) {
  return Number.isFinite(d100) && (d100 <= chance);
}
