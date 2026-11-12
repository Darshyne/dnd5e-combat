# Réglages

> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.

128 réglages, relevés sur chaque `game.settings.register` du module chargé. **Portée** : `world` = la table (MJ),
`client` = ce poste, `user` = ce joueur. **Onglet** : celui de la fenêtre de réglages DAS (`core/settings-layout.mjs`) ; sans onglet,
le réglage est une mémoire interne ou se règle ailleurs (interrupteur, fenêtre dédiée). Le libellé est celui de `lang/fr.json`.

## Onglet `general`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `automationLevel` | Niveau d'automatisation | world | String | `"full"` | essentials, assisted, full | `runtime/levels.mjs` |
| `autoTranslate` | Traduire à la création | world | Boolean | `true` |  | `runtime/auto-translate.mjs` |
| `autoUsage` | Utiliser sans la fenêtre de dnd5e | world | Boolean | `true` |  | `runtime/usage.mjs` |
| `combatLaunchButton` | Bouton « Lancer un combat » | world | Boolean | `true` |  | `runtime/combat-launch.mjs` |
| `damageFlow` | Dégâts et soins | world | String | `"level"` | level, auto, click, validate, clickValidate | `runtime/flow.mjs` |
| `dataFixes` | Corriger la donnée premium à la création | world | Boolean | `true` |  | `runtime/data-fixes.mjs` |
| `etherealPlane` | Plan Éthéré automatisé | world | Boolean | `true` |  | `runtime/ethereal.mjs` |
| `groupRollSeconds` | Jets demandés : délai des joueurs (s) | world | Number | `60` |  | `runtime/group-roll.mjs` |
| `provideBasicActions` | Actions de base sur les personnages | world | Boolean | `true` |  | `runtime/basics.mjs` |
| `reactionPrompts` | Réactions | world | String | `"level"` | level, ask, players, off | `runtime/flow.mjs` |
| `realTimeClock` | Horloge en temps réel hors combat | world | Boolean | `false` |  | `runtime/clock.mjs` |
| `refusalMode` | Action impossible | world | String | `"level"` | level, window, notice, strict, off | `runtime/forced.mjs` |
| `sidebarButton` | Bouton DAS dans l'onglet Réglages | client | Boolean | `true` |  | `ui/settings.mjs` |
| `theaterOfMind` | Théâtre de l'esprit | world | Boolean | `false` |  | `runtime/theater.mjs` |

