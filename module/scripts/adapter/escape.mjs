/**
 * Se libérer par un test (SPEC §16.54) : les effets d'Entravé d'un acteur dont l'item d'origine écrit le test d'évasion
 * dans son texte (core/escape.mjs). Le DD se calcule sur la créature qui a posé l'entrave (`@attributes.spell.dc` du
 * lanceur, `@abilities.str.dc` ou `@skills.ath.passive` du monstre), par `simplifyBonus` de dnd5e comme les auras.
 */

import { parseEscapeCheck, escapableStatuses } from "../core/escape.mjs";
import { originItemOf } from "./facts.mjs";
import { englishDescription } from "./multiattack.mjs";

/** Le test d'évasion qu'écrit un item, ou null. */
export function escapeCheckOf(item) {
  if ( !item ) return null;
  const known = { abilities: Object.keys(CONFIG.DND5E?.abilities ?? {}), skills: Object.keys(CONFIG.DND5E?.skills ?? {}) };
  return parseEscapeCheck(englishDescription(item), known) ?? parseEscapeCheck(item.system?.description?.value, known);
}

/** L'item pose-t-il Entravé (un de ses effets) ? Pour la pastille : un test d'évasion écrit ne vaut que là. */
export const restrainsWith = item => (item?.effects ?? []).some(e => escapableStatuses(Array.from(e.statuses ?? [])));

/** Le DD d'un test d'évasion, évalué sur l'acteur qui porte l'item d'origine. null si illisible. */
export function dcOf(check, item) {
  const n = Number(check.dc);
  if ( Number.isFinite(n) ) return n;
  const data = item.actor?.getRollData?.() ?? {};
  const value = Number(dnd5e.utils.simplifyBonus(check.dc, data));
  return (Number.isFinite(value) && (value > 0)) ? value : null;
}

/**
 * Les entraves dont l'acteur peut se libérer par un test.
 * @returns {Array<{effect: ActiveEffect, item: Item5e, ability: string|null, skill: string|null, dc: number}>}
 */
export function escapableRestraintsOf(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || !escapableStatuses(Array.from(effect.statuses ?? [])) ) continue;
    const item = originItemOf(effect);
    const check = escapeCheckOf(item);
    const dc = check ? dcOf(check, item) : null;
    if ( dc !== null ) out.push({ effect, item, ability: check.ability, skill: check.skill, dc });
  }
  return out;
}
