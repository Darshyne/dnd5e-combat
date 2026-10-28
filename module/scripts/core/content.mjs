/**
 * Le schéma du contenu (SPEC §13, S4) : ce qu'un item peut déclarer au moteur, d'où que cela
 * vienne — contenu livré avec le module, surcouche du monde, flag de l'item — et comment ces
 * couches se combinent. Validation ici, pas dans Foundry : une entrée fausse est refusée à
 * l'écriture (runtime/content.mjs) et ignorée à la lecture, jamais appliquée à moitié.
 *
 * Une ENTRÉE, indexée par identifiant dnd5e :
 *   {
 *     triggers?: [{ on, if?, do, via? }]        déclarations du registre (core/triggers.mjs) ; `via: "effect"` :
 *                                               portée par les effets que l'item pose (sauvegarde répétée)
 *     aura?: { radius?, units?, affects?, includeSelf?, effect?, radiusFormula?, changes?, types?, whileActive? }
 *                                               `changes` : les changements de la copie, à la place de l'effet de l'item
 *                                               (effet absent, vide ou faux dans le Monster Manual, §18.12) — la copie ne
 *                                               porte alors aucun état ; `types` : seulement ces types de créature
 *     onHit?: { save: <id d'activité> }         attaque qui impose une sauvegarde (adapter/usage.mjs)
 *     choice?: { effects: "one", prompt?, pool? }  effets EXCLUSIFS : l'auteur en choisit un (Maléfice) ; `pool` :
 *                                               { <id d'activité> : [ids d'effets de l'item] } — des effets de l'item
 *                                               qu'une activité propose sans les relier (§37, Malédiction : « Curse
 *                                               Ability » et ses six caractéristiques)
 *     teleport?: { distance, units, activity? } l'utilisation téléporte l'utilisateur (§16.10, B11) : la destination se
 *                                               choisit aussitôt, à `distance` au plus — pour un item sans activité
 *                                               « teleport » de dnd5e (tout le PHB : Foulée brumeuse y est utilitaire) ;
 *                                               `then` : id d'une activité de l'item utilisée à l'arrivée (§67 quater)
 *     lineDash?: { reach, units, activity? }    ruée en ligne droite (§57) : à l'utilisation, la case
 *                                               d'arrivée se choisit (jusqu'à la Vitesse, inoccupée, en vue, en ligne droite à
 *                                               travers les créatures, sans attaque d'opportunité) ; l'activité (défaut : celle
 *                                               utilisée) joue sur chaque créature à `reach` ou moins d'un espace traversé — sans
 *                                               gabarit (core/dash.mjs)
 *     movable?: { distance, units }             la zone du sort se déplace (§16.14, B18 : Rayon de lune, « une action
 *                                               Magie lors de vos tours suivants, 18 m au plus ») : relancer le sort
 *                                               quand sa zone est déjà là la déplace vers la case cliquée, au prix de
 *                                               l'activation de l'activité, sans emplacement
 *     summon?: { initiative: "after"|"own"|"none", pilot?, endsSpell? }
 *                                               les créatures invoquées entrent au combat (§16.13, B12) : `after` =
 *                                               « partage votre initiative et joue juste après vous » (Summon X) ;
 *                                               `own` = « lance sa propre initiative » (Appel de familier) ; `none` =
 *                                               n'entre pas au combat (Œil magique, Lumières dansantes : ils n'agissent pas).
 *                                               `replaces: true` (§230) : une nouvelle invocation renvoie les précédentes du même
 *                                               item (Appel de destrier : « le destrier est remplacé par le nouveau ») ;
 *                                               `minLevels: { <activité>: n }` (§230) : cette activité ne se lance qu'à partir
 *                                               du niveau de sort n — son incantation gratuite (au niveau de base) n'en est pas une.
 *                                               `familiar: true` (§107) : un familier — actions de base sauf l'attaque, vision
 *                                               activée, son maître peut le congédier dans sa poche dimensionnelle et l'en rappeler.
 *                                               `pilot: { cost, distance, units, onCast? }` (§16.15, B19) : un objet que
 *                                               le lanceur commande pendant son tour (Arme spirituelle) — son tour est
 *                                               sauté, une commande coûte `cost` au lanceur et ouvre un déplacement de
 *                                               `distance` et une utilisation ; `onCast` : « use » | « command », la
 *                                               commande offerte au tour du lancement ; `occupies: false` : l'objet
 *                                               n'occupe pas son espace (Main de Bigby) ; `shared: true` : une commande
 *                                               vaut pour tous les objets du sort (« déplacer les lumières ») ;
 *                                               `cluster: { distance, units }` : chacun reste à cette distance d'un autre ;
 *                                               `leash: true` : un objet qui sort de la portée du sort disparaît ;
 *                                               `tether: { distance, units }` : il ne se déplace qu'à cette distance du
 *                                               lanceur (Duplicité : 36 m).
 *                                               `lasts: { value, units }` : la créature disparaît au bout de cette durée
 *                                               d'heure du monde (formule sur les données de l'item ; Compagnon sauvage).
 *                                               Et, pour l'invocation : `mimic: true` (le token prend l'image du lanceur),
 *                                               `endsIfIncapacitated: true` (elle cesse si le lanceur est Neutralisé),
 *                                               `castFrom: true` (le lanceur lance ses sorts depuis sa case : la portée
 *                                               se mesure depuis l'un ou l'autre). `endsSpell: true` : retirer
 *                                               l'objet met fin à la concentration du sort ; `endsAtZero: true` :
 *                                               l'objet à 0 PV aussi ; `vanishesAtZero: true` : la créature
 *                                               disparaît à 0 PV, le sort continue (§259 : sorts d'invocation
 *                                               du PHB 2024) ; `vanishesAfterDamage: n` : elle disparaît quand
 *                                               ses pulsations ont infligé n dégâts au total (Gardien de la foi).
 *                                               `pulse: { item, radius, units }` : une créature
 *                                               qui finit son tour à `radius` de l'objet subit l'activité de son
 *                                               item `item` (identifiant ; Sphère de feu : « flames ») ; `on` : les
 *                                               moments (turnEnd par défaut ; enter : une créature arrive à portée ; turnStart : elle commence son tour à portée ;
 *                                               casterTurnStart : au début du tour du lanceur, contre UN ennemi à portée (§159) ;
 *                                               moves : l'objet arrive à portée d'elle), une fois par tour et par
 *                                               créature ; `affects: "enemy"` : seulement les ennemis du lanceur
 *     burst?: { activity, radius, units, from? } après le jet d'attaque, touché ou raté, le moteur joue l'activité sœur
 *                                               `activity` sur la cible et chaque créature à `radius` d'elle (§16.19 :
 *                                               l'explosion du Couteau de glace) ; `from` : après ces activités-là
 *                                               (ids), et sur une cible qui a subi des dégâts (Métal brûlant, §16.21)
 *     recast?: true                             relancer le sort tant que sa concentration tient le réutilise, sans
 *                                               emplacement ni nouvelle concentration (Appel de la foudre, §16.21)
 *     obscures?: true                           la zone posée par l'item obscurcit fortement (Nappe de brouillard, §16.24) :
 *                                               la vue ne la traverse pas ; vision aveugle et perception des vibrations, si
 *                                               (§14.1, adapter/vision.mjs)
 *     usageLimits?: { <id d'activité>: { oncePerTurn?, whenEmpty?, lowestSlot?, noDialog?, cost?, unmoved? } }
 *                                               limites d'utilisation que dnd5e ne contrôle pas (§16.40, core/limits.mjs) :
 *                                               une fois à chacun de vos tours ; seulement si l'item `whenEmpty` n'a plus
 *                                               d'utilisation ; `lowestSlot` : l'emplacement le plus bas, sans fenêtre ;
 *                                               `noDialog` : sans la fenêtre de dnd5e ; `cost` : le coût de la règle 2024
 *                                               quand les données de dnd5e disent autre chose (Flammes : action Bonus)
 *                                               (Regain sauvage) ; `unmoved` : seulement sans s'être déplacé ce tour (Visée
 *                                               stable, §20)
 *     effectsExpire?: "longRest"|"shortRest"    les effets que l'item pose prennent fin à ce repos du porteur (expiration
 *                                               native de dnd5e, `duration.expiry`) — Prière de guérison, §16.38
 *     revealsInvisible?: true                   le porteur d'un effet de l'item « ne peut pas bénéficier de l'état
 *                                               Invisible » (Poussière d'étoile, Lueurs féeriques, §16.36) : la vision
 *                                               simulée et l'état forfaitaire le jugent comme s'il ne l'était pas
 *     light?: { on, bright?, dim?, units?, darkness?, dispels?, carried?, single?, color?, animation? }
 *                                               lumière ou ténèbres du sort (§16.31, core/light.mjs). `on` : « area » = une
 *                                               source sur la zone posée, qui la suit et part avec elle (`darkness: true` :
 *                                               ténèbres magiques du rayon de la zone, qui bloquent la vue comme la brume,
 *                                               sauf vision véritable et Vision du diable ; `dispels: n` : dissipe les
 *                                               ténèbres de niveau ≤ n qu'elle recouvre) ; « effect » = les effets de l'item
 *                                               font briller leur porteur ; « summon » = l'objet invoqué porte sa lumière,
 *                                               `carried` : au lancement, le joueur choisit « au sol » ou « sur moi » (le
 *                                               lanceur brille) et la couleur (§16.35) ;
 *                                               « wall » (§170) = une rangée de sources de chaque côté d'un mur posé par
 *                                               points (Mur de feu), qui naissent, suivent et partent avec lui ;
 *                                               `single` : relancer le sort éteint le précédent. Rayons en convention de
 *                                               Foundry (`dim` = rayon extérieur de la lumière faible)
 *     saveAdvantage?: string[]                  le porteur de l'item a l'avantage aux sauvegardes contre une activité qui
 *                                               pose l'un de ces états (Ascendance féerique : `charmed`, §16.25) ;
 *                                               `"magic"` : contre un sort ou un effet magique (Résistance à la magie, §18.9)
 *     onFell?: { activity?, radius, units }     quand un ennemi tombe à 0 PV sous les coups du porteur, ou à `radius` de
 *                                               lui, l'activité (défaut : le premier soin de l'item) joue (Bénédiction du
 *                                               Ténébreux, §16.25)
 *     bonusAttack?: { after, melee? }          après une attaque d'arme de l'auteur qui `after` ("critical" : un coup
 *                                               critique ; "felled" : une cible tombée à 0 PV) — au corps à corps si
 *                                               `melee` —, la même arme attaque de nouveau pour une action Bonus, à son tour
 *                                               (Maître d'armes lourdes, « Taille », §16.26)
 *     reactiveSpell?: true                      le porteur peut répondre à une attaque d'opportunité par un sort d'une action
 *                                               qui ne vise que la créature qui s'en va (Mage de guerre, §16.26)
 *     projectiles?: { count, attack }           plusieurs projectiles par lancement (§16.27) — `count` : formule (données de
 *                                               l'activité mise à l'échelle : `@item.level`, `@details.level`) ; `attack` :
 *                                               false = ils touchent d'office, répartis entre les cibles (Projectile
 *                                               magique) ; true = une attaque par projectile, enchaînées par le moteur
 *                                               (Rayon ardent, Décharge occulte)
 *     leap?: { radius, units, max }             sur un double aux dés de dégâts d'une attaque qui touche, le sort rebondit
 *                                               vers une autre cible à `radius` de la dernière, jamais visée par ce
 *                                               lancement, `max` fois au plus (formule : `@item.level`) — Orbe chromatique, §16.27
 *     duplicates?: true                         les effets de l'item sur son porteur sont des répliques (Image miroir, §16.25) :
 *                                               un coup qui le touche peut toucher une réplique à sa place
 *     healMax?: true                            une créature qui porte un effet de l'item regagne le maximum d'un soin
 *                                               (Lueur d'espoir, §16.24)
 *     bolt?: { radius, units }                  la zone posée (gabarit de l'item) est ramenée à un cercle de ce rayon autour
 *                                               de son centre, puis retirée après la résolution (Appel de la foudre, §16.21)
 *     casterPulse?: { at, by: [{ from, to?, activity, max?, use?, pay? }], ground?, away?, untilSpent? }
 *                                               §91 : au début (`at: "turnStart"`) ou à la fin (`"turnEnd"`) du tour du lanceur, la
 *                                               zone qui dure rejoue une activité sœur sur ce qui est dedans — celle de l'entrée dont
 *                                               [from, to] contient le numéro du rejeu (1 = le premier tour après la pose : Tempête
 *                                               vengeresse, tours 2, 3, 4, 5–10) ; `max` : au plus tant de cibles (les éclairs : 6,
 *                                               les ennemis du lanceur d'abord) ; `use` : l'activité est UTILISÉE par le lanceur (ses
 *                                               consommations, sans cible ni zone : un compteur) ; `ground` : seulement les créatures
 *                                               au sol (Tremblement de terre) ; `pay` : les consommations de l'activité payées avant le
 *                                               rejeu (un compteur que ses dés lisent) ; `away: { distance, units }` : la zone
 *                                               s'éloigne d'abord du lanceur ; `untilSpent` : le sort prend fin quand l'item n'a plus
 *                                               d'utilisation (Tsunami)
 *     atZero?: { activity, save?: { ability, dc }, whileEffect? }
 *                                               §95 : tombé à 0 PV sans être tué sur le coup, le porteur peut se relever — l'activité
 *                                               UTILISÉE (ses consommations fixent les PV : Cosse nécrotique ; ou son soin, sur lui :
 *                                               Courroux persistant, Force du tombeau), après la sauvegarde `save` réussie (DD :
 *                                               formule, `@damage` = les dégâts subis) ; `whileEffect` : seulement s'il porte un
 *                                               effet de l'item de cet identifiant (transformé par Courroux sauvage)
 *     afterSneak?: { activity, radius, units }  §95 : juste après des dégâts d'Attaque sournoise à son tour, l'activité (dégâts) sur une
 *                                               AUTRE créature à `radius` de la première (Lamentations d'outre-tombe)
 *     searchBonus?: { formula?, advantage? }    §94 : à l'action Chercher (runtime/search.mjs), un dé ajouté au test (`formula` :
 *                                               Guetteurs, 1d4) ou l'Avantage (`advantage` : Œil vif — une utilisation de l'item,
 *                                               dépensée seulement si le test trouve quelqu'un)
 *     lifesteal?: { damageType?, fraction? }    §120 : l'auteur regagne des PV égaux à une part (`fraction`, 1 par défaut ; arrondi
 *                                               inférieur) des dégâts de ce type que l'item inflige (Caresse du vampire : la moitié
 *                                               des dégâts nécrotiques) — runtime/lifesteal.mjs
 *     savageAttacker?: true                     §129 : une fois par tour, au jet de dégâts d'une arme, ses dés lancés deux fois, le
 *                                               meilleur gardé (Sauvagerie martiale) — runtime/feats.mjs
 *     initiativeSwap?: true                     §129 : juste après son jet d'initiative, la créature peut échanger son initiative avec celle
 *                                               d'un allié du combat (Vigilant) — runtime/roll-bonus.mjs
 *     healingRerolls?: true                     §129 : aux dés de soins d'un sort de la créature, un 1 est relancé une fois (Guérisseur)
 *     effectWhile?: { <id d'effet>: { if: { armor?, oneHanded?, inCombat?, abilityAtLeast? }, changes? } }
 *                                               §130 : l'effet transféré de l'item n'est actif que si la condition tient pour le porteur
 *                                               (Défense, Duel…) ; `changes` réécrit les changements de l'effet (données cassées) —
 *                                               runtime/effect-while.mjs
 *     rangedFeat?: { kind, cover?, closeCombat?, longRange?, offhandModifier?, spellRange? }
 *                                               §131 : dons de tir — pour un genre d'attaque (`kind` : "weapon" = attaque à distance
 *                                               avec une arme, "crossbow" = arbalète, "spell" = jet d'attaque d'un sort) : l'abri partiel
 *                                               et aux trois quarts ignoré, pas de Désavantage au contact d'un ennemi ni à longue portée,
 *                                               le modificateur aux dégâts de l'attaque Légère, la portée du sort allongée (`spellRange`)
 *     peerlessAim?: true                        §135 : une attaque ratée touche à la place, une fois jusqu'au prochain tour (Prouesse martiale)
 *     fortifiedHealing?: true                   §135 : + Con aux PV regagnés, une fois par tour (Faveur de vigueur)
 *     overwhelmingStrike?: true                 §135 : sur un critique, des dégâts égaux à la valeur de la caractéristique augmentée par
 *                                               l'item (Faveur d'attaque irrésistible)
 *     spellRecall?: true                        §135 : 1d4 égal au niveau d'un emplacement 1–4 : il n'est pas dépensé (Rappel des sorts)
 *     lastStandHeal?: { activity }              §135 : à 0 PV, 1 PV + la moitié du maximum, sur les utilisations de l'activité (Dernier carré)
 *     elementalAdept?: true                     §134 : sorts du type choisi (flag de l'item) — résistance ignorée, 1 → 2 aux dés
 *     ignoresResistance?: { types }             §134 : les dégâts de ces types que le porteur inflige ignorent la résistance (Empoisonneur)
 *     fleeOnFailedSave?: true                   §147 : sauvegarde ratée → la cible fuit le lanceur par sa Réaction (Murmures dissonants)
 *     ritualAdept?: {class: string}           §139 : Savoir rituel — les sorts rituels de ce grimoire, non préparés, en rituel hors combat
 *     slotRecovery?: {class: string, maxLevel?: number}   §139 : Restauration magique au Repos court (moitié du niveau de la classe)
 *     reactiveStrike?: true                     §136 : Attaque réactive (Maître d'hast) contre qui entre dans l'allonge de l'arme d'hast tenue
 *     opportunityDisadvantage?: true            §134 : les attaques d'opportunité contre le porteur ont le Désavantage (Rapide)
 *     quickStand?: { value, units }             §134 : se relever coûte ce déplacement (au plus la moitié de la Vitesse ; Athlète)
 *     quickSearch?: true                        §134 : l'action Chercher se prend par une action Bonus quand elle est libre (Observateur)
 *     haltOnReaction?: { effect }               §133 : une attaque en Réaction (attaque d'opportunité) qui touche pose cet effet de
 *                                               l'item sur la cible (Sentinelle, Halte : Vitesse 0)
 *     spellDamageTypes?: { class, types }       relevé des trous : un sort de cette classe qui inflige des dégâts peut prendre l'un
 *                                               de ces types, proposé avec ses types au choix avant le jet (Sorts psychiques)
 *     endsOwnConditions?: string[]              §236 : à la fin de chacun de ses tours, le porteur met fin à l'un de ces états
 *                                               (Auto-restauration : Charmé, Effrayé, Empoisonné)
 *     regainOnInitiative?: { item, upTo }       §236 : au jet d'initiative, les utilisations de l'item remontent à `upTo` au moins
 *                                               (Inspiration supérieure)
 *     grantsResistances?: string[]              §236 : les Résistances que l'item donne sans effet dans ses données (Avatar de la
 *                                               bataille) — un effet tenu sur l'acteur, comme `grantsSpeeds`
 *     scoreFloor?: string[]                     §236 : un test ou une sauvegarde de ces caractéristiques vaut au moins leur valeur
 *                                               (Puissance indomptable : Force)
 *     cantripRange?: { class, add, requires? }  §236 : un tour de magie de la classe, d'une portée d'au moins 3 m, porte plus loin
 *                                               de `add` — si l'acteur a l'item `requires` (Fureur élémentaire améliorée)
 *     fleetStep?: { item, activity }            §236 : après une action Bonus autre que celle-ci, l'activité de l'item est gratuite
 *                                               une fois ce tour-là (Pas véloce : Pas du vent)
 *     extraFirstTurn?: { minus }                §236 : un second tour au premier round, à l'initiative moins `minus`, sauf Surpris
 *                                               (Réflexes du voleur)
 *     combatInspiration?: true                  relevé des trous : la créature qui porte l'Inspiration bardique de ce barde peut en
 *                                               ajouter le dé aux dégâts de son coup, ou à sa CA par sa Réaction quand elle est
 *                                               touchée (Inspiration de combat, Collège de la vaillance ; adapter/inspiration.mjs)
 *     critMove?: true                           relevé des trous : sitôt un coup critique porté, à son tour, la moitié de sa Vitesse
 *                                               en plus sans attaque d'opportunité (Athlète remarquable)
 *     keepsConcentration?: string[]             relevé des trous : subir des dégâts ne rompt pas la concentration sur ces items
 *                                               (identifiants) — pas de jet de concentration quand toute la concentration du porteur
 *                                               vient d'eux (Chasseur implacable : Marque du chasseur)
 *     concentrationBreaker?: true               §133 : la créature concentrée que le porteur blesse a le Désavantage à son prochain
 *                                               jet de concentration (Tueur de mages)
 *     interposeShield?: true                    §133 : sauvegarde de Dextérité réussie contre des dégâts réduits de moitié, bouclier
 *                                               tenu : la Réaction pour n'en subir aucun (Maître des boucliers)
 *     piercer?: true                            §132 : Perforeur — une fois par tour, un dé d'une attaque perforante relancé (le plus
 *                                               bas) ; un dé de plus au critique perforant — runtime/feats.mjs
 *     critMark?: { damageType, side }           §132 : un coup critique de ce type pose une marque sur la cible jusqu'au début du
 *                                               prochain tour de l'auteur : "against" = Avantage contre elle (Cogneur), "by" =
 *                                               Désavantage à ses attaques (Trancheur)
 *     grappleDamage?: { formula, damageType }   §132 : au début de chaque tour de l'auteur, ces dégâts à chaque créature qu'il agrippe
 *                                               (Combat à mains nues)
 *     rerollInitiative?: { atMost }             §120 : à chaque jet d'initiative, un d20 de `atMost` ou moins peut être relancé (question), le nouveau
 *                                               gardé (Survivant, Hypervigilance : 9) — runtime/roll-bonus.mjs
 *     onNatural1?: { activity }                 §93 : juste après un Test d20 de la créature dont le d20 fait 1, elle utilise
 *                                               l'activité (Dons sombres de Ravenloft : sa sauvegarde, sur elle-même)
 *     zoneEnd?: { activity }                    §91 : quand la zone qui dure de l'item prend fin (concentration, durée, retirée), le
 *                                               lanceur utilise l'activité, sa zone centrée sur celle qui tombe (Boule de feu à
 *                                               retardement : la bille explose)
 *     atTurnStart?: { activity }                au début du tour du lanceur, tant que la concentration du sort tient,
 *                                               l'activité est proposée (visée ouverte) : Aura de vitalité (§16.21)
 *     absorb?: { activeAfter?, recharge? }      réserve qui absorbe les dégâts avant les PV (§16.11, B14 : Égide
 *                                               arcanique) : ses PV sont les utilisations de l'item ; `activeAfter` = id
 *                                               de l'activité qui la crée (sans utilisation dépensée, pas de réserve) ;
 *                                               `recharge: { school, perLevel }` = un sort de cette école lancé avec un
 *                                               emplacement lui rend `perLevel` × le niveau de l'emplacement
 *     ranges?: { <id d'activité>: { value, units } | { units: "self" } }
 *                                               la portée de la règle quand les données de dnd5e disent autre chose (Trait
 *                                               ensorcelé : « personnelle » dans les données, 18 m au PHB 2024)
 *     tether?: { attack, activity, range }      lien avec la créature visée par l'activité `attack`, touchée ou ratée (§16.43,
 *                                               Trait ensorcelé) : l'activité `activity` ne vise qu'elle (début de tour,
 *                                               menu du clic droit) ; au-delà de `range` ou derrière un abri total, la
 *                                               concentration tombe
 *     damageShield?: { effects | worn, formula, oncePerTurn? }
 *                                               le porteur d'un effet de l'item (`effects` : id du profil → type de dégâts)
 *                                               réduit les dégâts de ce type de `formula` (Résistance, §16.46) ; `worn` (un type de
 *                                               dégâts) : le porteur de l'item lui-même, équipé (et harmonisé s'il le faut) — un
 *                                               anneau qui « réduit les dégâts de froid subis de 2d8 » (§65)
 *     breaksOn?: ("attack"|"damage"|"spell")[] les effets de l'item cessent quand leur porteur fait un jet d'attaque, inflige des
 *                                               dégâts ou lance un sort (Invisibilité, §16.47)
 *     noReactions?: true                        le porteur d'un effet de l'item ne peut pas prendre de Réaction (Tentacules de
 *                                               Hadar, §16.47)
 *     actionOrBonus?: true                      le porteur d'un effet de l'item ne prend qu'une action OU une action Bonus à son
 *                                               tour, pas les deux (§77 : Nuage fétide du Dretch, Lenteur)
 *     potionEffect?: <id d'effet>                le sort que la potion fait lancer ne pose que cet effet (§53 : Croissance →
 *                                               « agrandir » d'Agrandissement/rapetissement, Rapetissement → « rapetisser »)
 *     effectStatuses?: { <id d'effet>: string[] }  §96 : états ajoutés à cet effet de l'item quand il est posé (Esprit couard :
 *                                               l'effet « Frightened » de la donnée n'a pas l'état)
 *     effectChanges?: { <id d'effet>: [{ key, type, value, replace? }] }
 *                                               changements ajoutés à cet effet de l'item quand il est posé (§53 : Vol, Escalade —
 *                                               les données ne donnent pas la vitesse) ; `value: "@walk"` = la vitesse au sol du porteur ;
 *                                               `replace` : remplace le changement de même clé que porte déjà l'effet (§195 : Pattes
 *                                               d'araignée, dont la formule ne donne pas la Vitesse)
 *     castTargets?: true                        le sort que la potion fait lancer vise normalement (§53 : Amitié avec les animaux —
 *                                               « vous pouvez lancer le sort » sur une bête), au lieu du buveur
 *     curesAll?: string[]                       l'utilisation fait cesser TOUS ces états sur la cible (§53 : Élixir de santé,
 *                                               Potion de vitalité ; « exhaustion » remet l'Épuisement à zéro)
 *     cures?: string[]                          l'utilisation fait cesser UN de ces états sur la cible, au choix (Restauration
 *                                               partielle, §16.47)
 *     advantageIfFighting?: true                avantage à la sauvegarde de la cible si elle est en combat contre le lanceur
 *                                               ou ses alliés (Charme-personne, §16.47)
 *     emanation?: { on, affects?, sees?, radius?, radiusFormula?, units?, activity?, whileActive? }
 *                                               aura de monstre qui agit (§18.11, M7) : à la fin du tour du porteur
 *                                               (`on: "ownTurnEnd"`, Aura de feu) ou au début du tour d'une créature qui s'y
 *                                               trouve (`"turnStart"`, Puanteur), l'activité de l'item (défaut : la première
 *                                               sauvegarde, dégâts ou attaque) joue sur elle. Rayon : le gabarit ou la portée
 *                                               de l'activité ; `affects: "enemy"` : « de son choix » ; `sees` : la créature
 *                                               doit voir le porteur. Le texte anglais dit le reste (core/emanation.mjs) ;
 *                                               §92 : `radiusFormula` (lue sur le porteur, avec `units` : l'Aura de protection
 *                                               du Paladin) ; `whileActive` : seulement tant qu'un effet de l'item est sur le
 *                                               porteur (Ange vengeur)
 *     afterTeleport?: { spells, options: [{ activity, around? }] }
 *                                               §92 : après une téléportation de soi par l'un de ces sorts (identifiants), l'effet
 *                                               supplémentaire au choix de la créature (Foulée des fées) — l'activité utilisée sur
 *                                               elle, ou (`around: "left"|"arrival"`) sur les créatures à 1,50 m de la case
 *                                               quittée ou d'arrivée
 *     regeneration?: true                       Régénération d'un monstre (§18.13) : l'activité de soin de l'item joue au début
 *                                               du tour ; ce qui la coupe et « ne meurt qu'à 0 PV sans régénérer » se lisent
 *                                               dans le texte anglais (core/regeneration.mjs)
 *     fortitude?: true                          Robustesse de la non-vie (MM 2024, §61) : des dégâts qui font tomber le porteur à
 *                                               0 PV lui font jeter une sauvegarde de Constitution (DD 5 + dégâts subis), sauf
 *                                               dégâts radiants ou coup critique ; réussie, il reste à 1 PV (core/fortitude.mjs)
 *     placesSummons?: true                       §109 : l'invocation se place toujours, même quand l'activité dit le contraire
 *                                               (`summon.prompt: false` : case « placer » décochée, que l'utilisation sans
 *                                               fenêtre ne laisse plus cocher — Invocation d'animaux)
 *     sharesSpace?: "enter"|"mutual"            §105 : entre dans la case d'une autre créature et s'y arrête ; "mutual" :
 *                                               l'inverse aussi (Nuée) — par sa présence sur la fiche, ou par l'effet
 *                                               d'un sort (Forme gazeuse ; adapter/space-sharing.mjs)
 *     noOpportunity?: "always"|"flying"|"afterUse"|"whileEffect"
 *                                               ne provoque pas d'attaque d'opportunité (§18.15) : toujours (Agile),
 *                                               tant qu'il porte un effet de l'item (§74, Frappe du zéphyr),
 *                                               en volant (Vol rasant), ou le reste du tour après avoir utilisé l'item
 *                                               (« moves … without provoking Opportunity Attacks », lu dans le texte)
 *     drain?: true                              drain du maximum de PV (§18.16) : « égal aux dégâts [nécrotiques] subis », ou une
 *                                               formule sur une sauvegarde ratée ; le vampire regagne ce qu'il draine — lu
 *                                               dans le texte anglais (core/drain.mjs)
 *     swallow?: true                            Avaler / Engloutir (§18.17) : l'effet de l'item qui porte l'abri total (ou
 *                                               Agrippé) fait de la cible un avalé — posée dans l'avaleur, qui l'emporte ;
 *                                               dégâts à chaque tour, seuil de régurgitation, lus dans le texte anglais
 *                                               (core/swallow.mjs)
 *     saveDamage?: { <id d'activité>: "none"|"half" }  §92 : les dégâts sur une sauvegarde réussie, quand la donnée dit autre chose
 *                                               que la règle (Foulée effroyable : « sous peine de subir 2d10 » — rien sur une réussite)
 *     savedEffects?: string[]                   ids d'effets de l'item posés seulement sur une sauvegarde RÉUSSIE (et jamais sur un
 *                                               échec) : Rayon affaiblissant — « sur une réussite, Désavantage à son prochain jet
 *                                               d'attaque » ; les données de dnd5e mettent les deux effets sur l'activité, sans
 *                                               `onSave`
 *     sharedHp?: true                           les créatures de la scène qui portent un item de cet identifiant partagent leurs PV
 *                                               (§19.5 : tout dégât subi par un membre est retiré des PV communs) —
 *                                               l'écart subi par l'une est reporté sur les autres (core/coven.mjs)
 *     secondPhase?: { activity }                à 0 PV, pas de Mort : l'activité « transform » de l'item (id) change la créature dans
 *                                               la forme de son profil, à ses PV max, même token (même initiative), états gardés
 *                                               (§19.5 : seconde phase)
 *     changesForm?: { activity, keepHp? }       à l'utilisation de cette activité « transform » (id), la créature prend la forme de son
 *                                               profil comme une seconde phase (même token, PV max de la forme, états gardés sauf
 *                                               `keepConditions: false`) — une vraie forme révélée à volonté (§76) ; `keepHp` (§78, ici et dans
 *                                               `secondPhase`) : la forme garde les PV actuels (« son profil reste le même
 *                                               dans chaque forme » : un lycanthrope), à 0 PV compris
 *     failMargins?: { <id d'effet>: { min?, max? } }
 *                                               l'effet de l'activité de sauvegarde ne va qu'à qui l'a ratée de `min` ou plus (et de
 *                                               `max` au plus) : « si une créature rate le jet de 5 ou plus, elle est aussi
 *                                               Effrayée » (§19.6) ; une étape d'issue le dit par `margin`
 *     orders?: string[]                         ordres au choix de l'auteur, imposés à qui rate la sauvegarde, joués à son tour
 *                                               (Injonction : approach, drop, flee, grovel, halt — core/orders.mjs, §16.59)
 *     resize?: { <id d'effet>: <crans> }        l'effet change la taille de celui qui le reçoit de ce nombre de catégories
 *                                               (+1 : Agrandissement, -1 : Rapetissement, §16.58) ; dnd5e redimensionne le token
 *     reactions?: { perRound }                  réactions par round, pas plus d'une par tour de jeu (par exemple trois)
 *     lastStand?: { threshold }                 réaction quand les PV tombent à `threshold` ou moins (fait `target.hpAtMost`) : ses
 *                                               effets tombent ; à 0 PV, jouée d'office, la créature reste à 1 PV (Amulette de
 *                                               Ravenloft) — l'item a des utilisations, une par fois
 *     forOneAttack?: true                       les effets que l'item pose sur son porteur ne valent que pour l'attaque qui a ouvert la
 *                                               réaction : retirés sitôt la CA relue (Parade : « +5 à sa CA contre une attaque »)
 *     basicActions?: { <id d'activité>: "dash"|"disengage"|"dodge"|"hide" | [...] | { choose: [...] } }
 *                                               l'activité prend cette action de base, au coût de son activation (Pas rapide : Foncer
 *                                               ou Se désengager par une action Bonus ; Ruse du Roublard : Se cacher aussi, §20) ;
 *                                               une liste : toutes à la fois (Défense patiente) ; `{ choose }` : une seule, au choix de
 *                                               l'auteur à l'utilisation (Échappée agile : Se désengager OU Se cacher, §65)
 *     ignoresCloseCombat?: true                 le porteur de l'item n'a pas le Désavantage au tir quand un ennemi est au contact
 *                                               (capacité déclarée par un module de créatures tiers)
 *     (aura) whileActive?: true                 l'aura n'est tenue que tant que le lanceur porte un effet de l'item
 *                                               (concentration comprise) : Passage sans trace, §16.47
 *     hitDiceHeal?: { activity, base }          après `activity`, dépenser des dés de vie pour se soigner (`base` dés, +1 par
 *                                               niveau d'emplacement au-delà du sort : Vigueur arcanique, §16.46)
 *     pact?: { damageTypes, ability? }          arme de pacte (§16.45) : le type de dégâts se choisit au pacte parmi
 *                                               `damageTypes` (ou le type normal), les attaques de l'arme lisent `ability`
 *     enchantTarget?: "weapon" | "ownWeapon" (« ownWeapon » : ses propres armes, ou une arme invoquée — §16.45)
 *     enchantTarget (weapon)                  l'enchantement vise l'arme d'une créature choisie (§16.41, Arme élémentaire) :
 *                                               un clic sur la créature (soi compris), puis la liste de ses armes
 *     trace?: true | { activity?, show?, attack? }
 *                                               (§16.41) `activity` : seulement pour cette activité (Lame de feu : « Invoquer
 *                                               une lame », pas l'attaque) ; `show` : l'icône sur le token ; `attack` :
 *                                               l'activité d'attaque offerte au menu du clic droit tant que la trace est là.
 *                                               Une trace d'un sort à concentration tombe avec elle.
 *     trace (true)                              l'utilisation laisse sur le lanceur un effet « trace » (nom, image, durée de
 *                                               l'item) qui porte ses déclarations `via: "effect"` — pour un sort qui
 *                                               ne pose aucun effet (Armure d'Agathys, §16.9)
 *     empower?: { damageType, effect, excludeTypes? }
 *                                               morsure qui renforce (§19.9, Morsure vampirique du Dhampir) : quand l'arme de l'item
 *                                               inflige des dégâts de `damageType` à une créature d'un autre type que `excludeTypes`,
 *                                               et qu'il reste une utilisation à l'item, l'auteur choisit : regagner autant de PV,
 *                                               ou recevoir l'effet `effect` de l'item, ses changements valant ce montant, jusqu'à
 *                                               son prochain jet d'attaque ou de caractéristique (1 minute)
 *     discharge?: { effect, formula, damageTypes, sees? }
 *                                               l'effet `effect` de l'item, posé sur une créature, peut être dépensé par son lanceur
 *                                               quand lui ou un allié (`sees` : qu'il voit) la touche d'un jet d'attaque : l'effet
 *                                               cesse et la cible subit `formula` (données du lanceur), d'un type au choix
 *                                               (Chemin vers la tombe, §19.9)
 *     sneakAttack?: true | { dice?, anyWeapon?, alwaysVs? }
 *                                               Attaque sournoise (§20) : une fois par tour, les dés de l'item (sa première part de
 *                                               dégâts, sinon ⌈niveau de roublard / 2⌉d6) s'ajoutent à une attaque qui touche avec une
 *                                               arme de Finesse ou à distance, avec l'Avantage ou un allié à 1,50 m de la cible ;
 *                                               objet (§72, PNJ) : `dice` (« 5d6 »), `anyWeapon` (toute arme), `alwaysVs` (types de
 *                                               créature contre lesquels ni Avantage ni allié ne sont requis : ["undead"])
 *     sneakBonus?: { formula, firstRound? }     une part de plus quand l'Attaque sournoise touche (du type de l'arme) ; `firstRound` :
 *                                               seulement au premier round du combat (Assassinat : « égaux à votre niveau de Roublard »)
 *     cunningStrikes?: { <clé>: { cost, activity?, requires?, sizeAtMost?, withdraw?, keepsHidden? } }
 *                                               Frappes rusées (§20) : effets payés en dés d'Attaque sournoise, choisis par l'auteur
 *                                               avant ses dégâts ; `activity` : la sauvegarde de l'item jouée sur la cible après les
 *                                               dégâts ; `requires` : identifiant d'un item que l'auteur doit avoir (trousse
 *                                               d'empoisonneur) ; `sizeAtMost` : taille maximale de la cible ; `withdraw` : l'auteur
 *                                               se déplace de la moitié de sa Vitesse sans provoquer d'attaque d'opportunité
 *     cunningStrikeMax?: number                 nombre de Frappes rusées par Attaque sournoise (Frappe rusée améliorée : 2)
 *     evasion?: true                            Dérobade (§20) : sauvegarde de Dextérité pour la moitié des dégâts — rien sur une
 *                                               réussite, la moitié sur un échec ; pas si le porteur est Neutralisé
 *     elusive?: true                            Insaisissable (§20) : aucun jet d'attaque n'a l'Avantage contre le porteur, sauf
 *                                               s'il est Neutralisé
 *     holdsStill?: true                         après l'utilisation, la Vitesse de l'utilisateur est 0 jusqu'à la fin du tour (Visée
 *                                               stable, §20)
 *     grantsAction?: true                       l'utilisation donne une action de plus au budget du tour (Fougue, §21)
 *     movesAfter?: string | { item, disengage? } après une utilisation par action Bonus de l'item de cet identifiant, la moitié de la
 *                                               Vitesse en déplacement de plus, sans attaque d'opportunité (Décalage tactique, §21) ;
 *                                               `disengage: false` : sans rien sur les attaques d'opportunité (Bond instinctif, §22)
 *     rage?: { effect }                         la Rage du Barbare (§22) : l'effet de l'item qui la porte ; le moteur tient sa durée
 *     persistentRage?: true                     la Rage n'a pas à être entretenue, et seul Inconscient y met fin (§22)
 *     reckless?: true                           Témérité (§22) : à la première attaque de Force du tour, le choix d'attaquer avec témérité
 *     relentless?: { activity }                 Rage implacable (§22) : à 0 PV en Rage, la sauvegarde de l'item (id) ; réussie, 2 × le
 *                                               niveau de Barbare en PV
 *     studiedAttacks?: true                     un jet d'attaque raté donne l'Avantage au prochain contre la même créature, jusqu'à la
 *                                               fin du prochain tour (Attaques avisées, §21)
 *     heroicWarrior?: true                      en combat, l'Inspiration héroïque au début de son tour s'il ne l'a pas (§21)
 *     greatWeaponFighting?: true                dés de dégâts d'une arme de corps à corps à deux mains : 1 et 2 comptent 3 (§21)
 *     thrownDamage?: number                     bonus aux dégâts d'une attaque à distance avec une arme de lancer (§21)
 *     effectEnds?: { <id d'effet> | "status:<état>": "casterTurnStart"|"casterTurnEnd"|"bearerTurnStart"|"bearerTurnEnd" }
 *                                               (`status:stunned` : l'état posé par une étape `status` de l'item, §157)
 *                                               l'effet de l'item tombe au début du prochain tour du lanceur, à la fin de son prochain
 *                                               tour, au début ou à la fin du prochain tour du porteur (Rayon de givre, Contact
 *                                               glacial, §23 ; léthargie de Hâte, §42.2)
 *     actionEnds?: { <id d'effet>: { by: "bearer"|"other", roll?: "save"|"check", verb?: "wake", status?: "prone" } }
 *                                               une action fait cesser cet effet de l'item (§43.2) — `by: "bearer"` : le
 *                                               porteur (`roll: "save"` : il rejoue la sauvegarde du sort, Danse irrésistible
 *                                               d'Otto ; `roll: "check"` : le test écrit dans le texte de l'item ; sans `roll` :
 *                                               l'effet tombe, Forme gazeuse) ; `by: "other"` : une autre créature au contact
 *                                               (sans `roll` : secouer un dormeur — `verb: "wake"` pour le libellé ; `roll:
 *                                               "check"` : Frappe piégeuse) ; `status` : l'état que le porteur se donne en y mettant fin (§49,
 *                                               feu grégeois : « en vous infligeant l'état À terre »)
 *     endsWhen?: { armor?: "any"|"heavy", apart?: { distance, units, at?: "move"|"casterTurnEnd" }, zeroHp?: true,
 *                  unaffected?: "failedSave"|"noHits"|"noTargets", spell?: true }
 *                                               §258 : fins génériques (core/endings.mjs, runtime/endings.mjs) — l'effet de l'item
 *                                               cesse quand son porteur enfile une armure (`heavy` : lourde ; Armure du mage, Rage),
 *                                               quand porteur et lanceur sont séparés de plus de `apart` (à chaque déplacement, ou
 *                                               à la fin du tour du lanceur : Lien de garde, Duel forcé), quand l'un des deux tombe à
 *                                               0 PV (`zeroHp`) ; `unaffected` : l'utilisation n'a affecté personne, la
 *                                               concentration tombe (réglage `endUnaffected`) ; `spell` : la fin vaut pour tout le
 *                                               sort (sa concentration, ou ses effets sur chaque créature), pas pour ce seul porteur
 *     effectThen?: { <id d'effet>: <id d'effet> }
 *                                               quand le premier effet de l'item cesse sur une créature, le second y est posé
 *                                               (Hâte : « quand le sort prend fin, la cible est Neutralisée… », §42.2)
 *     blocksHealing?: true                      le porteur d'un effet de l'item ne regagne pas de PV (Contact glacial, §23)
 *     noOpportunityAttacks?: true               le porteur d'un effet de l'item ne fait pas d'attaque d'opportunité (Poigne électrique)
 *     byWounds?: { healthy, wounded }           deux activités (ids) : les dégâts sont ceux de `wounded` contre une cible blessée,
 *                                               de `healthy` sinon, quelle que soit celle utilisée (Glas, §23)
 *     oneAttack?: true                          l'enchantement de l'item vaut pour une attaque : l'attaque est offerte aussitôt, et
 *                                               l'enchantement tombe après elle (Frappe assurée, §23)
 *     martialArts?: true                        Arts martiaux (§24) : une frappe à mains nues peut se payer de l'action Bonus
 *     flurry?: { activity, strikes, weapons? }  Déluge de coups (§24) : l'activité ouvre `strikes` frappes à mains nues gratuites ;
 *                                               `weapons` : des attaques d'arme aussi (Prêtre de guerre, §27)
 *     stunningStrike?: { activity, focus }      Frappe étourdissante (§24) : après un coup, une fois par tour, la sauvegarde de l'item
 *                                               contre une utilisation de l'item `focus` (identifiant)
 *     openHand?: { addle, push, topple }        Technique de la main ouverte (§24) : après un coup du Déluge, l'une des trois activités
 *     smite?: { damage, fiends?, save?, effect?, ranged?, burst? }
 *                                               sort de châtiment (§25) : proposé au jet de dégâts d'un coup au corps à corps, ses dés
 *                                               (activité `damage`, ou `fiends` contre un Fiélon ou un Mort-vivant) s'ajoutent au jet,
 *                                               puis la sauvegarde `save` joue sur la cible ; `effect` : l'effet de l'item posé sur
 *                                               la cible touchée, sans sauvegarde (brûlure du Châtiment de fournaise, §42.2)
 *     healsDownedMax?: true                     le porteur de l'item soigne au maximum des dés une créature à 0 PV, avec un sort ou
 *                                               une Conduit divin (Retour à la vie du Domaine de la Tombe, §19.9)
 *     dispel?: true                             Dissipation de la magie (§37.2) : les sorts en cours sur les cibles cessent —
 *                                               d'office jusqu'au niveau 3 ou à celui de l'emplacement, sinon par un test de
 *                                               la caractéristique d'incantation contre DD 10 + niveau (core/dispel.mjs)
 *     counter?: { level? }                      contresort à la manière de 2014 (§66, SRD 5.1) : l'item, utilisé en réaction à la
 *                                               porte `castsSpell`, fait échouer d'office un sort de niveau `level` ou moins (défaut :
 *                                               le niveau de l'item) ; au-delà, test de la caractéristique d'incantation de celui
 *                                               qui contre, DD 10 + le niveau du sort (core/counter.mjs) — pas de sauvegarde du lanceur
 *     contest?: { activity?, skill, against, effect, exclusive? }
 *                                               test en opposition (§72, Combat perspicace) : l'auteur jette `skill`, la cible la
 *                                               meilleure de `against` (chez son joueur s'il est connecté) ; gagné, l'effet `effect`
 *                                               de l'activité est posé sur elle (`exclusive` : ceux posés ailleurs tombent)
 *     zoneCharges?: n                           la zone qui dure tombe après n déclenchements (§75, Cordon de flèches : 4)
 *     pendingDie?: { activity, against: "melee"|"target" }  §89 : l'activité promet son dé au prochain jet de dégâts d'une
 *                                               attaque de l'auteur ce tour-ci, au corps à corps ou contre la cible désignée (Fente,
 *                                               Feinte du Maître de guerre ; runtime/maneuver-dice.mjs)
 *     rolledAc?: { activity, effect, to? }      §89 : l'activité lance le dé de son `roll` et pose l'effet de l'item sur l'auteur, le
 *                                               bonus de CA écrit dedans (Jeu de jambes évasif) ; §90 `to: "choose"` : sur l'auteur
 *                                               ou sur la créature visée, au choix de l'auteur (Chassé-croisé)
 *     swapPlaces?: { activity }                 §90 : l'activité échange les places de l'auteur et de la créature visée (Chassé-croisé :
 *                                               1,50 m de déplacement de l'auteur, sans attaque d'opportunité)
 *     sweep?: { activity }                      §90 : après un coup au corps à corps (arme, mains nues), l'auteur peut infliger le dé
 *                                               de l'activité, du type du coup, à une autre créature à 1,50 m de la cible et à son
 *                                               allonge, si le jet l'aurait touchée (Balayage) ; l'activité paie
 *     commandStrike?: { activity }              §90 : l'activité ordonne à la créature visée une attaque d'arme par sa Réaction, son
 *                                               dé promis aux dégâts (Frappe commandée ; avec `replacesAttack`)
 *     selfZone?: { <id d'activité>: { type, size, units } }  le gabarit d'une activité qui n'en a pas dans la donnée (§86,
 *                                               Présence royale de Yolande : émanation de 10 ft sur soi) — posé d'office (§47) ;
 *                                               §91 : hors de portée personnelle, posé à la souris (Interdiction)
 *     zoneAffects?: "enemy"|"ally"              qui la zone de l'item affecte, quand la donnée ne le dit pas (§86 : « une
 *                                               créature que vous voyez… vous pouvez la forcer » — les alliés épargnés)
 *     noDamage?: [ids d'activité]               le moteur ne lance pas les dégâts de ces activités (§81, Frappe piégeuse : la
 *                                               donnée en met sur la sauvegarde, le texte n'en donne qu'au début des tours)
 *     wardsAtZero?: true                        l'effet du sort fait tomber à 1 PV au lieu de 0, puis prend fin (§73,
 *                                               Protection contre la mort)
 *     stableAtZero?: true                       une cible que l'attaque fait tomber à 0 PV est Stabilisée : ni jet contre
 *                                               la mort ni mort, même un PNJ (§71, Dague des ombres du Familier de vampire)
 *     effectsIf?: condition                     les effets de l'attaque ne passent que si la condition tient pour la cible,
 *                                               jugée après les dégâts (§71 : `{ "target.atZero": true }`)
 *     storm?: { bonus? }                        orage (§70, Appel de la foudre) : la zone de l'item est un nuage qui
 *                                               reste (concentration) ; chaque lancement vise un éclair (`bolt`) dessous ;
 *                                               `bonus` : dés ajoutés quand l'orage était déjà là (question à l'incantation)
 *     difficultTerrain?: { types?, cost? }      la zone du sort est un terrain difficile (§69) — `cost` (§172) : un autre
 *                                               multiplicateur que ×2 (Mur d'épines : ×4), par le comportement « coût de
 *                                               déplacement » du cœur V14 à la place de celui de dnd5e ; sinon comportement
 *                                               `dnd5e.difficultTerrain` posé sur la région si les données ne l'ont pas
 *                                               (Manuel des joueurs premium : Enchevêtrement, Croissance d'épines…) ; magique ;
 *                                               `lingers: "casterNextTurnEnd"` (§261) : une zone instantanée laisse ce
 *                                               terrain jusqu'à la fin du prochain tour du lanceur (Tempête de grêle)
 *     encloses?: true                           §232 : un effet de cet item enferme sa cible (Sphère résiliente d'Otiluke) — rien ne
 *                                               l'atteint du dehors, elle n'atteint rien dehors (résolutions « non affecté », clics refusés).
 *     willingFails?: true                       §232 : une créature consentante peut rater la sauvegarde d'office — le lanceur dit, à
 *                                               l'ouverture, si chaque cible non ennemie consent (pas de jet).
 *     zoneEffects?: true                        les effets de l'activité sont portés tant qu'on est dans sa zone (§37.4,
 *                                               Silence) : comportement `applyActiveEffect` du cœur (adapter/zone-effects.mjs)
 *     rollBonus?: { activity, on, skills? }     un dé que la créature ajoute à SON jet, après l'avoir vu (§38, Chance du
 *                                               ténébreux) : le jet de l'activité (`roll.formula`), qui dépense ses consommations ;
 *                                               `on` : "save" (ratée, lue par le moteur), "attack" (ratée, §90 Attaque précise),
 *                                               "check" (tout test, sitôt lancé), "initiative" (§90) ; `skills` : les seules
 *                                               compétences dont le test compte (Embuscade : ["ste"]) ; §94 `statuses` : une
 *                                               sauvegarde seulement pour éviter ou finir l'un de ces états (Survivant) ;
 *                                               §129 `luck: true` — pas de dé de l'activité : le d20 est relancé et le meilleur
 *                                               gardé (Chanceux : l'Avantage, décidé après avoir vu le jet) ; s'ajoute l'écart positif ;
 *                                               relevé des trous `reroll: { bonus, during }` — sans activité : le d20 relancé, `bonus`
 *                                               ajouté, le nouveau jet imposé, une fois par effet de l'item `during` (Concentration
 *                                               fanatique : sauvegarde ratée en Rage, bonus des dégâts de Rage)
 *     transpose?: { summon }                    échanger sa place avec l'invocation pilotée de l'item `summon` (identifiant),
 *                                               quand l'action Bonus la crée ou la déplace (§38.2, Troc du filou ; core/pilot.mjs)
 *     portent?: { dice }                        Présage (§36) : `dice` d20 notés à chaque Repos long (Présage : 2 ; Présage
 *                                               supérieur : 3), qui peuvent remplacer un Test d20 (core/portent.mjs)
 *     metamagic?: { activity, kind }            option de Métamagie (§32) : l'activité retient `kind` pour le prochain sort de
 *                                               l'ensorceleur (`METAMAGIC_KINDS`)
 *     endurance?: true                          Acharnement (§31) : tombé à 0 PV sans être tué sur le coup, le porteur reste à 1 PV,
 *                                               une utilisation de l'item dépensée
 *     replacesAttack?: true | string[]          l'activité remplace une attaque de l'action Attaquer (Souffle, §31) ; une liste : ces
 *                                               activités seulement (§188, Huile : le lancer, pas l'étalage au sol)
 *     hitRider?: { damage?, effect?, status?, sizeAtMost?, slot?, weapon?, oncePerTurn?, save?, item?, whileActive? }
 *                                               faveur proposée au jet de dégâts d'une attaque qui touche, contre une
 *                                               utilisation de l'item (Ascendance gigante, §31) : les dés de l'activité
 *                                               `damage`, puis l'effet `effect` de l'item ou l'état `status` posés sur la
 *                                               cible (de taille `sizeAtMost` au plus — les dégâts valent quelle que soit la taille).
 *                                               `slot: "pact"` : coûte un emplacement de pacte au lieu d'une utilisation (dés
 *                                               lus au niveau de l'emplacement) ; `weapon` : seulement avec une arme enchantée
 *                                               par l'item de cet identifiant (« pact-of-the-blade ») ; `oncePerTurn` (Frappe
 *                                               occulte, §47 bis) ; §78 : `save` — l'activité de sauvegarde de l'item,
 *                                               jouée ensuite contre la cible encore debout ; `item` — seulement avec
 *                                               l'arme de cet identifiant ; §129 `unarmed` — seulement une attaque à mains nues ;
 *                                               `push` — la cible touchée est repoussée de `{ distance, units }` (Bagarreur de
 *                                               tavernes) ; §132 `melee`, `shield` (bouclier équipé), `damageType` (l'attaque en
 *                                               inflige), `sizeAbove` (cible d'au plus N tailles de plus) ; un item sans maximum d'utilisations se
 *                                               propose sans compter (Piqué : au MJ de juger la trajectoire) ; §87 : `pays` —
 *                                               l'identifiant de l'item dont une utilisation paie la faveur (les manœuvres : les dés
 *                                               de `combat-superiority`) ; `weaponDamage` — les dés ont le type de dégâts de l'arme ;
 *                                               une faveur à `sizeAtMost` ne joue sa sauvegarde que contre une cible assez petite
 *     cellWall?: true                           §172 : mur d'une case d'épaisseur (Mur d'épines, Barrière de lames) — posé sur une
 *                                               rangée de cases (centres, sans diagonale, bouts prolongés d'une demi-case) ; son
 *                                               anneau, tiré d'un disque, est une bande à l'intérieur du cercle
 *     coverThrough?: degré | { degree, against }  §172 : la zone donne cet abri (« half », « threeQuarters », « total ») à qui est
 *                                               derrière elle (une ligne entre l'attaquant et la cible qui la traverse, ni l'un ni
 *                                               l'autre dedans) — Barrière de lames ; `against: "rangedWeapon"` (§173) : contre les
 *                                               seules attaques à distance avec une arme (Mur de vent : les projectiles ratent)
 *     thinWall?: true                           §173 : un mur fin (Mur de vent, de pierre, de glace, de force, prismatique) — posé
 *                                               sans diagonale ; à l'apparition, les créatures dont l'espace touche le mur sont dans la
 *                                               zone ; on y « entre » en le traversant ; le disque d'un globe devient un anneau fin
 *     wallAura?: { distance, units, activity, on }  §173 : une zone de `distance` des deux côtés du mur, qui rejoue l'activité sœur
 *                                               aux moments `on` (Mur prismatique : sauvegarde d'aveuglement à 6 m)
 *     wallSide?: { distance, units }          §169 : mur à face brûlante (Mur de feu) — posé sans diagonale ; à l'apparition, sauvegarde
 *                                               des créatures dont l'espace touche le mur ; ensuite, sans sauvegarde : qui le traverse
 *                                               (une fois par tour), qui finit son tour à `distance` du côté brûlant (région à part,
 *                                               retournable depuis le menu du lanceur)
 *     pointWall?: false                         §162 : un gabarit « wall » qui n'est pas un mur (portails, portes) — pas de pose par points
 *     walls?: { move?: false, sight?: true, activities? }  §162 : la zone posée par l'item lève des murs du cœur (le long d'un mur posé
 *                                               par points, sinon sur son pourtour) : ils arrêtent le déplacement (sauf `move: false`) et,
 *                                               avec `sight`, la vue et la lumière ; `activities` : seulement les zones de ces activités
 *     blink?: <id d'effet>                        §161 : Clignotement — l'effet du sort porte la durée ; 1d6 en fin de tour, 4–6 : Éthéré
 *                                               jusqu'au début du tour suivant (runtime/blink.mjs)
 *     globe?: { radius, units, maxLevel, everywhere? }  §161 : tant que le lanceur porte un effet de l'item, un sort de niveau `maxLevel`
 *                                               ou moins lancé de l'extérieur de l'Émanation n'y affecte personne (Globe d'invulnérabilité) ;
 *                                               §163 `everywhere` : d'où qu'il soit lancé, et aucun sort ne s'y lance (Champ antimagie)
 *     recastCost?: "bonus"|"action"             §164 : le coût d'une relance pendant la concentration (Vif carquois : une action Bonus)
 *     levitate?: { effect, height, units }      §164 : le porteur de l'effet s'élève de `height` à la pose, redescend quand il tombe (Lévitation)
 *     prismatic?: { indigo, violet }            §164 : un d8 par cible choisit la couleur — 1 à 5 : le type des dégâts (feu, acide,
 *                                               foudre, poison, froid) ; 6 : l'effet `indigo`, 7 : l'effet `violet`, sans dégâts ; 8 : deux
 *                                               rayons (Embruns prismatiques) ; `all` (§173) : toutes les couches à la fois (Mur
 *                                               prismatique traversé) ; `activities` : seulement pour ces activités
 *     barrier?: { radius, units, exceptTypes? }  §163 : une créature (hors `exceptTypes`) n'entre pas dans l'Émanation, ni n'y frappe au
 *                                               corps à corps sans allonge (Coquille antivie, adapter/barriers.mjs)
 *     seesInvisible?: true                      §161 : le porteur d'un effet de l'item voit les créatures Invisibles (Détection de
 *                                               l'invisibilité) — vision simulée et état forfaitaire de l'attaque
 *     hpTiers?: [{ atMost?, damage?: false, effects?, statuses? }]
 *                                               §160 : l'issue selon les PV de la cible AVANT les dégâts — le premier palier qui tient
 *                                               (`atMost` absent : tous) ; aucun : ni dégâts ni effet. `damage: false` : pas de dégâts ;
 *                                               `effects` : seuls ces effets de l'activité ; `statuses` : états posés (« dead » : PV à 0)
 *     endsCurses?: string[]                     §160 : l'utilisation fait cesser sur la cible les effets venus d'items de ces
 *                                               identifiants (Délivrance des malédictions : Malédiction, Maléfice)
 *     tempHpPool?: number                       §160 : autant de PV temporaires partagés à parts égales entre les cibles (Mot de pouvoir
 *                                               fortifiant : 120)
 *     revivesFull?: true                        §160 : la cible revient à son maximum de PV (Résurrection, Résurrection suprême)
 *     noActions?: <id d'effet>                    §158 : le porteur de cet effet de l'item n'a ni action ni action Bonus (Nuage nauséabond)
 *     limitedAction?: <id d'effet>                §157 : le porteur de cet effet de l'item a, à chacun de ses tours, une action limitée (Hâte :
 *                                               une seule attaque d'arme, Foncer, Se désengager ou Se cacher) — core/turn.mjs
 *     saveDisadvantageFor?: string[]            §157 : les cibles de ces types de créature font la sauvegarde de l'item avec le Désavantage
 *                                               (Fracassement : « construct »)
 *     halfOnMiss?: true                         §157 : l'attaque de l'item ratée inflige la moitié de ses dégâts, sans effet (Flèche acide de
 *                                               Melf : « sur un échec, la moitié des dégâts initiaux seulement ») — comme le Sort mineur appuyé
 *     potentCantrip?: true                      Sort mineur appuyé (§28) : un tour de magie à dégâts du porteur, raté ou sauvegardé, fait
 *                                               la moitié des dégâts, sans effet
 *     sculptSpells?: true                       Façonneur de sorts (§28) : dans un sort d'Évocation à sauvegarde du porteur, jusqu'à
 *                                               1 + son niveau alliés réussissent d'office et ne subissent rien
 *     supremeHealing?: true                     le porteur soigne au maximum des dés avec un sort ou une Conduit divin (§27)
 *     stabilizes?: true                         utiliser l'item stabilise la cible à 0 PV, sans test (trousse de soins, §50)
 *     carriedLight?: { bright, dim, units, angle?, animation?, burn?, fuel? }
 *                                               une source de lumière que l'on porte (§52 : lampe, lanternes, torche, bougie) —
 *                                               son activité utilitaire l'allume ou l'éteint ; `angle` : un cône (lanterne sourde)
 *     kindles?: true                            l'item allume ou éteint une source portée, au choix (boîte à amadou, §52)
 *     scatter?: true                            §187 : un objet qu'on répand au sol (chausse-trapes, billes) — sa zone dure sans durée,
 *                                               n'agit pas à la pose, arrête qui y entre sur sa première case et se ramasse hors combat
 *     flammable?: { damage, type, rounds, seconds, on, ground?, frees? }
 *                                               §188 : la zone de l'item s'embrase (dégâts de feu reçus dedans, zone de feu posée dessus,
 *                                               flamme portée au contact) et brûle `rounds` rounds — jusqu'à la fin du même tour — ou
 *                                               `seconds` hors combat : `damage` de `type` aux moments `on`, une fois par tour, puis elle
 *                                               disparaît ; `ground` : la zone reste au sol jusque-là (Huile, sans durée) ; `frees` : l'état
 *                                               qu'elle posait tombe avec elle (Toile d'araignée)
 *     climbsCeilings?: true                     §194 : l'item (ou l'effet qu'il a posé) donne la marche au plafond
 *     grantsSpeeds?: { <vitesse>: "walk" | number }
 *                                               §195 : le porteur a cette vitesse (« égale à votre Vitesse » : "walk"), par un effet que
 *                                               le MJ actif tient sur l'acteur tant que l'item y est — les données n'en ont pas (Athlète)
 *     climbsOnTurn?: true                       §195 : « Courir sur le mur » — surfaces verticales pendant son tour, sans test, sans
 *                                               armure ni bouclier ; il tombe s'il finit son tour au mur (Mouvement acrobatique)
 *     slippery?: true                           §195 : la zone de l'item est une surface glissante (Graisse, Huile)
 *     notOnSlippery?: true                      §195 : l'item ne donne pas la marche au plafond sur une surface glissante (Pantoufles)
 *     discipleOfLife?: true                    un sort de soin lancé par un emplacement rend 2 + le niveau de l'emplacement de plus à
 *                                               chaque créature soignée (§27)
 *     blessedHealer?: true                      le même sort, s'il soigne une autre créature, rend 2 + le niveau au lanceur (§27)
 *     targets?: { types?, unaffectedIf? }       qui l'action peut affecter (§16.8) : `types` = types de créature permis
 *                                               (« un Humanoïde ») ; `unaffectedIf` = condition (faits du moment, la
 *                                               cible en `target`) qui la laisse hors d'atteinte (Sommeil : immunité
 *                                               à l'Épuisement) — ni sauvegarde, ni dégâts, ni effet
 *   }
 *
 * Les ÉTAPES d'une déclaration (SPEC §16, une brique chacune) :
 *   { type: "use", target?: "source", activity? }        réaction : proposer l'activité de réaction
 *   { type: "replay", activity? }                        zone qui dure : rejouer l'activité (ou une sœur, par id)
 *   { type: "damage", formula, damageType }              dégâts bonus ; damageType "weapon" = celui de l'arme
 *   { type: "damage", to: "source", formula?, damageType?, activity? }
 *                                                        riposte (§16.9, B9 : moment isHit) : l'attaquant subit ces
 *                                                        dégâts — une formule et son type, ou l'activité de dégâts
 *                                                        de l'item (id), au niveau où le sort a été lancé
 *   { type: "save", to: "source", activity }             §86, riposte par une sauvegarde (moment isHit) : l'attaquant fait
 *                                                        la sauvegarde de cette activité de l'item, ses effets s'il la
 *                                                        rate (Aura sacrée : Aveuglé)
 *   { type: "move", mode: "push"|"pull", distance, units }   déplacement forcé de la cible (moments hit, failedSave) ;
 *                                                        `distance` : un nombre, ou une formule lue sur la source
 *                                                        (« 5 + 5 * @flags.dnd5e.summon.mod », Main puissante) ;
 *                                                        `follow: true` : la source suit la cible (même décalage)
 *   { type: "status", status }                           état natif posé sur la cible (moments hit, failedSave)
 *   { type: "breakConcentration" }                       §91 : la concentration de la cible est rompue (moments hit, failedSave ;
 *                                                        Tremblement de terre)
 *   { type: "mark", mark, label, seconds? }              §54 : une marque posée sur la cible (moments hit, failedSave) — un
 *                                                        effet nommé (`label` : clé de traduction), rattaché à l'item, de
 *                                                        `seconds` secondes (Huile : « couverte d'huile », 1 minute)
 *   { type: "resave", …, tally: { successes, failures, status? } }
 *                                                        §43.1 : compteur — l'effet ne tombe qu'à `successes` réussites ; à
 *                                                        `failures` échecs plus aucune sauvegarde n'est rejouée, l'effet reste
 *                                                        et reçoit l'état `status` (Pétrification : « petrified »)
 *   { type: "resave", keep?, onFail?, unlessSeesOrigin? } la créature rejoue la sauvegarde ; réussie, l'effet tombe (`keep:
 *                                                        true` : il reste) ; `onFail: "dodge"` : ratée, elle prend l'action
 *                                                        Esquiver (§37, Malédiction : « Cursed Actions ») ;
 *                                                        `unlessSeesOrigin: true` : seulement si elle ne voit pas le lanceur
 *                                                        (Terreur : « termine son tour sans ligne de vue sur vous », §42.2)
 *                                                        (moments startOfTurn, endOfTurn, isDamaged, avec `via: "effect"`)
 *   { type: "consume", side: "target"|"source" }         la marque tombe au premier jet d'attaque qu'elle concerne (§16.12,
 *                                                        B10) : `target` = celle que porte la cible (Rayon traçant : « la
 *                                                        prochaine attaque contre elle ») ; `source` = celle que porte
 *                                                        l'attaquant (Moquerie cruelle : « sa prochaine attaque ») —
 *                                                        moment preAttackRoll, `via: "effect"`
 *   { type: "uncrit" }                                   avec une réaction `use` (isHit, allyIsHit) : si elle est prise, un coup
 *                                                        critique n'est plus qu'un coup (Sentinelle au seuil de la mort, §19.9)
 *   { type: "endCondition" }                             avec une réaction `use` au moment gainsCondition : si elle est
 *                                                        prise, l'état subi cesse (§19.8)
 *   { type: "halve" }                                    avec une réaction `use` au moment isHit : si elle est prise, la
 *                                                        cible ne subit que la moitié des dégâts de l'attaque (§16.11,
 *                                                        B14 : Esquive instinctive)
 *   { type: "damage", to: "origin", formula?, damageType? }
 *                                                        le lanceur de l'effet porté subit des dégâts — sans formule, le
 *                                                        même montant que le porteur vient de subir (isDamaged, via: "effect" :
 *                                                        Lien protecteur, §16.11)
 *   { type: "damage", formula, damageType, onSave? }     à une issue (moments hit, failedSave) : la cible atteinte subit ces
 *                                                        dégâts, lancés par le moteur ; `onSave: "half"` (failedSave) : la
 *                                                        moitié sur une sauvegarde réussie, sinon rien (dégâts « en plus » des
 *                                                        sorts lancés par des créatures d'un module tiers)
 *   { type: "damage", to: "bearer", formula?, damageType?, activity? }
 *                                                        au tour du porteur d'un effet (startOfTurn, endOfTurn, via: "effect") :
 *                                                        il subit ces dégâts — une formule et son type, ou l'activité de dégâts
 *                                                        de l'item, au niveau de lancement (Flèche acide de Melf : « 2d4 dégâts
 *                                                        d'acide à la fin de son prochain tour »)
 *   { type: "lift", height, units }                   §164 : à une issue (failedSave) — la cible monte à `height` d'élévation ; quand
 *                                                        la zone de l'item tombe, elle chute (1d6 contondants par 3 m, 20d6 au plus, À terre)
 *   { type: "disarm" }                                   à une issue (failedSave) : la cible lâche son arme de corps à corps
 *                                                        maniée (dés-équipée) — un désarmement
 *   { type: "use", …, advantage: true }                  la réaction se joue avec l'Avantage (Riposte)
 *   `margin: { min?, max? }` sur une étape d'issue       seulement si la cible a raté de `min` ou plus (Chaîne : À terre à 5)
 *   { type: "remove" }                                   l'effet qui porte la déclaration tombe (§16, B8 : Sommeil,
 *                                                        Motif hypnotique cessent sur dégâts ; avec `via: "effect"`)
 *   { type: "attackBonus", formula }                     ajoutée au jet d'attaque (« -1d4 » : Voile défensif, §16.46 ;
 *                                                        moment preAttackRoll)
 *   { type: "advantage" } · { type: "disadvantage" }     une raison d'avantage ou de désavantage à l'attaque
 *                                                        (moment preAttackRoll ; core/conditions.mjs, `declared`)
 *   { type: "interpose" }                                avec une réaction `use` au moment allyIsDamaged : le réacteur prend les dégâts
 *                                                        à la place de la créature (§78, Interposition d'un garou ; les effets restent à elle)
 *   { type: "absorb" }                                   avec une réaction `use` au moment allyIsDamaged : la réserve du réacteur (clé
 *                                                        `absorb`, Égide arcanique) prend les dégâts de la créature (§38, Égide projetée)
 *   { type: "use", target: "self", activity }          §72 : la réaction vise le réacteur lui-même (Protection contre la mort
 *                                                        lancée par le Bracelet de charme) ; plusieurs `use` d'un même item :
 *                                                        un bouton par activité, nommé d'après elle
 *   { type: "use", target: "source", approach: true }    la réaction rejoint d'abord la source : hors d'allonge, le réacteur
 *                                                        s'en approche jusqu'à sa vitesse, sans attaque d'opportunité (§67,
 *                                                        « se déplacer jusqu'à sa vitesse vers l'attaquant et l'attaquer »)
 *   { type: "use", …, consume: false }                  la réaction s'utilise sans rien consommer d'elle-même (la réserve paie)
 *   { type: "bonus", formula }                           avec une réaction `use` avant le jet d'attaque d'un allié (allyAttacks) :
 *                                                        le dé, lancé en clair, ajouté au jet (Présage cosmique, Fortune)
 *   { type: "ward", activity? }                          l'attaquant doit réussir la sauvegarde de l'item (activité
 *                                                        sœur par id, sinon la première de sauvegarde) ou perd son
 *                                                        attaque (moment isAttacked, avec `via: "effect"`)
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

export * from "./content/enums.mjs";
export { validateEntry, validateTable } from "./content/entry.mjs";
export { mergeEntries } from "./content/merge.mjs";
