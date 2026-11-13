# Contenu par identifiant

> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.

868 identifiants dnd5e ont une entrée dans le contenu livré (`content/`, schéma `core/content.mjs`). Cette page
répond à « quels items utilisent telle clé » ; ce qu'une clé veut dire est dans le schéma (`core/content/entry.mjs`). Pour un item
précis en jeu : `api.content.of(item)`, `api.content.inspect(actor)`.

## Clés d'une entrée

| Clé | Entrées | Exemples |
|---|---|---|
| `absorb` | 1 | `arcane-ward` |
| `actionEnds` | 19 | `black-tentacles`, `earthquake`, `ensnaring-strike`, `essence-of-ether`, `evards-black-tentacles`, `eyebite`, … |
| `actionOrBonus` | 5 | `abjure-foes`, `coward-spirit`, `fetid-cloud`, `mm-beholder-eye-rays`, `slow` |
| `advantageIfFighting` | 6 | `charm-monster`, `charm-person`, `dominate-beast`, `dominate-monster`, `dominate-person`, `modify-memory` |
| `afterSmite` | 1 | `smite-of-protection` |
| `afterSneak` | 1 | `wails-from-the-grave` |
| `afterTeleport` | 2 | `misty-escape`, `steps-of-the-fey` |
| `antimagicZone` | 2 | `antimagic-cone`, `antimagic-field` |
| `atTurnStart` | 3 | `aura-of-vitality`, `phantasmal-force`, `witch-bolt` |
| `atZero` | 3 | `ancient-might`, `necrotic-husk`, `power-of-shadow` |
| `aura` | 16 | `aura-of-alacrity`, `aura-of-authority`, `aura-of-bravery`, `aura-of-courage`, `aura-of-devotion`, `aura-of-life`, … |
| `avoidance` | 1 | `avoidance` |
| `backfire` | 1 | `horn-of-blasting` |
| `banishes` | 3 | `banishing-smite`, `banishment`, `maze` |
| `barrier` | 15 | `antilife-shell`, `scroll-of-protection-aberration-enchanted`, `scroll-of-protection-beast-enchanted`, `scroll-of-protection-celestial-enchanted`, `scroll-of-protection-construct-enchanted`, `scroll-of-protection-dragon-enchanted`, … |
| `basicActions` | 11 | `adrenaline-rush`, `boon-of-speed`, `conjure-woodland-beings`, `cunning-action`, `deathless-agility`, `evasive-footwork`, … |
| `blessedHealer` | 1 | `blessed-healer` |
| `blink` | 1 | `blink` |
| `blocksHealing` | 3 | `chill-touch`, `mm-beholder-eye-rays`, `pale-tincture` |
| `bolt` | 1 | `call-lightning` |
| `bonusAttack` | 1 | `great-weapon-master` |
| `breaksOn` | 12 | `boon-of-the-night-spirit`, `dust-of-disappearance`, `invisibility`, `mind-sliver`, `mislead`, `misty-escape`, … |
| `breaksOnOrigin` | 1 | `friends` |
| `brutalStrike` | 3 | `brutal-strike`, `improved-brutal-strike`, `improved-brutal-strike-2` |
| `burns` | 1 | `alchemists-fire` |
| `burst` | 3 | `heat-metal`, `ice-knife`, `jolt-to-life` |
| `byWounds` | 1 | `toll-the-dead` |
| `cantripRange` | 1 | `improved-elemental-fury` |
| `carriedLight` | 13 | `bullseye-lantern`, `candle`, `flame-tongue-enchanted`, `helm-of-brilliance-enchanted`, `hooded-lantern`, `lamp`, … |
| `castDuration` | 1 | `oil-of-slipperiness` |
| `casterPulse` | 6 | `cloudkill`, `delayed-blast-fireball`, `earthquake`, `incendiary-cloud`, `storm-of-vengeance`, `tsunami` |
| `castTargets` | 1 | `potion-of-animal-friendship` |
| `catalyst` | 1 | `second-skin` |
| `cellWall` | 2 | `blade-barrier`, `wall-of-thorns` |
| `chain` | 1 | `chain-lightning` |
| `checkPoses` | 1 | `maze` |
| `choice` | 22 | `beguiling-magic`, `bestow-curse`, `blindness-deafness`, `blur`, `calm-emotions`, `contagion`, … |
| `climbsOnTurn` | 1 | `acrobatic-movement` |
| `coats` | 1 | `poison-basic` |
| `combatInspiration` | 1 | `combat-inspiration` |
| `commandStrike` | 1 | `commanders-strike` |
| `compels` | 1 | `compulsion` |
| `concentrationBreaker` | 1 | `mage-slayer` |
| `confusion` | 1 | `confusion` |
| `counter` | 2 | `absorption-ioun-stone`, `greater-absorption-ioun-stone` |
| `coverThrough` | 3 | `blade-barrier`, `prismatic-wall`, `wind-wall` |
| `critFeeds` | 1 | `sword-of-life-stealing-enchanted` |
| `critMark` | 2 | `crusher`, `slasher` |
| `critMove` | 1 | `remarkable-athlete` |
| `cunningStrikeMax` | 1 | `improved-cunning-strike` |
| `cunningStrikes` | 3 | `cunning-strike`, `devious-strikes`, `supreme-sneak` |
| `cures` | 13 | `boon-of-speed`, `dispel-evil-and-good`, `greater-restoration`, `lay-on-hands`, `lesser-restoration`, `physicians-touch`, … |
| `curesAll` | 7 | `elixir-of-health`, `hand-of-ultimate-mercy`, `heal`, `keoghtoms-ointment`, `mass-heal`, `potion-of-vitality`, … |
| `curesOn` | 4 | `dispel-evil-and-good`, `lay-on-hands`, `physicians-touch`, `restoring-touch` |
| `damageShield` | 2 | `resistance`, `ring-of-warmth` |
| `dataFixes` | 63 | `antimatter-rifle`, `antitoxin`, `armor-of-vulnerability`, `awareness-ioun-stone`, `bead-of-force`, `belt-of-dwarvenkind`, … |
| `devours` | 1 | `blackrazor` |
| `difficultTerrain` | 16 | `black-tentacles`, `blade-barrier`, `conjure-minor-elementals`, `earthquake`, `entangle`, `evards-black-tentacles`, … |
| `discharge` | 1 | `path-to-the-grave` |
| `discipleOfLife` | 1 | `disciple-of-life` |
| `dispel` | 1 | `dispel-magic` |
| `drain` | 9 | `bite`, `draining-kiss`, `draining-swipe`, `energy-drain`, `fell-word`, `life-drain`, … |
| `drawsOnEnd` | 1 | `living-shadow` |
| `dropsEffects` | 2 | `draconic-strike`, `mm-beholder-eye-rays` |
| `duplicates` | 1 | `mirror-image` |
| `durationByLevel` | 1 | `bestow-curse` |
| `duringRage` | 4 | `mindless-rage`, `primal-knowledge`, `rage-of-the-wilds`, `vitality-of-the-tree` |
| `effectChanges` | 22 | `brutal-strike`, `caltrops`, `contagion`, `elemental-epitome`, `fool`, `gaseous-form`, … |
| `effectDurations` | 6 | `blessing-of-the-trickster`, `clairvoyant-combatant`, `dust-of-disappearance`, `intimidating-presence`, `scroll-of-protection`, `wand-of-paralysis` |
| `effectEnds` | 45 | `aberrant-anatomy`, `brutal-strike`, `celestial-revelation`, `chill-touch`, `defensive-duelist`, `devour-intellect`, … |
| `effectsExpire` | 2 | `blessing-of-the-trickster`, `prayer-of-healing` |
| `effectsFirst` | 1 | `aid` |
| `effectsIf` | 6 | `esoteric-ward`, `hammer-of-thunderbolts-enchanted`, `mm-wereboar-gore`, `psychic-skewer`, `silver-needle`, `umbral-dagger` |
| `effectStatuses` | 6 | `coward-spirit`, `death-curse`, `divine-word`, `mm-beholder-eye-rays`, `mm-pseudodragon-sting`, `poisoned-needle` |
| `effectThen` | 1 | `haste` |
| `effectWhile` | 10 | `aspect-of-the-wilds`, `boon-of-the-night-spirit`, `bracers-of-defense`, `defense`, `dueling`, `full-of-stars`, … |
| `elementalAdept` | 1 | `elemental-adept` |
| `elusive` | 1 | `elusive` |
| `emanation` | 16 | `avenging-angel`, `death-burst`, `death-throes`, `deathly-stench`, `fear-aura`, `fetid-aura`, … |
| `empower` | 1 | `vampiric-bite` |
| `enchantTarget` | 4 | `elemental-weapon`, `magic-weapon`, `pact-of-the-blade`, `true-strike` |
| `encloses` | 3 | `bead-of-force`, `otilukes-resilient-sphere`, `resilient-sphere` |
| `endActivity` | 1 | `shade-spirit` |
| `endsCurses` | 2 | `greater-restoration`, `remove-curse` |
| `endsOnUse` | 1 | `dispel-evil-and-good` |
| `endsOwnConditions` | 1 | `self-restoration` |
| `endsWhen` | 30 | `banishment`, `bestow-curse`, `channel-divinity`, `channel-divinity-cleric`, `compelled-duel`, `compulsion`, … |
| `endurance` | 1 | `relentless-endurance` |
| `enterOnPose` | 1 | `conjure-celestial` |
| `etherealShift` | 2 | `ethereal-jaunt`, `ethereal-stride` |
| `evasion` | 2 | `evasion`, `leading-evasion` |
| `exclusiveWeapon` | 3 | `berserker-axe-enchanted`, `oathbow-enchanted`, `sword-of-vengeance-enchanted` |
| `extraFirstTurn` | 1 | `thiefs-reflexes` |
| `fadesOnLongRest` | 2 | `raise-dead`, `resurrection` |
| `failMargins` | 2 | `lolths-sting`, `mm-homunculus-bite` |
| `flammable` | 2 | `oil`, `web` |
| `fleeOnFailedSave` | 1 | `dissonant-whispers` |
| `fleetStep` | 1 | `fleet-step` |
| `flurry` | 3 | `monks-focus`, `swift-quiver`, `war-priest` |
| `flurryStrikes` | 1 | `heightened-focus` |
| `forcedAttack` | 1 | `crown-of-madness` |
| `formLock` | 1 | `moonbeam` |
| `fortifiedHealing` | 1 | `boon-of-fortitude` |
| `fortitude` | 1 | `undead-fortitude` |
| `freeSomatic` | 1 | `war-caster` |
| `globe` | 2 | `antimagic-field`, `globe-of-invulnerability` |
| `gmAlert` | 50 | `abjure-foes`, `antilife-shell`, `antimagic-field`, `boon-of-fate`, `compulsion`, `conjure-elemental`, … |
| `grants` | 1 | `dragons-breath` |
| `grantsAction` | 1 | `action-surge` |
| `grantsConditionImmunities` | 2 | `natures-ward`, `ring-of-free-action` |
| `grantsResistances` | 1 | `avatar-of-battle` |
| `grantsSpeeds` | 5 | `athlete`, `cloak-of-arachnida`, `gloves-of-swimming-and-climbing`, `ring-of-elemental-command-air`, `slippers-of-spider-climbing` |
| `grappleDamage` | 1 | `unarmed-fighting` |
| `greatWeaponFighting` | 1 | `great-weapon-fighting` |
| `halfOnMiss` | 2 | `acid-arrow`, `melfs-acid-arrow` |
| `haltOnReaction` | 1 | `sentinel` |
| `hardToPerceive` | 1 | `cloak-of-elvenkind` |
| `healingRerolls` | 1 | `healer` |
| `healMax` | 1 | `beacon-of-hope` |
| `healPool` | 4 | `clockwork-cavalcade`, `inspiring-smite`, `mass-heal`, `preserve-life` |
| `healsDownedMax` | 1 | `circle-of-mortality` |
| `heroicWarrior` | 1 | `heroic-warrior` |
| `hitDefense` | 1 | `defensive-tactics` |
| `hitDiceHeal` | 1 | `arcane-vigor` |
| `hitRider` | 20 | `charger`, `crusher`, `disarming-attack`, `distracting-strike`, `eldritch-smite`, `feral-pounce`, … |
| `holdsStill` | 1 | `steady-aim` |
| `hpTiers` | 3 | `divine-word`, `power-word-kill`, `power-word-stun` |
| `ignoresResistance` | 2 | `boon-of-irresistible-offense`, `poisoner` |
| `includesOrigin` | 3 | `bag-of-beans`, `dust-of-disappearance`, `dust-of-sneezing-and-choking` |
| `initiativeSwap` | 1 | `alert` |
| `interposeShield` | 1 | `shield-master` |
| `jump` | 5 | `athlete`, `boots-of-striding-and-springing`, `jump`, `monks-focus`, `second-story-work` |
| `keepsConcentration` | 1 | `relentless-hunter` |
| `keepsProne` | 2 | `hideous-laughter`, `tashas-hideous-laughter` |
| `keepsSpeed` | 1 | `freedom-of-movement` |
| `killsAtZero` | 1 | `disintegrate` |
| `kindles` | 1 | `tinderbox` |
| `knownToOrigin` | 1 | `mind-spike` |
| `lastStandHeal` | 1 | `boon-of-recovery` |
| `leap` | 1 | `chromatic-orb` |
| `leash` | 1 | `compelled-duel` |
| `levitate` | 1 | `levitate` |
| `lifesteal` | 1 | `vampiric-touch` |
| `light` | 14 | `continual-flame`, `darkness`, `daylight`, `faerie-fire`, `fire-shield`, `flame-blade`, … |
| `limitedAction` | 1 | `haste` |
| `magical` | 20 | `animate-trees`, `captains-charm`, `darkness-aura`, `deathly-teleport`, `ethereal-jaunt`, `ethereal-stride`, … |
| `magicEvasion` | 1 | `circle-of-power` |
| `martialArts` | 1 | `martial-arts` |
| `maxSpellDamageVs` | 1 | `demonomicon-of-iggwilv` |
| `metamagic` | 6 | `careful-spell`, `distant-spell`, `heightened-spell`, `quickened-spell`, `subtle-spell`, `twinned-spell` |
| `minRange` | 2 | `mangonel`, `trebuchet` |
| `movable` | 3 | `cloud-of-daggers`, `conjure-celestial`, `moonbeam` |
| `movesAfter` | 2 | `instinctive-pounce`, `tactical-shift` |
| `noActions` | 1 | `stinking-cloud` |
| `noAttacksOrSpells` | 1 | `gaseous-form` |
| `noBonus` | 2 | `confusion`, `ice-spear` |
| `noDamage` | 10 | `avenger-spirit`, `bestow-curse`, `commanders-strike`, `ensnaring-strike`, `feinting-attack`, `geas`, … |
| `noOpportunity` | 18 | `agile`, `blazing-movement`, `bubble-dash`, `charging-horn`, `engulf`, `entangling-trail`, … |
| `noOpportunityAttacks` | 4 | `brutal-strike`, `improved-brutal-strike`, `open-hand-technique`, `shocking-grasp` |
| `noRangedWeapons` | 1 | `storm-of-vengeance` |
| `noReactions` | 5 | `arms-of-hadar`, `confusion`, `fetid-cloud`, `mm-beholder-eye-rays`, `slow` |
| `noSpells` | 1 | `befuddlement` |
| `notOnSlippery` | 1 | `slippers-of-spider-climbing` |
| `obscures` | 9 | `cloudkill`, `eversmoking-bottle`, `fog-cloud`, `grenade-smoke`, `incendiary-cloud`, `sleet-storm`, … |
| `oneAttack` | 1 | `true-strike` |
| `onFell` | 1 | `dark-ones-blessing` |
| `onHit` | 1 | `dagger-of-venom` |
| `onNatural1` | 6 | `aberrant-anatomy`, `echoing-soul`, `gathered-whispers`, `living-shadow`, `symbiotic-being`, `watchers` |
| `openHand` | 1 | `open-hand-technique` |
| `opportunityDisadvantage` | 2 | `boots-of-speed`, `speedy` |
| `orders` | 1 | `command` |
| `overwhelmingStrike` | 1 | `boon-of-irresistible-offense` |
| `pact` | 1 | `pact-of-the-blade` |
| `panic` | 2 | `eyebite`, `fear` |
| `peerlessAim` | 1 | `boon-of-combat-prowess` |
| `pendingDie` | 2 | `feinting-attack`, `lunging-attack` |
| `persistentRage` | 1 | `persistent-rage` |
| `pickTargets` | 12 | `aura-of-vitality`, `beacon-of-hope`, `channel-divinity`, `channel-divinity-cleric`, `clockwork-cavalcade`, `inspiring-smite`, … |
| `piercer` | 1 | `piercer` |
| `placesSummons` | 6 | `animate-dead`, `conjure-animals`, `grasping-vine`, `phantom-steed`, `project-image`, `summon-undead` |
| `pointWall` | 5 | `arcane-gate`, `demiplane`, `gate`, `magnificent-mansion`, `mordenkainens-magnificent-mansion` |
| `portent` | 2 | `greater-portent`, `portent` |
| `potentCantrip` | 1 | `potent-cantrip` |
| `potionEffect` | 2 | `potion-of-diminution`, `potion-of-growth` |
| `prismatic` | 2 | `prismatic-spray`, `prismatic-wall` |
| `projectiles` | 4 | `eldritch-blast`, `magic-missile`, `scorching-ray`, `steel-wind-strike` |
| `quickSearch` | 1 | `observant` |
| `quickStand` | 1 | `athlete` |
| `quietPose` | 2 | `sleet-storm`, `stinking-cloud` |
| `rage` | 1 | `rage` |
| `rangedDefense` | 2 | `arrow-catching-shield`, `shield-of-missile-attraction` |
| `rangedFeat` | 4 | `crossbow-expert`, `improved-illusions`, `sharpshooter`, `spell-sniper` |
| `ranges` | 19 | `bastion-of-law`, `dragons-breath`, `dynamite-stick`, `elder-champion`, `hand-of-healing`, `hand-of-ultimate-mercy`, … |
| `reactions` | 1 | `reactive` |
| `reactiveSpell` | 1 | `war-caster` |
| `reactiveStrike` | 1 | `polearm-master` |
| `recast` | 6 | `alter-self`, `call-lightning`, `expeditious-retreat`, `swift-quiver`, `telekinesis`, `vampiric-touch` |
| `recastCost` | 1 | `swift-quiver` |
| `reckless` | 1 | `reckless-attack` |
| `regainOnInitiative` | 4 | `boon-of-fate`, `perfect-focus`, `persistent-rage`, `superior-inspiration` |
| `regainOnShortRest` | 2 | `font-of-inspiration`, `improved-warding-flare` |
| `regeneration` | 1 | `regeneration` |
| `relentless` | 1 | `relentless-rage` |
| `replacesAttack` | 7 | `acid`, `alchemists-fire`, `breath-weapon`, `commanders-strike`, `holy-water`, `net`, … |
| `rerollInitiative` | 1 | `survivor-ravenloft` |
| `resize` | 2 | `enlarge-reduce`, `large-form` |
| `retort` | 1 | `beguiling-defenses` |
| `revealsInvisible` | 2 | `faerie-fire`, `starry-wisp` |
| `revivesFull` | 2 | `resurrection`, `true-resurrection` |
| `ritualAdept` | 1 | `ritual-adept` |
| `rollBonus` | 18 | `ambush`, `boon-of-fate`, `commanding-presence`, `countercharm`, `dark-ones-own-luck`, `disciplined-survivor`, … |
| `rolledAc` | 2 | `bait-and-switch`, `evasive-footwork` |
| `savageAttacker` | 2 | `savage-attacker`, `soldier-feature` |
| `saveAdvantage` | 20 | `aura-of-purity`, `beguiling-twist`, `belt-of-dwarvenkind`, `brave`, `circle-of-power`, `dwarven-resilience`, … |
| `saveAdvantageFrom` | 1 | `protection-from-evil-and-good` |
| `saveAdvantageSize` | 1 | `ensnaring-strike` |
| `saveAutoSuccess` | 3 | `enthrall`, `flesh-to-stone`, `friends` |
| `saveDamage` | 7 | `black-tentacles`, `contact-other-plane`, `evards-black-tentacles`, `holy-water`, `misty-escape`, `pale-tincture`, … |
| `savedEffects` | 6 | `flesh-to-stone`, `heat-metal`, `mace-of-disruption`, `ottos-irresistible-dance`, `ray-of-enfeeblement`, `stunning-strike` |
| `saveDisadvantageFor` | 3 | `shatter`, `talisman-of-pure-good`, `talisman-of-ultimate-evil` |
| `scatter` | 2 | `ball-bearings`, `caltrops` |
| `scoreFloor` | 1 | `indomitable-might` |
| `sculptSpells` | 1 | `sculpt-spells` |
| `searchBonus` | 2 | `sharp-eye-ravenloft`, `watchers` |
| `seesInvisible` | 1 | `see-invisibility` |
| `selfZone` | 4 | `conjure-minor-elementals`, `conjure-woodland-beings`, `forbiddance`, `yolandes-regal-presence` |
| `sharesSpace` | 7 | `air-form`, `fire-form`, `gaseous-form`, `misty-form`, `swarm`, `water-form`, … |
| `silences` | 1 | `silence` |
| `singleAttack` | 1 | `slow` |
| `slippery` | 2 | `grease`, `oil` |
| `slotRecovery` | 1 | `arcane-recovery` |
| `smite` | 11 | `banishing-smite`, `blinding-smite`, `divine-smite`, `ensnaring-strike`, `hail-of-thorns`, `lightning-arrow`, … |
| `sneakAttack` | 1 | `sneak-attack` |
| `sneakBonus` | 1 | `assassinate` |
| `sniper` | 1 | `skulker` |
| `spellDamageTypes` | 1 | `psychic-spells` |
| `spellFailure` | 1 | `slow` |
| `spellRecall` | 1 | `boon-of-spell-recall` |
| `spellsInAttack` | 3 | `improved-war-magic`, `valor-extra-attack`, `war-magic` |
| `stabilizes` | 1 | `healers-kit` |
| `stableAtZero` | 1 | `umbral-dagger` |
| `standsWithReaction` | 1 | `power-word-heal` |
| `storm` | 1 | `call-lightning` |
| `studiedAttacks` | 1 | `studied-attacks` |
| `stunningStrike` | 1 | `stunning-strike` |
| `summon` | 64 | `animate-dead`, `animate-objects`, `arcane-eye`, `arcane-hand`, `arcane-sword`, `baba-yagas-dancing-broom`, … |
| `summonEffectsOnCaster` | 1 | `mislead` |
| `supremeHealing` | 1 | `supreme-healing` |
| `swallow` | 2 | `engulf`, `swallow` |
| `swapPlaces` | 1 | `bait-and-switch` |
| `sweep` | 1 | `sweeping-attack` |
| `swornEnemy` | 1 | `oathbow-enchanted` |
| `targetedSummon` | 1 | `finger-of-death` |
| `targets` | 27 | `animal-friendship`, `calm-emotions`, `cause-fear`, `channel-divinity`, `channel-divinity-cleric`, `charm-person`, … |
| `teleport` | 8 | `boon-of-dimensional-travel`, `clouds-jaunt`, `dimension-door`, `mist-walker`, `misty-step`, `moonlight-step`, … |
| `tempHpPool` | 1 | `power-word-fortify` |
| `tether` | 1 | `witch-bolt` |
| `thinWall` | 5 | `prismatic-wall`, `wall-of-force`, `wall-of-ice`, `wall-of-stone`, `wind-wall` |
| `thrownDamage` | 1 | `thrown-weapon-fighting` |
| `trace` | 7 | `armor-of-agathys`, `blade-ward`, `dispel-evil-and-good`, `flame-blade`, `moonlight-step`, `produce-flame`, … |
| `transpose` | 1 | `tricksters-transposition` |
| `triggers` | 266 | `abjure-foes`, `absorb-elements`, `absorption-ioun-stone`, `acid-arrow`, `air-element`, `ancient-might`, … |
| `untypedDamage` | 2 | `mm-wight-life-drain`, `otilukes-freezing-sphere` |
| `upkeep` | 1 | `crown-of-madness` |
| `usageLimits` | 11 | `action-surge`, `flame-blade`, `indomitable`, `pact-of-the-chain`, `plant-growth`, `produce-flame`, … |
| `wallAura` | 1 | `prismatic-wall` |
| `walls` | 7 | `forcecage`, `prismatic-wall`, `wall-of-fire`, `wall-of-force`, `wall-of-ice`, `wall-of-stone`, … |
| `wallSide` | 1 | `wall-of-fire` |
| `wardsAtZero` | 1 | `death-ward` |
| `wardsConditions` | 1 | `protection-from-evil-and-good` |
| `willingFails` | 4 | `enlarge-reduce`, `levitate`, `otilukes-resilient-sphere`, `resilient-sphere` |
| `windward` | 1 | `gust-of-wind` |
| `wrath` | 2 | `berserker-axe-enchanted`, `sword-of-vengeance-enchanted` |
| `zoneAffects` | 16 | `brute-spirit`, `conjure-barrage`, `conjure-volley`, `conjure-woodland-beings`, `cordon-of-arrows`, `coward-spirit`, … |
| `zoneBound` | 1 | `spirit-guardians` |
| `zoneCharges` | 1 | `cordon-of-arrows` |
| `zoneEffects` | 2 | `jallarzis-storm-of-radiance`, `silence` |
| `zoneEnd` | 1 | `delayed-blast-fireball` |
| `zoneLasts` | 2 | `antimagic-cone`, `symbol` |
| `zoneMax` | 2 | `decanter-of-endless-water`, `slow` |

