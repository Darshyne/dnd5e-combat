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
  rhwCSDivineRea8I: "divine-reaper",
  // §93 : Dons sombres.
  rhwAberrantAnato: "aberrant-anatomy",
  rhwEchoingSoulGK: "echoing-soul",
  rhwLivingShadow2: "living-shadow",
  rhwSymbioticBein: "symbiotic-being",
  rhwWatchersGH8OL: "watchers",
  rhwGatheredWhisp: "gathered-whispers",
  // §94 : dons et traits d'espèce.
  rhwSurvivor2zrM3: "survivor-ravenloft",
  rhwMistWalkerlge: "mist-walker",
  rhwSharpEyev8PBf: "sharp-eye-ravenloft",
  rhwKnowledgefraL: "knowledge-from-a-past-life",
  rhwHowlA3f2I58L3: "lupin-howl",
  rhwFeralPounce7E: "feral-pounce",
  // §95 : sous-classes — Patron Mort-vivant, Fantôme, Sorcellerie de l'ombre, Gardien creux.
  rhwUPFormofDreOJ: "form-of-dread",
  rhwUPNecroticHYI: "necrotic-husk",
  rhwPRWailsfromLz: "wails-from-the-grave",
  rhwPRGhostWalkKY: "ghost-walk",
  rhwSSPowerofShNG: "power-of-shadow",
  rhwSSShadowWalqT: "shadow-walk",
  rhwHWWrathofth3C: "wrath-of-the-wild",
  rhwHWAncientMibA: "ancient-might",
  // §96 : Collège des esprits.
  rhwCSAvengerSpv2: "avenger-spirit",
  rhwCSBruteSpir1q: "brute-spirit",
  rhwCSCowardSpi34: "coward-spirit",
  rhwCSFortuneTeZz: "fortune-teller-spirit",
  rhwCSPriestSpi36: "priest-spirit",
  rhwCSShadeSpirvt: "shade-spirit",
  rhwCSEmpoweredtO: "empowered-channeling",
  // §88 : la Parade du Maître de guerre (Manuel des joueurs) porte l'identifiant « parry » de la Parade du Monster Manual (§74), dont la
  // règle diffère (CA + maîtrise contre réduction des dégâts) : reconnue par sa source.
  phbmnvParry00000: "parry-maneuver"
});
