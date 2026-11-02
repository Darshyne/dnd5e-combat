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
  // K6 (§327) : capacités du Monster Manual et de Ravenloft dont l'identifiant est celui d'une règle du PHB — la Riposte du Capitaine
  // pirate n'est pas la manœuvre du Maître de guerre, la Protection du Gardien bouclier pas le style de combat, le Présage du Cyclope
  // oracle pas celui du Devin, l'Échappatoire brumeuse du Vampire pas l'invocation de l'Occultiste, la Toile de l'Araignée géante pas le
  // sort, le Ralliement de l'Amiral pirate pas l'aptitude du Chevalier occulte. Un identifiant propre : seule la couche texte s'y applique.
  mmRiposte0000000: "mm-riposte",
  mmProtection0000: "mm-protection",
  mmPortent0000000: "mm-portent",
  mmMistyEscape000: "mm-misty-escape",
  E2ZOsODrA6ydRBro: "mm-misty-escape",
  mmWeb00000000000: "mm-web",
  Z40sOvc1VYKqWqA6: "mm-rally",
  // §334 : défauts de donnée propres à une créature — clé « acteur.item » de la source de compendium (l'id d'item est partagé).
  "mmHomunculus0000.mmBite0000000000": "mm-homunculus-bite",
  "mmPseudodragon00.mmSting000000000": "mm-pseudodragon-sting",
  "mmWereboar000000.mmGore0000000000": "mm-wereboar-gore",
  "mmWight000000000.mmLifeDrain00000": "mm-wight-life-drain",
  "mmBeholder000000.mmEyeRays0000000": "mm-beholder-eye-rays",
  "mmDeathTyrant000.mmEyeRays0000000": "mm-beholder-eye-rays",
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
  rhwSecondSkinkc1: "second-skin",
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
  phbmnvParry00000: "parry-maneuver",
  // §295 (repasse) : le Maléfice du protecteur Grand Ancien (pack de classes, identifiant « great-old-one-hex ») est le sort Maléfice —
  // mêmes activités, mêmes six effets (avec le Désavantage aux sauvegardes de Maléfice occulte) : reconnu comme « hex » (1d6, choix d'un
  // effet, Délivrance des malédictions). La copie d'Assassinat de Heroes of the Borderlands porte l'identifiant « assasinate » sous le
  // même id que celle du Manuel.
  n2qsI3p9HBVQIjeK: "hex",
  phbrgeAssasinate: "assassinate",
  // §298 : l'Attaque supplémentaire du Collège de la vaillance porte l'identifiant commun « extra-attack » ; elle permet en plus un tour
  // de magie à la place d'une attaque. Reconnue à part (adapter/turn.mjs lui garde ses deux attaques).
  phbbrdExtraAttac: "valor-extra-attack",
  // §305 : le Compagnon réanimé de Ravenloft (sans identifiant propre).
  rhwRECompanionqV: "reanimated-companion"
});
