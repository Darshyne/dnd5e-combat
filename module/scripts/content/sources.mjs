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
  // O1 (§335) : les quatre anneaux de maîtrise élémentaire du Guide partagent l'identifiant « ring-of-elemental-command » ; leurs défauts
  // de donnée diffèrent (content/item-fixes.mjs). La Morsure de Harkon (Ravenloft) n'a pas d'identifiant.
  dmgAirRingOfElem: "ring-of-elemental-command-air",
  dmgEarthRingOfEl: "ring-of-elemental-command-earth",
  dmgFireRingOfEle: "ring-of-elemental-command-fire",
  dmgWaterRingOfEl: "ring-of-elemental-command-water",
  rhwHarkonsBite2Q: "harkons-bite",
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

/**
 * O5b (SPEC §340) : les effets d'enchantement des armes et armures magiques du Guide du maître 2024, par id → l'identifiant de l'objet
 * qui les pose. Une arme enchantée garde son propre identifiant (« longsword ») ; l'enchantement appliqué garde l'id de son effet
 * d'origine (dnd5e, activity/enchant.mjs : `effect.clone(…).toObject()` créé avec `keepId`), même quand l'objet qui l'a posé n'est plus
 * sur la fiche. Relevé dans le pack `equipment` du Guide (2.0.0) ; les enchantements « Enspelled » (ids partagés) n'y sont pas.
 */
export const ENCHANTMENT_SOURCES = Object.freeze({
  rkijTbDVcBViZ8hs: "demon-armor",
  GTBlnwp18lMmlhNY: "dragon-scale-mail", oAMZPSz9ScJ9kzJS: "dragon-scale-mail", YnovzwTfQAEO8okl: "dragon-scale-mail", SXYzllaQnbyxFGJu: "dragon-scale-mail", "7R5dtsUNiWZhXhS3": "dragon-scale-mail", kwIXULk6aDknIZnv: "dragon-scale-mail", "4MsmIVyXTFt4AKuD": "dragon-scale-mail", WnwsmlBDChjhXgAj: "dragon-scale-mail", wVh8ceMKvVud2qyr: "dragon-scale-mail", QzV7iJWMlEePDrjN: "dragon-scale-mail",
  ZveR6kPKafjcwQdY: "dragon-slayer",
  F6NbXlYCpjhBGFRp: "executioners-axe",
  LdDrwdlNhF9ZxLJB: "moon-touched-sword", oZBFpi117yOXca3k: "helm-of-brilliance",
  VtBOwsAVipxkP2f5: "flame-tongue", MHnAqxEXBhUbnjPq: "flame-tongue",
  KDZFGFsxEOF5WvbJ: "frost-brand",
  ZwpawARncDIheC65: "giant-slayer",
  I7Iwl7awPq2wftoF: "holy-avenger",
  "3hRQ0o8Q1nmj5WwB": "luck-blade",
  L4ylYIFxr0vdht6M: "oathbow", J4bEaPvFwAGKSrPm: "berserker-axe",
  nxid1s2CZrB06HH8: "sword-of-sharpness",
  tuFnPbghL64ioL04: "sword-of-wounding",
  CzJMRNHYWlVNvnJN: "vicious-weapon",
  mxrAgEyDsV2h5jla: "vorpal-sword",
});