## Onglet `combat`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `aurasOnlyInCombat` | Auras : seulement en combat | world | Boolean | `false` |  | `runtime/auras.mjs` |
| `combatWindowSeconds` | Délai des fenêtres du combat (secondes) | world | Number | `10` |  | `runtime/basics.mjs` |
| `combatWindowUnlimited` | Fenêtres du combat sans délai | world | Boolean | `false` |  | `runtime/player-waits.mjs` |
| `cover` | Abri | world | Boolean | `true` |  | `runtime/vision.mjs` |
| `criticalMode` | Coups critiques | world | String | `"standard"` | standard, choice, table | `runtime/criticals.mjs` |
| `criticalNpc` | Table de critiques pour les PNJ aussi | world | Boolean | `false` |  | `runtime/criticals.mjs` |
| `criticalTable` | Table de critiques | world | String | `""` |  | `runtime/criticals.mjs` |
| `critMargin` | Critique en dépassant la CA | world | Number | `0` |  | `runtime/criticals.mjs` |
| `endUnaffected` | Fin de concentration quand personne n'est affecté | world | Boolean | `true` |  | `runtime/endings.mjs` |
| `flanking` | Prise en tenaille (règle maison) | world | String | `"off"` | off, advantage | `runtime/flanking.mjs` |
| `flankingConga` | Prise en tenaille : pas de tenaille en chaîne | world | Boolean | `false` |  | `runtime/flanking.mjs` |
| `flankingSide` | Prise en tenaille : qui en profite | world | String | `"all"` | all, pc, npc | `runtime/flanking.mjs` |
| `heroicInspiration` | Inspiration héroïque (ce poste) | client | String | `"on"` | on, failure, off | `runtime/heroic.mjs` |
| `legendaryResistance` | Résistance légendaire (PNJ) | world | String | `"ask"` | ask, always, never | `runtime/basics.mjs` |
| `masteryRules` | Bottes d'arme : nombre et changements | world | Boolean | `true` |  | `runtime/mastery-choices.mjs` |
| `nonLethalMenu` | Coups non létaux dans le menu contextuel | world | Boolean | `false` |  | `ui/pointer.mjs` |
| `npcSaveChoice` | Sauvegarde au choix de la cible (PNJ) | world | String | `"ask"` | ask, best | `runtime/basics.mjs` |
| `portent` | Présage du Devin | world | Boolean | `true` |  | `runtime/portent.mjs` |
| `sneakAttackMode` | Attaque sournoise | world | String | `"auto"` | auto, ask | `runtime/sneak.mjs` |
| `somaticHands` | Main libre pour les composantes somatiques | world | String | `"pc"` | pc, all, off | `adapter/hands.mjs` |
| `successAtCost` | Succès à un prix | world | Boolean | `false` |  | `runtime/success-at-cost.mjs` |
| `successAtCostHold` | Succès à un prix : pause (secondes) | world | Number | `5` |  | `runtime/success-at-cost.mjs` |
| `zoneChoice` | Zones « créatures de votre choix » | world | String | `"mixed"` | mixed, always, never | `adapter/zone-choice.mjs` |

## Onglet `movement`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `altitude` | Modes de déplacement et élévation | world | Boolean | `true` |  | `runtime/altitude.mjs` |
| `autoFall` | Chute automatique | world | String | `"combat"` | off, combat, always | `runtime/falls.mjs` |
| `clickToMove` | Déplacement au clic gauche | client | String | `"off"` | always, combat, off | `ui/pointer.mjs` |
| `climbRules` | Règles d'escalade | world | String | `"2024"` | 2024, house | `runtime/climb.mjs` |
| `climbSystem` | Système d'escalade et de chute | world | Boolean | `true` |  | `runtime/climb-system.mjs` |
| `climbSystemButton` | Bouton « Escalade et chutes » dans la barre du MJ | world | Boolean | `true` |  | `runtime/climb-system.mjs` |
| `fireSpread` | Propagation des flammes (règle maison) | world | Boolean | `false` |  | `runtime/burning.mjs` |
| `highJumpMenu` | « Sauter en hauteur ici » dans le menu (bêta) | world | Boolean | `false` |  | `ui/pointer.mjs` |
| `lockFailure` | Serrures : après un échec | world | String | `"free"` | free, once | `runtime/doors.mjs` |
| `pathPreview` | Aperçu du chemin en combat | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `teleportPlanning` | Téléportation : choisir la destination aussitôt | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `volumes` | Élévation et volumes | world | Boolean | `true` |  | `runtime/space.mjs` |

## Onglet `vision`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `coneAngles` | Angle des cônes de vision | world | String | `"120; beast 150; ooze 360; plant 360"` |  | `runtime/vision.mjs` |
| `factionIcons` | Factions : icônes sur les tokens et la barre d'outils | world | Boolean | `false` |  | `ui/factions.mjs` |
| `factionRules` | Factions : règles par type de créature | world | Boolean | `true` |  | `runtime/factions.mjs` |
| `lightIndicator` | Indicateur de lumière | client | Boolean | `true` |  | `ui/illumination.mjs` |
| `passivePerception` | Perception passive contre la Furtivité | world | String | `"auto"` | auto, gm, off | `runtime/passive.mjs` |
| `stealthRules` | Règles de Furtivité | world | String | `"2024"` | 2024, bg3 | `runtime/stealth.mjs` |
| `surpriseFromStealth` | Surprise par un ennemi caché | world | Boolean | `true` |  | `runtime/knockout.mjs` |
| `twilightDarkness` | Crépuscule : seuil d'obscurité | world | Number | `0.6` |  | `runtime/illumination.mjs` |
| `unconsciousSenses` | Inconscient : ni vue ni ouïe | world | Boolean | `false` |  | `runtime/illumination.mjs` |
| `vision` | Vision simulée | world | Boolean | `true` |  | `runtime/vision.mjs` |
| `visionCones` | Cônes de vision hors combat | world | Boolean | `true` |  | `runtime/vision.mjs` |