## Déclencheurs : moment → action

| Moment → action | Entrées | Exemples |
|---|---|---|
| `allyAttacks → bonus` | 1 | `cosmic-omen` |
| `allyAttacks → use` | 1 | `cosmic-omen` |
| `allyIsDamaged → absorb` | 1 | `projected-ward` |
| `allyIsDamaged → use` | 1 | `projected-ward` |
| `allyIsHit → halve` | 1 | `sentinel-at-deaths-door` |
| `allyIsHit → penalty` | 1 | `cutting-words` |
| `allyIsHit → reduce` | 2 | `interception`, `psionic-power` |
| `allyIsHit → uncrit` | 1 | `sentinel-at-deaths-door` |
| `allyIsHit → use` | 5 | `cutting-words`, `interception`, `psionic-power`, `sentinel`, `sentinel-at-deaths-door` |
| `castsSpell → use` | 3 | `absorption-ioun-stone`, `counterspell`, `greater-absorption-ioun-stone` |
| `endOfTurn → damage` | 5 | `acid-arrow`, `melfs-acid-arrow`, `phantasmal-killer`, `vitriolic-sphere`, `weird` |
| `endOfTurn → remove` | 6 | `acid-arrow`, `command`, `melfs-acid-arrow`, `moonlight-step`, `steady-aim`, `vitriolic-sphere` |
| `endOfTurn → resave` | 40 | `beguiling-magic`, `blinding-smite`, `blindness-deafness`, `carrion-crawler-mucus`, `cause-fear`, `compulsion`, … |
| `enemyAttacked → use` | 1 | `soul-of-vengeance` |
| `enemyAttacks → disadvantage` | 2 | `protection`, `warding-flare` |
| `enemyAttacks → intercept` | 1 | `arrow-catching-shield` |
| `enemyAttacks → penalty` | 1 | `cosmic-omen` |
| `enemyAttacks → use` | 4 | `arrow-catching-shield`, `cosmic-omen`, `protection`, `warding-flare` |
| `enemyDisengages → use` | 1 | `sentinel` |
| `enter → replay` | 3 | `ball-bearings`, `caltrops`, `prismatic-wall` |
| `enter,turnEnd → replay` | 19 | `black-tentacles`, `blade-barrier`, `cloud-of-daggers`, `cloudkill`, `conjure-celestial`, `conjure-woodland-beings`, … |
| `enter,turnStart → replay` | 2 | `sleet-storm`, `web` |
| `failedSave → banish` | 2 | `dispel-evil-and-good`, `divine-word` |
| `failedSave → breakConcentration` | 2 | `earthquake`, `sleet-storm` |
| `failedSave → disarm` | 2 | `disarming-attack`, `heat-metal` |
| `failedSave → lift` | 1 | `reverse-gravity` |
| `failedSave → mark` | 1 | `oil` |
| `failedSave → move` | 11 | `elemental-attunement`, `forceful-hand`, `gust-of-wind`, `open-hand-technique`, `pushing-attack`, `stormborn`, … |
| `failedSave → revertForm` | 1 | `moonbeam` |
| `failedSave → status` | 16 | `brute-spirit`, `decanter-of-endless-water`, `earthquake`, `grasping-hand`, `grease`, `mace-of-disruption`, … |
| `falls → cancel` | 1 | `ring-of-feather-falling` |
| `falls → reduce` | 1 | `slow-fall` |
| `falls → use` | 2 | `ring-of-feather-falling`, `slow-fall` |
| `falls,allyFalls → cancel` | 1 | `feather-fall` |
| `falls,allyFalls → use` | 1 | `feather-fall` |
| `hit → move` | 4 | `repelling-blast`, `ring-of-the-ram`, `thorn-whip`, `vine-attack` |
| `hit → status` | 5 | `eldritch-smite`, `giant-slayer-enchanted`, `hammer-of-thunderbolts-enchanted`, `sword-of-sharpness-enchanted`, `vine-attack` |
| `isAttacked → disadvantage` | 3 | `limited-foresight`, `lucky`, `shadowy-dodge` |
| `isAttacked → use` | 3 | `limited-foresight`, `lucky`, `shadowy-dodge` |
| `isAttacked → ward` | 1 | `sanctuary` |
| `isDamaged → damage` | 1 | `warding-bond` |
| `isDamaged → remove` | 26 | `abjure-foes`, `animal-friendship`, `armor-of-agathys`, `avenging-angel`, `calm-emotions`, `channel-divinity`, … |
| `isDamaged → resave` | 6 | `dominate-beast`, `dominate-monster`, `dominate-person`, `hideous-laughter`, `symbiotic-being`, `tashas-hideous-laughter` |
| `isDamaged → use` | 8 | `absorb-elements`, `boon-of-energy-resistance`, `fount-of-moonlight`, `hellish-rebuke`, `mist-walker`, `misty-escape`, … |
| `isHit → damage` | 4 | `armor-of-agathys`, `avenger-spirit`, `corrosive-form`, `fire-shield` |
| `isHit → halve` | 4 | `beguiling-defenses`, `sentinel-at-deaths-door`, `toxic-escape`, `uncanny-dodge` |
| `isHit → miss` | 1 | `illusory-self` |
| `isHit → penalty` | 4 | `cutting-words`, `gathered-whispers`, `parry`, `quarterstaff-of-the-acrobat` |
| `isHit → reduce` | 6 | `deflect-attacks`, `deflect-blow`, `gloves-of-missile-snaring`, `parry-maneuver`, `psionic-power`, `stones-endurance` |
| `isHit → save` | 1 | `holy-aura` |
| `isHit → uncrit` | 1 | `sentinel-at-deaths-door` |
| `isHit → use` | 17 | `beguiling-defenses`, `cutting-words`, `defensive-duelist`, `deflect-attacks`, `deflect-blow`, `gathered-whispers`, … |
| `isMissed → use` | 1 | `riposte` |
| `isTargeted → cancel` | 2 | `rod-of-absorption`, `staff-of-the-magi` |
| `isTargeted → use` | 3 | `rod-of-absorption`, `shield`, `staff-of-the-magi` |
| `moves → replay` | 1 | `spike-growth` |
| `preAttackRoll → advantage` | 26 | `assassinate`, `avenging-angel`, `clairvoyant-combatant`, `distracting-strike`, `faerie-fire`, `feinting-attack`, … |
| `preAttackRoll → attackBonus` | 3 | `blade-ward`, `brutal-strike`, `improved-brutal-strike` |
| `preAttackRoll → consume` | 10 | `brutal-strike`, `distracting-strike`, `feinting-attack`, `guiding-bolt`, `improved-brutal-strike`, `moonlight-step`, … |
| `preAttackRoll → disadvantage` | 29 | `bestow-curse`, `blur`, `clairvoyant-combatant`, `cloak-of-displacement`, `compelled-duel`, `dispel-evil-and-good`, … |
| `preDamageRoll → damage` | 35 | `ancient-might`, `bestow-curse`, `blessed-strikes`, `blessed-strikes-potent-spellcasting`, `brutal-strike`, `celestial-revelation`, … |
| `savedSave → mark` | 1 | `eyebite` |
| `savedSave → move` | 1 | `bead-of-force` |
| `startOfTurn → damage` | 11 | `air-element`, `aura-of-life`, `burnt-othur-fumes`, `earth-element`, `ensnaring-strike`, `fire-element`, … |
| `startOfTurn → resave` | 7 | `air-element`, `bestow-curse`, `burnt-othur-fumes`, `earth-element`, `fire-element`, `searing-smite`, … |
| `turnEnd → replay` | 2 | `gust-of-wind`, `hunger-of-hadar` |
| `turnStart → replay` | 2 | `hunger-of-hadar`, `stinking-cloud` |
