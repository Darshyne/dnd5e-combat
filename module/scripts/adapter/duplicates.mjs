/**
 * Répliques (SPEC §16.25, clé `duplicates` de core/content.mjs) : Image miroir. Chaque effet de l'item que porte la créature
 * est une réplique (dnd5e 6 en pose trois, « Duplicate A/B/C », qui comptent aussi `flags.dnd-players-handbook.mirrorImages`).
 * Texte vérifié (spells24, mirror-image.yml) : à chaque attaque qui touche le lanceur, un d6 par réplique ; un 3 ou plus sur
 * l'un d'eux fait détourner le coup sur une réplique, qui disparaît. Un attaquant Aveuglé, ou qui a la vision aveugle ou la
 * vision véritable, n'est pas trompé.
 */

import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** Les effets-répliques que porte l'acteur, un par réplique restante. */
export function duplicateEffectsOf(actor) {
  return (actor?.appliedEffects ?? []).filter(effect => {
    if ( effect.disabled || effect.isSuppressed ) return false;
    const item = originItemOf(effect);
    return !!item && (contentOf(item).entry?.duplicates === true);
  });
}

/** L'attaquant se laisse-t-il tromper par les répliques ? (dnd5e senses-field.mjs:15 : `senses.ranges`) */
export function fooledByDuplicates(attacker) {
  if ( !attacker ) return true;
  if ( attacker.statuses?.has("blinded") ) return false;
  const ranges = attacker.system?.attributes?.senses?.ranges ?? {};
  return !((Number(ranges.blindsight) > 0) || (Number(ranges.truesight) > 0));
}

/** Combien de répliques peuvent prendre ce coup à la place de la cible (0 : aucune, ou attaquant insensible). */
export function duplicatesAgainst(targetActor, attackerActor) {
  const count = duplicateEffectsOf(targetActor).length;
  return (count && fooledByDuplicates(attackerActor)) ? count : 0;
}
