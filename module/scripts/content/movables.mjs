/**
 * Zones déplaçables (SPEC §16.14, clé `movable` de core/content.mjs) : relancer le sort quand sa zone est là la déplace.
 * Le coût est l'activation de l'activité du sort (Rayon de lune : action → l'action Magie de la règle 2024).
 * Texte vérifié dans packs/_source/spells24 de dnd5e 6.0.3 et l'extraction du PHB 2.2.0.
 */

export const MOVABLES = Object.freeze({
  // « Vous pouvez effectuer une action Magie lors de vos tours suivants pour déplacer le Cylindre de 18 m au maximum. »
  "moonbeam": { distance: 60, units: "ft" }
});
