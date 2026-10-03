/**
 * Réserves qui absorbent les dégâts (SPEC §16.11, clé `absorb` de core/content.mjs), par identifiant dnd5e.
 * Identifiants vérifiés dans l'extraction du PHB 2.2.0 (work/phb-en).
 */

export const ABSORBS = Object.freeze({
  // Égide arcanique (magicien abjurateur, PHB classes, phbwzdArcaneWard) : PV = utilisations de l'item ; créée par
  // l'activité Hha69hPMTYWhDE4A (une fois par repos long) ; un sort d'abjuration lancé avec un emplacement lui rend deux
  // fois le niveau de cet emplacement.
  "arcane-ward": { activeAfter: "Hha69hPMTYWhDE4A", recharge: { school: "abj", perLevel: 2 } }
});