## Onglet `mouse`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `ammoPrompt` | Demander la munition à tirer | client | Boolean | `true` |  | `runtime/ammo.mjs` |
| `attackLine` | Ligne de visée | world | Boolean | `false` |  | `ui/attack-line.mjs` |
| `attackLineMelee` | Ligne de visée au contact | world | Boolean | `true` |  | `ui/attack-line.mjs` |
| `clickToAttack` | Attaque de base au clic sur un ennemi | client | String | `"off"` | always, combat, off | `ui/pointer.mjs` |
| `closeSheetOnUse` | Fermer la fiche en choisissant une attaque ou un sort | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `coverPreview` | Aperçu de l'abri | world | Boolean | `false` |  | `ui/hitchance.mjs` |
| `fastAttack` | Attaque à la souris sans dialogue | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `hitChance` | Chance de toucher au survol | client | Boolean | `true` |  | `ui/hitchance.mjs` |
| `hitChancePlayers` | Chance de toucher : ce que voient les joueurs | world | String | `"full"` | full, percent, off | `ui/hitchance.mjs` |
| `quickRolls` | Jets sans fenêtre (attaque, dégâts, soins) | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `releaseTargets` | Relâcher les cibles automatiquement | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `situationalCursor` | Curseur selon la situation | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `targetingBanner` | Visée : bandeau de consigne | client | Boolean | `true` |  | `ui/pointer.mjs` |
| `targetingMode` | Mode visée | client | Boolean | `true` |  | `ui/pointer.mjs` |

## Onglet `chat`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `animationWait` | Attente maximale d'une animation | world | Number | `3` |  | `runtime/animations.mjs` |
| `chatCompact` | Carte unique par action | world | Boolean | `true` |  | `ui/compact.mjs` |
| `chatLight` | Journal de chat allégé | world | Boolean | `true` |  | `runtime/engine.mjs` |
| `chatPurgeKeep` | Purge du journal : messages gardés | world | Number | `150` |  | `runtime/purge.mjs` |
| `chatPurgeMax` | Purge du journal : au-delà de | world | Number | `300` |  | `runtime/purge.mjs` |
| `forcedAlerts` | Prévenir quand un joueur passe outre une règle | world | Boolean | `true` |  | `runtime/forced.mjs` |
| `gmAlertBanner` | Alertes MJ : bandeau | client | Boolean | `true` |  | `ui/gm-alert.mjs` |
| `gmAlerts` | Alertes MJ | world | Boolean | `true` |  | `runtime/gm-alert.mjs` |
| `gmAlertSeconds` | Alertes MJ : secondes à l'écran | client | Number | `15` |  | `ui/gm-alert.mjs` |
| `syncAnimations` | Synchroniser avec les animations | world | Boolean | `true` |  | `runtime/animations.mjs` |

