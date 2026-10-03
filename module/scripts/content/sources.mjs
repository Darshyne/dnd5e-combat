/**
 * Identifiants des items de modules premium qui n'en portent pas (`system.identifier` vide) : dnd5e retombe alors sur le
 * nom (documents/mixins/document.mjs:33, `formatIdentifier(this.name)`), que Babele traduit — « morsure-vampirique » en
 * français, « vampiric-bite » en anglais. Le moteur les reconnaît par leur source de compendium (`_stats.compendiumSource`,
 * que l'avancement de dnd5e garde : documents/advancement/item-grant.mjs:182) ou par leur id, s'ils ont été importés tels
 * quels. Clé : l'id du document dans le compendium (16 caractères) ; valeur : l'identifiant anglais, en kebab-case.
 *
 * Vérifié dans le module premium `dnd-ravenloft-horrors-within` 1.0.1 (pack `options`, extrait dans
 * `Foundry dnd5 module trad Ravenloft/work/rhw-en/options`).
 */

export const SOURCE_IDENTIFIERS = Object.freeze({
  // Espèce Dhampir (Ravenloft: The Horrors Within).
  rhwVampiricBitnE: "vampiric-bite",
  rhwSpiderClimb7F: "spider-climb",
  // Domaine de la Tombe (clerc).
  rhwCSCircleofMOG: "circle-of-mortality",
  rhwCSPathtotheCb: "path-to-the-grave",
  rhwCSSentinelaOa: "sentinel-at-deaths-door",
  rhwCSDivineRea8I: "divine-reaper"
});