## Onglet `float`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `awaitingGm` | Décisions du MJ pour un PNJ | world | String | `"discreet"` | discreet, token, hidden | `runtime/awaiting.mjs` |
| `awaitingHide` | Masquer le sablier sur cet ordinateur | client | Boolean | `false` |  | `runtime/awaiting.mjs` |
| `awaitingShow` | Sablier quand la table attend une réponse | world | Boolean | `true` |  | `runtime/awaiting.mjs` |
| `feedbackText` | Retour visuel au-dessus des tokens | client | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatAdvantage` | Afficher : Avantage et Désavantage | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatAttacks` | Afficher : critique et raté | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatChecks` | Afficher : tests de caractéristique et de compétence | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatCover` | Afficher : abri | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatDice` | Résultat des dés | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatDirection` | Sens des textes | world | String | `"down"` | down, up | `ui/feedback.mjs` |
| `floatDistance` | Course d'un texte (cases) | world | Number | `1.5` |  | `ui/feedback.mjs` |
| `floatDuration` | Durée d'un texte (secondes) | world | Number | `4` |  | `ui/feedback.mjs` |
| `floatEffects` | Afficher : effets | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatHits` | Afficher : « Touché » | world | Boolean | `false` |  | `ui/feedback.mjs` |
| `floatIcons` | Pictogrammes | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatInitiative` | Afficher : initiative | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatPrompts` | Afficher : invites et refus | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatReactions` | Afficher : réactions | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatResources` | Afficher : ressources | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatSaves` | Afficher : sauvegardes | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatScale` | Taille des textes (%) | world | Number | `100` |  | `ui/feedback.mjs` |
| `floatSounds` | Sons de l'hexagone de jet | client | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatSoundVolume` | Volume des sons de l'hexagone (%) | client | Number | `40` |  | `ui/feedback.mjs` |
| `floatSpacing` | Écart entre deux textes (secondes) | world | Number | `1` |  | `ui/feedback.mjs` |
| `floatStrikes` | Afficher : dégâts en plus | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `floatSystem` | Textes flottants DAS | world | Boolean | `true` |  | `ui/feedback.mjs` |
| `timerHideSeconds` | Minuteries sans les secondes | world | Boolean | `false` |  | `ui/timers.mjs` |

## Onglet `advanced`

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `automationBadges` | Pastilles d'automatisation (MJ) | client | Boolean | `true` |  | `ui/automation.mjs` |
| `connectionTest` | Test de connexion des joueurs | world | Boolean | `false` |  | `runtime/connection.mjs` |
| `debugAllModules` | Rapport de bug : tous les modules | client | Boolean | `false` |  | `runtime/debug.mjs` |
| `debugCapture` | Rapport de bug : relever les erreurs | client | Boolean | `true` |  | `runtime/debug.mjs` |
| `debugMenu` | Rapport de bug : entrée du menu contextuel | world | Boolean | `true` |  | `ui/debug-report.mjs` |
| `debugNotify` | Rapport de bug : prévenir à la première erreur | client | Boolean | `true` |  | `ui/debug-report.mjs` |
| `perfWarnMs` | Relevé des temps : seuil (ms) | client | Number | `50` |  | `runtime/perf.mjs` |

## Hors de la fenêtre de réglages

| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |
|---|---|---|---|---|---|---|
| `autoRotateNotice` |  | world | Boolean | `false` |  | `ui/welcome.mjs` |
| `combatLaunch` |  | world | Object | `{}` |  | `runtime/combat-launch.mjs` |
| `combatLaunchPlaylist` |  | client | String | `""` |  | `runtime/combat-launch.mjs` |
| `contentOverrides` |  | world | Object | `{}` |  | `runtime/content.mjs` |
| `ddbNotice` |  | world | Number | `0` |  | `ui/welcome.mjs` |
| `factions` |  | world | Object | `{"factions":[{"id":"party","color":"#3a…` |  | `runtime/factions.mjs` |
| `floatCoreMuted` |  | world | Boolean | `false` |  | `ui/feedback.mjs` |
| `floatTheme` |  | world | Object | `{}` |  | `ui/feedback.mjs` |
| `itemReports` |  | world | Object | `{}` |  | `ui/automation.mjs` |
| `welcomeSeen` |  | world | String | `""` |  | `ui/welcome.mjs` |
