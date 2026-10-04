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
 *     aura?: { radius?, units?, affects?, includeSelf?, effect?, radiusFormula?, changes?, types? }
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
 *                                               l'objet à 0 PV aussi. `pulse: { item, radius, units }` : une créature
 *                                               qui finit son tour à `radius` de l'objet subit l'activité de son
 *                                               item `item` (identifiant ; Sphère de feu : « flames ») ; `on` : les
 *                                               moments (turnEnd par défaut ; enter : une créature arrive à portée ;
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
 *     light?: { on, bright?, dim?, units?, darkness?, dispels?, carried?, single? }
 *                                               lumière ou ténèbres du sort (§16.31, core/light.mjs). `on` : « area » = une
 *                                               source sur la zone posée, qui la suit et part avec elle (`darkness: true` :
 *                                               ténèbres magiques du rayon de la zone, qui bloquent la vue comme la brume,
 *                                               sauf vision véritable et Vision du diable ; `dispels: n` : dissipe les
 *                                               ténèbres de niveau ≤ n qu'elle recouvre) ; « effect » = les effets de l'item
 *                                               font briller leur porteur ; « summon » = l'objet invoqué porte sa lumière,
 *                                               `carried` : au lancement, le joueur choisit « au sol » ou « sur moi » (le
 *                                               lanceur brille) et la couleur (§16.35) ;
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
 *     atTurnStart?: { activity }                au début du tour du lanceur, tant que la concentration du sort tient,
 *                                               l'activité est proposée (visée ouverte) : Aura de vitalité (§16.21)
 *     absorb?: { activeAfter?, recharge? }      réserve qui absorbe les dégâts avant les PV (§16.11, B14 : Égide
 *                                               arcanique) : ses PV sont les utilisations de l'item ; `activeAfter` = id
 *                                               de l'activité qui la crée (sans utilisation dépensée, pas de réserve) ;
 *                                               `recharge: { school, perLevel }` = un sort de cette école lancé avec un
 *                                               emplacement lui rend `perLevel` × le niveau de l'emplacement
 *     ranges?: { <id d'activité>: { value, units } }
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
 *     effectChanges?: { <id d'effet>: [{ key, type, value }] }
 *                                               changements ajoutés à cet effet de l'item quand il est posé (§53 : Vol, Escalade —
 *                                               les données ne donnent pas la vitesse) ; `value: "@walk"` = la vitesse au sol du porteur
 *     castTargets?: true                        le sort que la potion fait lancer vise normalement (§53 : Amitié avec les animaux —
 *                                               « vous pouvez lancer le sort » sur une bête), au lieu du buveur
 *     curesAll?: string[]                       l'utilisation fait cesser TOUS ces états sur la cible (§53 : Élixir de santé,
 *                                               Potion de vitalité ; « exhaustion » remet l'Épuisement à zéro)
 *     cures?: string[]                          l'utilisation fait cesser UN de ces états sur la cible, au choix (Restauration
 *                                               partielle, §16.47)
 *     advantageIfFighting?: true                avantage à la sauvegarde de la cible si elle est en combat contre le lanceur
 *                                               ou ses alliés (Charme-personne, §16.47)
 *     emanation?: { on, affects?, sees?, radius?, units?, activity? }
 *                                               aura de monstre qui agit (§18.11, M7) : à la fin du tour du porteur
 *                                               (`on: "ownTurnEnd"`, Aura de feu) ou au début du tour d'une créature qui s'y
 *                                               trouve (`"turnStart"`, Puanteur), l'activité de l'item (défaut : la première
 *                                               sauvegarde, dégâts ou attaque) joue sur elle. Rayon : le gabarit ou la portée
 *                                               de l'activité ; `affects: "enemy"` : « de son choix » ; `sees` : la créature
 *                                               doit voir le porteur. Le texte anglais dit le reste (core/emanation.mjs)
 *     regeneration?: true                       Régénération d'un monstre (§18.13) : l'activité de soin de l'item joue au début
 *                                               du tour ; ce qui la coupe et « ne meurt qu'à 0 PV sans régénérer » se lisent
 *                                               dans le texte anglais (core/regeneration.mjs)
 *     fortitude?: true                          Robustesse de la non-vie (MM 2024, §61) : des dégâts qui font tomber le porteur à
 *                                               0 PV lui font jeter une sauvegarde de Constitution (DD 5 + dégâts subis), sauf
 *                                               dégâts radiants ou coup critique ; réussie, il reste à 1 PV (core/fortitude.mjs)
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
 *     cunningStrikes?: { <clé>: { cost, activity?, requires?, sizeAtMost?, withdraw? } }
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
 *     effectEnds?: { <id d'effet>: "casterTurnStart"|"casterTurnEnd"|"bearerTurnStart"|"bearerTurnEnd" }
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
 *     smite?: { damage, fiends?, save?, effect? }
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
 *     selfZone?: { <id d'activité>: { type, size, units } }  le gabarit d'une activité qui n'en a pas dans la donnée (§86,
 *                                               Présence royale de Yolande : émanation de 10 ft sur soi) — posé d'office (§47)
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
 *     difficultTerrain?: { types?: string[] }   la zone du sort est un terrain difficile (§69) : comportement
 *                                               `dnd5e.difficultTerrain` posé sur la région si les données ne l'ont pas
 *                                               (Manuel des joueurs premium : Enchevêtrement, Croissance d'épines…) ; magique
 *     zoneEffects?: true                        les effets de l'activité sont portés tant qu'on est dans sa zone (§37.4,
 *                                               Silence) : comportement `applyActiveEffect` du cœur (adapter/zone-effects.mjs)
 *     rollBonus?: { activity, on }              un dé que la créature ajoute à SON jet raté, après l'avoir vu (§38, Chance du
 *                                               ténébreux) : le jet de l'activité (`roll.formula`), qui dépense l'utilisation ;
 *                                               `on` : ["save"] et/ou ["check"] (le moteur ne lit que les sauvegardes)
 *     transpose?: { summon }                    échanger sa place avec l'invocation pilotée de l'item `summon` (identifiant),
 *                                               quand l'action Bonus la crée ou la déplace (§38.2, Troc du filou ; core/pilot.mjs)
 *     portent?: { dice }                        Présage (§36) : `dice` d20 notés à chaque Repos long (Présage : 2 ; Présage
 *                                               supérieur : 3), qui peuvent remplacer un Test d20 (core/portent.mjs)
 *     metamagic?: { activity, kind }            option de Métamagie (§32) : l'activité retient `kind` pour le prochain sort de
 *                                               l'ensorceleur (`METAMAGIC_KINDS`)
 *     endurance?: true                          Acharnement (§31) : tombé à 0 PV sans être tué sur le coup, le porteur reste à 1 PV,
 *                                               une utilisation de l'item dépensée
 *     replacesAttack?: true                     l'activité remplace une attaque de l'action Attaquer (Souffle, §31)
 *     hitRider?: { damage?, effect?, status?, sizeAtMost?, slot?, weapon?, oncePerTurn?, save?, item? }
 *                                               faveur proposée au jet de dégâts d'une attaque qui touche, contre une
 *                                               utilisation de l'item (Ascendance gigante, §31) : les dés de l'activité
 *                                               `damage`, puis l'effet `effect` de l'item ou l'état `status` posés sur la
 *                                               cible (de taille `sizeAtMost` au plus — les dégâts valent quelle que soit la taille).
 *                                               `slot: "pact"` : coûte un emplacement de pacte au lieu d'une utilisation (dés
 *                                               lus au niveau de l'emplacement) ; `weapon` : seulement avec une arme enchantée
 *                                               par l'item de cet identifiant (« pact-of-the-blade ») ; `oncePerTurn` (Frappe
 *                                               occulte, §47 bis) ; §78 : `save` — l'activité de sauvegarde de l'item,
 *                                               jouée ensuite contre la cible encore debout ; `item` — seulement avec
 *                                               l'arme de cet identifiant ; un item sans maximum d'utilisations se
 *                                               propose sans compter (Piqué : au MJ de juger la trajectoire)
 *     potentCantrip?: true                      Sort mineur appuyé (§28) : un tour de magie à dégâts du porteur, raté ou sauvegardé, fait
 *                                               la moitié des dégâts, sans effet
 *     sculptSpells?: true                       Façonneur de sorts (§28) : dans un sort d'Évocation à sauvegarde du porteur, jusqu'à
 *                                               1 + son niveau alliés réussissent d'office et ne subissent rien
 *     supremeHealing?: true                     le porteur soigne au maximum des dés avec un sort ou une Conduit divin (§27)
 *     stabilizes?: true                         utiliser l'item stabilise la cible à 0 PV, sans test (trousse de soins, §50)
 *     carriedLight?: { bright, dim, units, angle?, animation? }
 *                                               une source de lumière que l'on porte (§52 : lampe, lanternes, torche, bougie) —
 *                                               son activité utilitaire l'allume ou l'éteint ; `angle` : un cône (lanterne sourde)
 *     kindles?: true                            l'item allume ou éteint une source portée, au choix (boîte à amadou, §52)
 *     discipleOfLife?: true                     un sort de soin lancé par un emplacement rend 2 + le niveau de l'emplacement de plus à
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

import { MOMENTS, OUTCOME_MOMENTS, RESAVE_MOMENTS, BEARER_MOMENTS, TURN_MOMENTS, unknownFacts, normalize, PRE_ATTACK_WINDOWS, DAMAGED_BY } from "./triggers.mjs";
import { CREATURE_TYPES } from "./eligibility.mjs";
import { ORDERS } from "./orders.mjs";
import { LIGHT_ON } from "./light.mjs";
import { EMANATION_MOMENTS } from "./emanation.mjs";

/** Version du schéma. Une surcouche d'une autre version est ignorée avec un avertissement. */
export const CONTENT_VERSION = 1;

export const STEP_TYPES = Object.freeze(["disarm", "use", "replay", "damage", "move", "status", "resave", "remove", "halve", "uncrit", "consume", "advantage", "disadvantage", "ward", "attackBonus", "endCondition", "reduce", "miss", "penalty", "bonus", "absorb", "interpose", "mark", "save"]);
/** Les fenêtres « touché » : la créature touchée elle-même, ou une autre qui réagit pour elle (Sentinelle au seuil de la mort). */
export const HIT_WINDOWS = Object.freeze(["isHit", "allyIsHit"]);
/** Les actions de base qu'une activité peut prendre au coût de son activation (`basicActions`). */
export const BASIC_ACTION_KINDS = Object.freeze(["dash", "disengage", "dodge", "hide", "help"]);   // §72 : « help » (Maître des tactiques)
/** Les tailles de dnd5e, de la plus petite à la plus grande (`actorSizes`). */
export const SIZES = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);
/** Les étapes qui ne valent qu'avant un jet d'attaque (moment preAttackRoll). */
export const ATTACK_STEPS = Object.freeze(["advantage", "disadvantage", "attackBonus"]);
export const MOVE_MODES = Object.freeze(["push", "pull"]);
/** Les destinataires d'une étape `damage` : l'attaquant (riposte), le lanceur de l'effet (partage), le porteur (son tour). */
export const DAMAGE_TO = Object.freeze(["source", "origin", "bearer"]);
/** La part des dégâts d'issue sur une sauvegarde réussie (`damage` au moment failedSave). */
export const DAMAGE_ON_SAVE = Object.freeze(["half", "none"]);
/** Les étapes qui ne s'exécutent qu'à l'application d'une résolution (moments hit, failedSave). */
export const OUTCOME_STEPS = Object.freeze(["move", "status", "disarm", "mark"]);
export const VIA = Object.freeze(["effect"]);
export const AURA_AFFECTS = Object.freeze(["ally", "enemy", "any"]);
/** §16.47 : ce que fait le porteur d'un effet `breaksOn` pour le faire cesser. */
export const BREAK_MOMENTS = Object.freeze(["attack", "damage", "spell", "save"]);
/** Quand un effet d'item prend fin (`effectEnds`, §23) : au début ou à la fin du prochain tour du lanceur, au début ou à la fin du prochain tour du porteur. */
export const EFFECT_ENDS = Object.freeze(["casterTurnStart", "casterTurnEnd", "bearerTurnStart", "bearerTurnEnd"]);
/** Ce qui ouvre une attaque en action Bonus (`bonusAttack.after`). */
export const BONUS_ATTACK_AFTER = Object.freeze(["critical", "felled"]);

export const ENTRY_KEYS = Object.freeze(["smite", "metamagic", "endurance", "replacesAttack", "hitRider", "potentCantrip", "sculptSpells", "supremeHealing", "discipleOfLife", "blessedHealer", "martialArts", "flurry", "stunningStrike", "openHand", "effectEnds", "effectThen", "actionEnds", "blocksHealing", "noOpportunityAttacks", "byWounds", "oneAttack", "rage", "persistentRage", "reckless", "relentless", "grantsAction", "movesAfter", "studiedAttacks", "heroicWarrior", "greatWeaponFighting", "thrownDamage", "sneakAttack", "sneakBonus", "cunningStrikes", "cunningStrikeMax", "evasion", "elusive", "holdsStill", "empower", "discharge", "healsDownedMax", "failMargins", "reactions", "lastStand", "forOneAttack", "basicActions", "sharedHp", "secondPhase", "savedEffects", "ignoresCloseCombat", "triggers", "aura", "onHit", "choice", "targets", "trace", "teleport", "lineDash", "absorb", "summon", "movable", "burst", "recast", "atTurnStart", "bolt", "obscures", "healMax", "duplicates", "saveAdvantage", "onFell", "bonusAttack", "reactiveSpell", "projectiles", "leap", "light", "revealsInvisible", "effectsExpire", "usageLimits", "enchantTarget", "ranges", "tether", "pact", "damageShield", "hitDiceHeal", "breaksOn", "noReactions", "cures", "advantageIfFighting", "emanation", "regeneration", "fortitude", "noOpportunity", "drain", "swallow", "resize", "orders", "portent", "dispel", "counter", "zoneEffects", "rollBonus", "transpose", "stabilizes", "carriedLight", "kindles", "curesAll", "potionEffect", "castTargets", "effectChanges", "difficultTerrain", "storm", "stableAtZero", "effectsIf", "contest", "wardsAtZero", "zoneCharges", "noDamage", "selfZone", "zoneAffects", "changesForm", "actionOrBonus"]);
export const CHOICE_EFFECTS = Object.freeze(["one"]);
/** §37 : ce qu'une sauvegarde répétée ratée impose en plus (`resave.onFail`) : l'action Esquiver (Malédiction). */
export const RESAVE_ON_FAIL = Object.freeze(["dodge"]);
/** §43.2 : qui fait cesser l'effet par une action, par quel jet, sous quel libellé. */
export const ACTION_END_BY = Object.freeze(["bearer", "other"]);
export const ACTION_END_ROLLS = Object.freeze(["save", "check"]);
export const ACTION_END_VERBS = Object.freeze(["wake"]);
/** §49 : l'état que le porteur se donne en mettant fin à l'effet (feu grégeois : « en vous infligeant l'état À terre »). */
export const ACTION_END_STATUSES = Object.freeze(["prone"]);
/** §32 : les options de Métamagie que le moteur applique au sort suivant. */
export const METAMAGIC_KINDS = Object.freeze(["quickened", "careful", "heightened", "distant", "subtle"]);
/** Les repos qui mettent fin aux effets d'un item (`effectsExpire`) : les événements d'expiration de dnd5e (config.mjs:4750). */
export const EFFECT_EXPIRIES = Object.freeze(["longRest", "shortRest"]);

const isObject = v => (typeof v === "object") && (v !== null) && !Array.isArray(v);
const isId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);

function validateStep(step, at, errors) {
  if ( !isObject(step) ) return errors.push(`${at} : une étape est un objet`);
  if ( !STEP_TYPES.includes(step.type) ) return errors.push(`${at}.type : « ${step.type} » inconnu (${STEP_TYPES.join(", ")})`);
  if ( step.type === "damage" ) {
    if ( ("to" in step) && !DAMAGE_TO.includes(step.to) ) errors.push(`${at}.to : ${DAMAGE_TO.join(", ")}`);
    if ( ("onSave" in step) && !DAMAGE_ON_SAVE.includes(step.onSave) ) errors.push(`${at}.onSave : ${DAMAGE_ON_SAVE.join(", ")}`);
    // Une riposte (ou les dégâts du porteur) peut rejouer l'activité de dégâts de l'item ; un partage (to: "origin") sans
    // formule reprend le montant subi.
    const fromActivity = ["source", "bearer"].includes(step.to) && ("activity" in step);
    const same = (step.to === "origin") && !("formula" in step);
    if ( !fromActivity && !same ) {
      if ( (typeof step.formula !== "string") || !step.formula.trim() ) errors.push(`${at}.formula : formule requise`);
      if ( (typeof step.damageType !== "string") || !step.damageType ) errors.push(`${at}.damageType : type de dégâts requis`);
    }
  }
  // §74 : `spends` — des dégâts bonus qui dépensent un effet de l'item porté par l'auteur (Frappe du zéphyr : « une fois »).
  if ( (step.type === "damage") && ("spends" in step) && !isId(step.spends) ) errors.push(`${at}.spends : id d'effet de l'item (16 caractères) attendu`);
  if ( (step.type === "use") && ("target" in step) && !["source", "self"].includes(step.target) ) errors.push(`${at}.target : « source » ou « self »`);
  if ( (step.type === "use") && ("advantage" in step) && (step.advantage !== true) ) errors.push(`${at}.advantage : true ou absent`);
  if ( (step.type === "use") && ("consume" in step) && (step.consume !== false) ) errors.push(`${at}.consume : false ou absent`);
  if ( (step.type === "use") && ("approach" in step) && ((step.approach !== true) || (step.target !== "source")) ) errors.push(`${at}.approach : true, avec target: "source"`);
  if ( "margin" in step ) {
    const mg = step.margin;
    const ok = (typeof mg === "object") && mg && Object.keys(mg).length && Object.entries(mg).every(([k, v]) => ["min", "max"].includes(k) && Number.isFinite(v) && (v >= 0));
    if ( !ok ) errors.push(`${at}.margin : { min?, max? } (nombres ≥ 0)`);
  }
  if ( ["use", "replay", "ward", "damage"].includes(step.type) && ("activity" in step) && !isId(step.activity) ) errors.push(`${at}.activity : id d'activité (16 caractères) attendu`);
  if ( (step.type === "damage") && ("activity" in step) && !["source", "bearer"].includes(step.to) ) errors.push(`${at}.activity : seulement pour une riposte (to: "source") ou le porteur (to: "bearer")`);
  if ( step.type === "move" ) {
    if ( !MOVE_MODES.includes(step.mode) ) errors.push(`${at}.mode : ${MOVE_MODES.join(", ")}`);
    const formula = (typeof step.distance === "string") && step.distance.trim();
    if ( !formula && !(Number.isFinite(step.distance) && (step.distance > 0)) ) errors.push(`${at}.distance : nombre positif ou formule`);
    if ( (typeof step.units !== "string") || !step.units ) errors.push(`${at}.units : unité requise`);
    if ( ("follow" in step) && (typeof step.follow !== "boolean") ) errors.push(`${at}.follow : booléen`);
  }
  if ( (step.type === "status") && ((typeof step.status !== "string") || !step.status) ) errors.push(`${at}.status : état requis`);
  // §86 : riposte par une sauvegarde — vers l'attaquant, une activité de l'item.
  if ( step.type === "save" ) {
    if ( step.to !== "source" ) errors.push(`${at}.to : « source »`);
    if ( !isId(step.activity) ) errors.push(`${at}.activity : id d'activité (16 caractères) attendu`);
  }
  if ( step.type === "mark" ) {
    if ( (typeof step.mark !== "string") || !step.mark ) errors.push(`${at}.mark : nom de la marque requis`);
    if ( (typeof step.label !== "string") || !step.label ) errors.push(`${at}.label : clé de traduction requise`);
    if ( ("seconds" in step) && !(Number.isFinite(step.seconds) && (step.seconds > 0)) ) errors.push(`${at}.seconds : nombre positif`);
  }
  if ( (step.type === "consume") && !["target", "source"].includes(step.side) ) errors.push(`${at}.side : « target » ou « source »`);
  if ( (step.type === "resave") && ("keep" in step) && (step.keep !== true) ) errors.push(`${at}.keep : true ou absent`);
  if ( (step.type === "resave") && ("unlessSeesOrigin" in step) && (step.unlessSeesOrigin !== true) ) errors.push(`${at}.unlessSeesOrigin : true ou absent`);
  if ( (step.type === "resave") && ("tally" in step) ) {
    const t = step.tally;
    const count = n => Number.isInteger(n) && (n > 0);
    if ( !isObject(t) || !count(t.successes) || !count(t.failures) || (("status" in t) && ((typeof t.status !== "string") || !t.status))
      || !Object.keys(t).every(k => ["successes", "failures", "status"].includes(k)) ) errors.push(`${at}.tally : { successes, failures, status? } (entiers positifs, état)`);
    if ( step.keep === true ) errors.push(`${at}.tally : sans objet avec keep`);
  }
  if ( (step.type === "resave") && ("onFail" in step) && !RESAVE_ON_FAIL.includes(step.onFail) ) errors.push(`${at}.onFail : ${RESAVE_ON_FAIL.join(", ")}`);
  if ( (step.type === "attackBonus") && ((typeof step.formula !== "string") || !step.formula.trim()) ) errors.push(`${at}.formula : formule requise`);
  // §31 : ce qui s'ajoute au jet de l'activité de réduction (Endurance de la pierre : « ajoutez votre modificateur de Constitution »).
  // §33 : un dé retiré au jet d'attaque (Mots cinglants : « soustrayez le résultat du jet ») — l'attaque est rejugée.
  if ( ["penalty", "bonus"].includes(step.type) && ((typeof step.formula !== "string") || !step.formula.trim()) ) errors.push(`${at}.formula : formule requise`);
  if ( (step.type === "reduce") && ("bonus" in step) && ((typeof step.bonus !== "string") || !step.bonus.trim()) ) errors.push(`${at}.bonus : formule`);
}

function validateTrigger(declaration, at, facts, errors) {
  if ( !isObject(declaration) ) return errors.push(`${at} : une déclaration est un objet`);
  const d = normalize(declaration);
  if ( !d.on.length ) errors.push(`${at}.on : au moins un moment`);
  for ( const m of d.on ) if ( !(m in MOMENTS) ) errors.push(`${at}.on : moment « ${m} » inconnu (${Object.keys(MOMENTS).join(", ")})`);
  if ( (d.via !== null) && !VIA.includes(d.via) ) errors.push(`${at}.via : ${VIA.join(", ")}`);
  // `fromEffect` : la déclaration ne vaut que pour l'effet de l'item de cet id (Bouclier de feu : chaud OU froid).
  if ( "fromEffect" in declaration ) {
    if ( !isId(declaration.fromEffect) ) errors.push(`${at}.fromEffect : id d'effet (16 caractères)`);
    if ( d.via !== "effect" ) errors.push(`${at}.fromEffect : demande via: "effect"`);
  }
  // §65 : `by: "originSide"` — l'effet ne réagit qu'aux dégâts du lanceur ou de ses alliés (Suggestion).
  if ( "by" in declaration ) {
    if ( !DAMAGED_BY.includes(declaration.by) ) errors.push(`${at}.by : ${DAMAGED_BY.join(", ")}`);
    if ( (d.via !== "effect") || (d.on.length !== 1) || (d.on[0] !== "isDamaged") ) errors.push(`${at}.by : demande via: "effect" et le seul moment isDamaged`);
  }
  // `oncePerTurn` : une part de dégâts bonus qui ne vaut qu'une fois par tour (Attraction de la mort : « une fois par tour »).
  if ( ("oncePerTurn" in declaration) && ((declaration.oncePerTurn !== true) || (d.on.length !== 1) || (d.on[0] !== "preDamageRoll")) ) {
    errors.push(`${at}.oncePerTurn : true, avec le seul moment preDamageRoll`);
  }
  if ( !Array.isArray(d.do) || !d.do.length ) errors.push(`${at}.do : au moins une étape`);
  else {
    d.do.forEach((s, i) => validateStep(s, `${at}.do[${i}]`, errors));
    // Chaque étape va avec ses moments : une poussée n'a de sens qu'à une issue, une sauvegarde répétée qu'au tour.
    const outcome = d.on.some(m => OUTCOME_MOMENTS.includes(m));
    const resave = d.on.length && d.on.every(m => RESAVE_MOMENTS.includes(m));
    const bearer = d.on.length && d.on.every(m => BEARER_MOMENTS.includes(m));
    for ( const s of d.do ) {
      if ( isObject(s) && OUTCOME_STEPS.includes(s.type) && !outcome ) errors.push(`${at}.do : « ${s.type} » demande un moment d'issue (${OUTCOME_MOMENTS.join(", ")})`);
      if ( isObject(s) && (s.type === "resave") && (!resave || (d.via !== "effect")) ) errors.push(`${at}.do : « resave » demande des moments parmi ${RESAVE_MOMENTS.join(", ")} et via: "effect"`);
      if ( isObject(s) && (s.type === "remove") && (!bearer || (d.via !== "effect")) ) errors.push(`${at}.do : « remove » demande des moments du porteur (${BEARER_MOMENTS.join(", ")}) et via: "effect"`);
      // §34 : le Désavantage peut aussi venir d'une réaction avant le jet (Esquive des ombres, Éclat protecteur).
      const preAttackReaction = d.on.some(m => PRE_ATTACK_WINDOWS.includes(m)) && d.do.some(x => isObject(x) && (x.type === "use"));
      if ( isObject(s) && ATTACK_STEPS.includes(s.type) && !d.on.includes("preAttackRoll") && !((s.type === "disadvantage") && preAttackReaction) ) errors.push(`${at}.do : « ${s.type} » demande le moment preAttackRoll`);
      if ( isObject(s) && (s.type === "consume") && (!d.on.includes("preAttackRoll") || (d.via !== "effect")) ) errors.push(`${at}.do : « consume » demande le moment preAttackRoll et via: "effect"`);
      if ( isObject(s) && (s.type === "ward") && (!d.on.includes("isAttacked") || (d.via !== "effect")) ) errors.push(`${at}.do : « ward » demande le moment isAttacked et via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "source") && ((d.on.length !== 1) || (d.on[0] !== "isHit")) ) errors.push(`${at}.do : une riposte (to: "source") demande le seul moment isHit`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "origin") && ((d.on.length !== 1) || (d.on[0] !== "isDamaged") || (d.via !== "effect")) ) errors.push(`${at}.do : un partage (to: "origin") demande le seul moment isDamaged et via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "bearer") && (!d.on.length || !d.on.every(m => TURN_MOMENTS.includes(m)) || (d.via !== "effect")) ) errors.push(`${at}.do : les dégâts du porteur (to: "bearer") demandent des moments parmi ${TURN_MOMENTS.join(", ")} et via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && ("onSave" in s) && ((d.on.length !== 1) || (d.on[0] !== "failedSave") || ("to" in s)) ) errors.push(`${at}.do : « onSave » demande le seul moment failedSave, sans « to »`);
      if ( isObject(s) && ["halve", "uncrit", "reduce", "miss", "penalty"].includes(s.type) && !((s.type === "penalty") && preAttackReaction) && (!d.on.some(m => HIT_WINDOWS.includes(m)) || !d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do : « ${s.type} » demande le moment isHit ou allyIsHit et une réaction « use »`);
      if ( isObject(s) && (s.type === "absorb") && !(d.on.includes("allyIsDamaged") && d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do : « absorb » demande le moment allyIsDamaged et une réaction « use »`);
      if ( isObject(s) && (s.type === "interpose") && !(d.on.includes("allyIsDamaged") && d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do : « interpose » demande le moment allyIsDamaged et une réaction « use »`);
      if ( isObject(s) && (s.type === "bonus") && !(d.on.includes("allyAttacks") && preAttackReaction) ) errors.push(`${at}.do : « bonus » demande le moment allyAttacks et une réaction « use »`);
      if ( isObject(s) && (s.type === "endCondition") && (!d.on.includes("gainsCondition") || !d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do : « endCondition » demande le moment gainsCondition et une réaction « use »`);
    }
  }
  for ( const key of unknownFacts(d.if, facts) ) errors.push(`${at}.if : fait « ${key} » inconnu`);
}

function validateAura(aura, at, errors) {
  if ( !isObject(aura) ) return errors.push(`${at} : un objet`);
  if ( ("radius" in aura) && !(Number.isFinite(aura.radius) && (aura.radius > 0)) ) errors.push(`${at}.radius : nombre positif`);
  if ( ("units" in aura) && (typeof aura.units !== "string") ) errors.push(`${at}.units : chaîne`);
  if ( ("affects" in aura) && !AURA_AFFECTS.includes(aura.affects) ) errors.push(`${at}.affects : ${AURA_AFFECTS.join(", ")}`);
  if ( ("includeSelf" in aura) && (typeof aura.includeSelf !== "boolean") ) errors.push(`${at}.includeSelf : booléen`);
  if ( ("effect" in aura) && !isId(aura.effect) ) errors.push(`${at}.effect : id d'effet (16 caractères)`);
  if ( ("radiusFormula" in aura) && (typeof aura.radiusFormula !== "string") ) errors.push(`${at}.radiusFormula : chaîne`);
  if ( ("whileActive" in aura) && (aura.whileActive !== true) ) errors.push(`${at}.whileActive : true ou absent`);
  if ( "changes" in aura ) {
    const ok = Array.isArray(aura.changes) && aura.changes.length && aura.changes.every(c => isObject(c)
      && (typeof c.key === "string") && c.key && (typeof c.value === "string") && (typeof c.type === "string") && c.type);
    if ( !ok ) errors.push(`${at}.changes : liste de { key, value (chaîne), type }`);
  }
  if ( ("types" in aura) && (!Array.isArray(aura.types) || !aura.types.length || !aura.types.every(t => CREATURE_TYPES.includes(t))) ) {
    errors.push(`${at}.types : types de créature (${CREATURE_TYPES.join(", ")})`);
  }
  for ( const key of Object.keys(aura) ) {
    if ( !["radius", "units", "affects", "includeSelf", "effect", "radiusFormula", "whileActive", "changes", "types"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
  }
}

/**
 * Les erreurs d'une entrée. Vide = valide.
 * @param {object} entry
 * @param {{facts: object, at?: string}} options  `facts` : les clés de faits que l'adaptateur fournit.
 * @returns {string[]}
 */
export function validateEntry(entry, { facts={}, at="" }={}) {
  const errors = [];
  if ( !isObject(entry) ) return [`${at || "entrée"} : un objet`];
  for ( const key of Object.keys(entry) ) if ( !ENTRY_KEYS.includes(key) ) errors.push(`${at}${key} : clé inconnue (${ENTRY_KEYS.join(", ")})`);
  if ( "triggers" in entry ) {
    const list = Array.isArray(entry.triggers) ? entry.triggers : [entry.triggers];
    list.forEach((d, i) => validateTrigger(d, `${at}triggers[${i}]`, facts, errors));
  }
  if ( "aura" in entry ) validateAura(entry.aura, `${at}aura`, errors);
  if ( "onHit" in entry ) {
    if ( !isObject(entry.onHit) || !isId(entry.onHit.save) ) errors.push(`${at}onHit.save : id d'activité (16 caractères)`);
  }
  if ( "choice" in entry ) validateChoice(entry.choice, `${at}choice`, errors);
  if ( "targets" in entry ) validateTargets(entry.targets, `${at}targets`, facts, errors);
  if ( "trace" in entry ) {
    const t = entry.trace;
    if ( isObject(t) ) {
      for ( const key of ["activity", "attack"] ) if ( (key in t) && !isId(t[key]) ) errors.push(`${at}trace.${key} : id d'activité (16 caractères) attendu`);
      if ( ("show" in t) && (t.show !== true) ) errors.push(`${at}trace.show : true ou absent`);
      for ( const key of Object.keys(t) ) if ( !["activity", "show", "attack"].includes(key) ) errors.push(`${at}trace.${key} : clé inconnue`);
    }
    else if ( t !== true ) errors.push(`${at}trace : true ou { activity?, show?, attack? }`);
  }
  if ( "damageShield" in entry ) {
    const d = entry.damageShield;
    const worn = isObject(d) && ("worn" in d);
    if ( worn && ((typeof d.worn !== "string") || !d.worn || ("effects" in d)) ) errors.push(`${at}damageShield.worn : un type de dégâts (sans effects)`);
    if ( !isObject(d) || (!worn && (!isObject(d.effects) || !Object.keys(d.effects).length)) ) errors.push(`${at}damageShield.effects : { id d'effet: type de dégâts }`);
    else {
      for ( const [id, type] of Object.entries(d.effects ?? {}) ) {
        if ( !isId(id) ) errors.push(`${at}damageShield.effects.${id} : id d'effet (16 caractères)`);
        if ( (typeof type !== "string") || !type ) errors.push(`${at}damageShield.effects.${id} : type de dégâts`);
      }
      if ( (typeof d.formula !== "string") || !d.formula.trim() ) errors.push(`${at}damageShield.formula : formule requise`);
      if ( ("oncePerTurn" in d) && (d.oncePerTurn !== true) ) errors.push(`${at}damageShield.oncePerTurn : true ou absent`);
      for ( const key of Object.keys(d) ) if ( !["effects", "worn", "formula", "oncePerTurn"].includes(key) ) errors.push(`${at}damageShield.${key} : clé inconnue`);
    }
  }
  if ( "hitDiceHeal" in entry ) {
    const h = entry.hitDiceHeal;
    if ( !isObject(h) || !isId(h.activity) || !(Number.isInteger(h.base) && (h.base > 0)) ) errors.push(`${at}hitDiceHeal : { activity, base }`);
    else for ( const key of Object.keys(h) ) if ( !["activity", "base"].includes(key) ) errors.push(`${at}hitDiceHeal.${key} : clé inconnue`);
  }
  if ( "empower" in entry ) {
    const e = entry.empower;
    if ( !isObject(e) ) errors.push(`${at}empower : { damageType, effect, excludeTypes? }`);
    else {
      if ( (typeof e.damageType !== "string") || !e.damageType ) errors.push(`${at}empower.damageType : type de dégâts requis`);
      if ( !isId(e.effect) ) errors.push(`${at}empower.effect : id d'effet (16 caractères)`);
      if ( ("excludeTypes" in e) && (!Array.isArray(e.excludeTypes) || !e.excludeTypes.every(t => CREATURE_TYPES.includes(t))) ) {
        errors.push(`${at}empower.excludeTypes : types de créature (${CREATURE_TYPES.join(", ")})`);
      }
      for ( const key of Object.keys(e) ) if ( !["damageType", "effect", "excludeTypes"].includes(key) ) errors.push(`${at}empower.${key} : clé inconnue`);
    }
  }
  if ( "discharge" in entry ) {
    const c = entry.discharge;
    if ( !isObject(c) ) errors.push(`${at}discharge : { effect, formula, damageTypes, sees? }`);
    else {
      if ( !isId(c.effect) ) errors.push(`${at}discharge.effect : id d'effet (16 caractères)`);
      if ( (typeof c.formula !== "string") || !c.formula.trim() ) errors.push(`${at}discharge.formula : formule requise`);
      if ( !Array.isArray(c.damageTypes) || !c.damageTypes.length || !c.damageTypes.every(t => (typeof t === "string") && t) ) errors.push(`${at}discharge.damageTypes : liste de types de dégâts`);
      if ( ("sees" in c) && (c.sees !== true) ) errors.push(`${at}discharge.sees : true ou absent`);
      for ( const key of Object.keys(c) ) if ( !["effect", "formula", "damageTypes", "sees"].includes(key) ) errors.push(`${at}discharge.${key} : clé inconnue`);
    }
  }
  if ( ("healsDownedMax" in entry) && (entry.healsDownedMax !== true) ) errors.push(`${at}healsDownedMax : true ou absent`);
  if ( "breaksOn" in entry ) {
    const b = entry.breaksOn;
    if ( !Array.isArray(b) || !b.length || !b.every(m => BREAK_MOMENTS.includes(m)) ) errors.push(`${at}breaksOn : liste parmi ${BREAK_MOMENTS.join(", ")}`);
  }
  if ( "emanation" in entry ) validateEmanation(entry.emanation, `${at}emanation`, errors);
  if ( ("noOpportunity" in entry) && !["always", "flying", "afterUse", "whileEffect"].includes(entry.noOpportunity) ) errors.push(`${at}noOpportunity : always, flying, afterUse, whileEffect`);
  if ( ("savedEffects" in entry) && (!Array.isArray(entry.savedEffects) || !entry.savedEffects.length || !entry.savedEffects.every(isId)) ) {
    errors.push(`${at}savedEffects : liste d'ids d'effets (16 caractères)`);
  }
  if ( "secondPhase" in entry ) {
    const p = entry.secondPhase;
    if ( !isObject(p) || !isId(p.activity) ) errors.push(`${at}secondPhase.activity : id d'activité (16 caractères) attendu`);
    else {
      if ( ("keepConditions" in p) && (typeof p.keepConditions !== "boolean") ) errors.push(`${at}secondPhase.keepConditions : booléen`);
      if ( ("keepHp" in p) && (typeof p.keepHp !== "boolean") ) errors.push(`${at}secondPhase.keepHp : booléen`);
      for ( const key of Object.keys(p) ) if ( !["activity", "keepConditions", "keepHp"].includes(key) ) errors.push(`${at}secondPhase.${key} : clé inconnue`);
    }
  }
  if ( "changesForm" in entry ) {
    const p = entry.changesForm;
    if ( !isObject(p) || !isId(p.activity) ) errors.push(`${at}changesForm.activity : id d'activité (16 caractères) attendu`);
    else {
      if ( ("keepConditions" in p) && (typeof p.keepConditions !== "boolean") ) errors.push(`${at}changesForm.keepConditions : booléen`);
      if ( ("keepHp" in p) && (typeof p.keepHp !== "boolean") ) errors.push(`${at}changesForm.keepHp : booléen`);
      for ( const key of Object.keys(p) ) if ( !["activity", "keepConditions", "keepHp"].includes(key) ) errors.push(`${at}changesForm.${key} : clé inconnue`);
    }
  }
  const isMargin = mg => isObject(mg) && Object.keys(mg).length && Object.entries(mg).every(([k, v]) => ["min", "max"].includes(k) && Number.isFinite(v) && (v >= 0));
  if ( "failMargins" in entry ) {
    const f = entry.failMargins;
    if ( !isObject(f) || !Object.keys(f).length ) errors.push(`${at}failMargins : { id d'effet: { min?, max? } }`);
    else for ( const [id, mg] of Object.entries(f) ) {
      if ( !isId(id) ) errors.push(`${at}failMargins.${id} : id d'effet (16 caractères)`);
      if ( !isMargin(mg) ) errors.push(`${at}failMargins.${id} : { min?, max? } (nombres ≥ 0)`);
    }
  }
  if ( ("orders" in entry) && (!Array.isArray(entry.orders) || !entry.orders.length || !entry.orders.every(o => ORDERS.includes(o))) ) {
    errors.push(`${at}orders : liste d'ordres parmi ${ORDERS.join(", ")}`);
  }
  if ( "resize" in entry ) {
    const r = entry.resize;
    if ( !isObject(r) || !Object.keys(r).length ) errors.push(`${at}resize : { id d'effet: crans }`);
    else for ( const [id, steps] of Object.entries(r) ) {
      if ( !isId(id) ) errors.push(`${at}resize.${id} : id d'effet (16 caractères)`);
      if ( !Number.isInteger(steps) || !steps || (Math.abs(steps) > 5) ) errors.push(`${at}resize.${id} : entier non nul, de -5 à 5`);
    }
  }
  if ( ("reactions" in entry) && !(isObject(entry.reactions) && Number.isInteger(entry.reactions.perRound) && (entry.reactions.perRound >= 1) && (Object.keys(entry.reactions).length === 1)) ) {
    errors.push(`${at}reactions : { perRound } (entier ≥ 1)`);
  }
  if ( ("counter" in entry) && !(isObject(entry.counter) && Object.keys(entry.counter).every(k => k === "level")
    && (!("level" in entry.counter) || (Number.isInteger(entry.counter.level) && (entry.counter.level >= 0) && (entry.counter.level <= 9)))) ) {
    errors.push(`${at}counter : { level? } (niveau de sort, entier de 0 à 9)`);
  }
  if ( ("lastStand" in entry) && !(isObject(entry.lastStand) && Number.isFinite(entry.lastStand.threshold) && (entry.lastStand.threshold >= 0) && (Object.keys(entry.lastStand).length === 1)) ) {
    errors.push(`${at}lastStand : { threshold } (nombre ≥ 0)`);
  }
  if ( "basicActions" in entry ) {
    const b = entry.basicActions;
    if ( !isObject(b) || !Object.keys(b).length ) errors.push(`${at}basicActions : { id d'activité: ${BASIC_ACTION_KINDS.join(" | ")} }`);
    else for ( const [id, kind] of Object.entries(b) ) {
      if ( !isId(id) ) errors.push(`${at}basicActions.${id} : id d'activité (16 caractères)`);
      // §24 : plusieurs actions pour une activité (Défense patiente : Se désengager et Esquiver) ; §65 : une au choix.
      if ( isObject(kind) && !Array.isArray(kind) ) {
        const ok = Array.isArray(kind.choose) && (kind.choose.length >= 2) && kind.choose.every(k => BASIC_ACTION_KINDS.includes(k))
          && (Object.keys(kind).length === 1);
        if ( !ok ) errors.push(`${at}basicActions.${id} : { choose: [au moins deux parmi ${BASIC_ACTION_KINDS.join(", ")}] }`);
        continue;
      }
      const kinds = Array.isArray(kind) ? kind : [kind];
      if ( !kinds.length || !kinds.every(k => BASIC_ACTION_KINDS.includes(k)) ) errors.push(`${at}basicActions.${id} : ${BASIC_ACTION_KINDS.join(", ")} (ou une liste)`);
    }
  }
  for ( const key of ["actionOrBonus", "wardsAtZero", "stableAtZero", "dispel", "zoneEffects", "noReactions", "advantageIfFighting", "regeneration", "fortitude", "drain", "swallow", "ignoresCloseCombat", "sharedHp", "forOneAttack", "evasion", "elusive", "holdsStill", "grantsAction", "studiedAttacks", "heroicWarrior", "greatWeaponFighting", "persistentRage", "reckless", "blocksHealing", "noOpportunityAttacks", "oneAttack", "martialArts", "supremeHealing", "discipleOfLife", "blessedHealer", "potentCantrip", "sculptSpells", "endurance", "replacesAttack", "stabilizes", "kindles", "castTargets"] ) if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key} : true ou absent`);
  validateRogue(entry, at, errors);
  if ( ("cures" in entry) && (!Array.isArray(entry.cures) || !entry.cures.length || !entry.cures.every(s => (typeof s === "string") && s)) ) {
    errors.push(`${at}cures : liste d'identifiants d'état`);
  }
  if ( ("curesAll" in entry) && (!Array.isArray(entry.curesAll) || !entry.curesAll.length || !entry.curesAll.every(s => (typeof s === "string") && s)) ) {
    errors.push(`${at}curesAll : liste d'identifiants d'état`);
  }
  if ( "effectChanges" in entry ) {
    const e = entry.effectChanges;
    const okChange = c => isObject(c) && (typeof c.key === "string") && c.key && (typeof c.type === "string") && c.type
      && ["string", "number", "boolean"].includes(typeof c.value) && Object.keys(c).every(k => ["key", "type", "value"].includes(k));
    if ( !isObject(e) || !Object.entries(e).every(([id, list]) => isId(id) && Array.isArray(list) && list.length && list.every(okChange)) ) {
      errors.push(`${at}effectChanges : { <id d'effet> : [{ key, type, value }] }`);
    }
  }
  if ( ("potionEffect" in entry) && !isId(entry.potionEffect) ) errors.push(`${at}potionEffect : id d'effet (16 caractères)`);
  if ( ("enchantTarget" in entry) && !["weapon", "ownWeapon"].includes(entry.enchantTarget) ) errors.push(`${at}enchantTarget : « weapon » ou « ownWeapon »`);
  if ( "pact" in entry ) {
    const p = entry.pact;
    if ( !isObject(p) || !Array.isArray(p.damageTypes) || !p.damageTypes.length || !p.damageTypes.every(t => (typeof t === "string") && t) ) {
      errors.push(`${at}pact.damageTypes : liste de types de dégâts`);
    }
    else {
      if ( ("ability" in p) && ((typeof p.ability !== "string") || !p.ability) ) errors.push(`${at}pact.ability : caractéristique`);
      for ( const key of Object.keys(p) ) if ( !["damageTypes", "ability"].includes(key) ) errors.push(`${at}pact.${key} : clé inconnue`);
    }
  }
  const isRange = r => isObject(r) && Number.isFinite(r.value) && (r.value > 0) && (typeof r.units === "string") && !!r.units;
  if ( "ranges" in entry ) {
    if ( !isObject(entry.ranges) ) errors.push(`${at}ranges : { id d'activité: { value, units } }`);
    else for ( const [id, r] of Object.entries(entry.ranges) ) {
      if ( !isId(id) ) errors.push(`${at}ranges.${id} : id d'activité (16 caractères) attendu`);
      if ( !isRange(r) ) errors.push(`${at}ranges.${id} : { value, units }`);
    }
  }
  if ( "tether" in entry ) {
    const t = entry.tether;
    if ( !isObject(t) ) errors.push(`${at}tether : { attack, activity, range }`);
    else {
      for ( const key of ["attack", "activity"] ) if ( !isId(t[key]) ) errors.push(`${at}tether.${key} : id d'activité (16 caractères) attendu`);
      if ( !isRange(t.range) ) errors.push(`${at}tether.range : { value, units }`);
      for ( const key of Object.keys(t) ) if ( !["attack", "activity", "range"].includes(key) ) errors.push(`${at}tether.${key} : clé inconnue`);
    }
  }
  if ( "teleport" in entry ) validateTeleport(entry.teleport, `${at}teleport`, errors);
  if ( "contest" in entry ) {
    const c = entry.contest;
    const skill = x => (typeof x === "string") && /^[a-z]{3}$/.test(x);
    if ( !isObject(c) ) errors.push(`${at}contest : un objet`);
    else {
      if ( ("activity" in c) && !isId(c.activity) ) errors.push(`${at}contest.activity : id d'activité (16 caractères) attendu`);
      if ( !skill(c.skill) ) errors.push(`${at}contest.skill : clé de compétence (« ins »)`);
      if ( !Array.isArray(c.against) || !c.against.length || !c.against.every(skill) ) errors.push(`${at}contest.against : liste de clés de compétence`);
      if ( !isId(c.effect) ) errors.push(`${at}contest.effect : id d'effet (16 caractères) attendu`);
      if ( ("exclusive" in c) && (c.exclusive !== true) ) errors.push(`${at}contest.exclusive : true ou absent`);
      for ( const key of Object.keys(c) ) if ( !["activity", "skill", "against", "effect", "exclusive"].includes(key) ) errors.push(`${at}contest.${key} : clé inconnue`);
    }
  }
  if ( ("zoneCharges" in entry) && !(Number.isInteger(entry.zoneCharges) && (entry.zoneCharges > 0)) ) errors.push(`${at}zoneCharges : entier positif`);
  if ( "selfZone" in entry ) {
    if ( !isObject(entry.selfZone) || !Object.keys(entry.selfZone).length ) errors.push(`${at}selfZone : { id d'activité: gabarit }`);
    else for ( const [id, t] of Object.entries(entry.selfZone) ) {
      if ( !isId(id) ) errors.push(`${at}selfZone : « ${id} » n'est pas un id d'activité (16 caractères)`);
      if ( !isObject(t) || !["radius", "sphere", "circle"].includes(t.type) ) errors.push(`${at}selfZone.${id}.type : radius, sphere, circle`);
      if ( !(Number.isFinite(t?.size) && (t.size > 0)) ) errors.push(`${at}selfZone.${id}.size : nombre positif`);
      if ( (typeof t?.units !== "string") || !t.units ) errors.push(`${at}selfZone.${id}.units : unité requise`);
    }
  }
  if ( ("zoneAffects" in entry) && !["enemy", "ally"].includes(entry.zoneAffects) ) errors.push(`${at}zoneAffects : enemy, ally`);
  if ( ("noDamage" in entry) && !(Array.isArray(entry.noDamage) && entry.noDamage.length && entry.noDamage.every(id => /^[A-Za-z0-9]{16}$/.test(id))) ) {
    errors.push(`${at}noDamage : liste d'ids d'activité (16 caractères)`);
  }
  if ( "effectsIf" in entry ) {
    if ( !isObject(entry.effectsIf) ) errors.push(`${at}effectsIf : une condition (objet)`);
    else for ( const key of unknownFacts(entry.effectsIf, facts) ) errors.push(`${at}effectsIf : fait « ${key} » inconnu`);
  }
  if ( "storm" in entry ) {
    const t = entry.storm;
    if ( !isObject(t) ) errors.push(`${at}storm : un objet`);
    else {
      if ( ("bonus" in t) && ((typeof t.bonus !== "string") || !/^\d*d\d+$/.test(t.bonus)) ) errors.push(`${at}storm.bonus : des dés (« 1d10 »)`);
      for ( const key of Object.keys(t) ) if ( key !== "bonus" ) errors.push(`${at}storm.${key} : clé inconnue`);
    }
  }
  if ( "difficultTerrain" in entry ) {
    const t = entry.difficultTerrain;
    if ( !isObject(t) ) errors.push(`${at}difficultTerrain : un objet`);
    else {
      if ( ("types" in t) && (!Array.isArray(t.types) || !t.types.every(x => (typeof x === "string") && x)) ) errors.push(`${at}difficultTerrain.types : liste de chaînes`);
      for ( const key of Object.keys(t) ) if ( key !== "types" ) errors.push(`${at}difficultTerrain.${key} : clé inconnue`);
    }
  }
  if ( "lineDash" in entry ) {
    const d = entry.lineDash;
    if ( !isObject(d) ) errors.push(`${at}lineDash : un objet`);
    else {
      if ( !(Number.isFinite(d.reach) && (d.reach > 0)) ) errors.push(`${at}lineDash.reach : nombre positif`);
      if ( (typeof d.units !== "string") || !d.units ) errors.push(`${at}lineDash.units : unité requise`);
      if ( ("activity" in d) && !isId(d.activity) ) errors.push(`${at}lineDash.activity : id d'activité (16 caractères) attendu`);
      for ( const key of Object.keys(d) ) if ( !["reach", "units", "activity"].includes(key) ) errors.push(`${at}lineDash.${key} : clé inconnue`);
    }
  }
  if ( "absorb" in entry ) validateAbsorb(entry.absorb, `${at}absorb`, errors);
  if ( "movable" in entry ) {
    const m = entry.movable;
    if ( !isObject(m) ) errors.push(`${at}movable : un objet`);
    else {
      if ( !(Number.isFinite(m.distance) && (m.distance > 0)) ) errors.push(`${at}movable.distance : nombre positif`);
      if ( (typeof m.units !== "string") || !m.units ) errors.push(`${at}movable.units : unité requise`);
      for ( const key of Object.keys(m) ) if ( !["distance", "units"].includes(key) ) errors.push(`${at}movable.${key} : clé inconnue`);
    }
  }
  if ( "summon" in entry ) validateSummon(entry.summon, `${at}summon`, errors);
  if ( "burst" in entry ) {
    const b = entry.burst;
    if ( !isObject(b) ) errors.push(`${at}burst : un objet`);
    else {
      if ( !isId(b.activity) ) errors.push(`${at}burst.activity : id d'activité (16 caractères) attendu`);
      if ( !(Number.isFinite(b.radius) && (b.radius >= 0)) ) errors.push(`${at}burst.radius : nombre positif ou nul`);
      if ( (typeof b.units !== "string") || !b.units ) errors.push(`${at}burst.units : unité requise`);
      if ( ("from" in b) && (!Array.isArray(b.from) || !b.from.length || !b.from.every(isId)) ) errors.push(`${at}burst.from : liste d'ids d'activité`);
      for ( const key of Object.keys(b) ) if ( !["activity", "radius", "units", "from"].includes(key) ) errors.push(`${at}burst.${key} : clé inconnue`);
    }
  }
  if ( ("recast" in entry) && (entry.recast !== true) ) errors.push(`${at}recast : true ou absent`);
  for ( const flag of ["obscures", "healMax", "duplicates", "reactiveSpell", "revealsInvisible"] ) if ( (flag in entry) && (entry[flag] !== true) ) errors.push(`${at}${flag} : true ou absent`);
  if ( "light" in entry ) validateLight(entry.light, `${at}light`, errors);
  if ( "carriedLight" in entry ) validateCarriedLight(entry.carriedLight, `${at}carriedLight`, errors);
  if ( "usageLimits" in entry ) {
    const u = entry.usageLimits;
    if ( !isObject(u) ) errors.push(`${at}usageLimits : { id d'activité: { oncePerTurn?, whenEmpty? } }`);
    else for ( const [id, rule] of Object.entries(u) ) {
      if ( !isId(id) ) errors.push(`${at}usageLimits.${id} : id d'activité (16 caractères) attendu`);
      if ( !isObject(rule) ) { errors.push(`${at}usageLimits.${id} : un objet`); continue; }
      for ( const flag of ["oncePerTurn", "lowestSlot", "noDialog", "unmoved"] ) if ( (flag in rule) && (rule[flag] !== true) ) errors.push(`${at}usageLimits.${id}.${flag} : true ou absent`);
      if ( ("whenEmpty" in rule) && ((typeof rule.whenEmpty !== "string") || !rule.whenEmpty) ) errors.push(`${at}usageLimits.${id}.whenEmpty : identifiant d'item`);
      if ( ("cost" in rule) && !["action", "bonus", "reaction"].includes(rule.cost) ) errors.push(`${at}usageLimits.${id}.cost : action, bonus, reaction`);
      for ( const key of Object.keys(rule) ) if ( !["oncePerTurn", "whenEmpty", "lowestSlot", "noDialog", "cost", "unmoved"].includes(key) ) errors.push(`${at}usageLimits.${id}.${key} : clé inconnue`);
    }
  }
  if ( ("effectsExpire" in entry) && !EFFECT_EXPIRIES.includes(entry.effectsExpire) ) errors.push(`${at}effectsExpire : ${EFFECT_EXPIRIES.join(", ")}`);
  if ( "bolt" in entry ) {
    const b = entry.bolt;
    if ( !isObject(b) || !(Number.isFinite(b.radius) && (b.radius > 0)) || (typeof b.units !== "string") || !b.units ) errors.push(`${at}bolt : { radius, units }`);
    else for ( const key of Object.keys(b) ) if ( !["radius", "units"].includes(key) ) errors.push(`${at}bolt.${key} : clé inconnue`);
  }
  if ( ("saveAdvantage" in entry) && (!Array.isArray(entry.saveAdvantage) || !entry.saveAdvantage.length
    || !entry.saveAdvantage.every(s => (typeof s === "string") && s)) ) errors.push(`${at}saveAdvantage : liste d'identifiants d'état`);
  if ( "leap" in entry ) {
    const l = entry.leap;
    if ( !isObject(l) || !(Number.isFinite(l.radius) && (l.radius > 0)) || (typeof l.units !== "string") || !l.units
      || (typeof l.max !== "string") || !l.max.trim() ) errors.push(`${at}leap : { radius, units, max }`);
    else for ( const key of Object.keys(l) ) if ( !["radius", "units", "max"].includes(key) ) errors.push(`${at}leap.${key} : clé inconnue`);
  }
  if ( "projectiles" in entry ) {
    const p = entry.projectiles;
    if ( !isObject(p) || (typeof p.count !== "string") || !p.count.trim() ) errors.push(`${at}projectiles.count : formule attendue`);
    else {
      if ( typeof p.attack !== "boolean" ) errors.push(`${at}projectiles.attack : booléen`);
      for ( const key of Object.keys(p) ) if ( !["count", "attack"].includes(key) ) errors.push(`${at}projectiles.${key} : clé inconnue`);
    }
  }
  if ( "bonusAttack" in entry ) {
    const b = entry.bonusAttack;
    if ( !isObject(b) || !Array.isArray(b.after) || !b.after.length || !b.after.every(a => BONUS_ATTACK_AFTER.includes(a)) ) {
      errors.push(`${at}bonusAttack.after : liste parmi ${BONUS_ATTACK_AFTER.join(", ")}`);
    }
    else {
      if ( ("melee" in b) && (typeof b.melee !== "boolean") ) errors.push(`${at}bonusAttack.melee : booléen`);
      for ( const key of Object.keys(b) ) if ( !["after", "melee"].includes(key) ) errors.push(`${at}bonusAttack.${key} : clé inconnue`);
    }
  }
  if ( "onFell" in entry ) {
    const f = entry.onFell;
    if ( !isObject(f) ) errors.push(`${at}onFell : un objet`);
    else {
      if ( ("activity" in f) && !isId(f.activity) ) errors.push(`${at}onFell.activity : id d'activité (16 caractères) attendu`);
      if ( !(Number.isFinite(f.radius) && (f.radius >= 0)) ) errors.push(`${at}onFell.radius : nombre positif ou nul`);
      if ( (typeof f.units !== "string") || !f.units ) errors.push(`${at}onFell.units : unité requise`);
      for ( const key of Object.keys(f) ) if ( !["activity", "radius", "units"].includes(key) ) errors.push(`${at}onFell.${key} : clé inconnue`);
    }
  }
  if ( "atTurnStart" in entry ) {
    const t = entry.atTurnStart;
    if ( !isObject(t) || !isId(t.activity) ) errors.push(`${at}atTurnStart.activity : id d'activité (16 caractères) attendu`);
    else for ( const key of Object.keys(t) ) if ( key !== "activity" ) errors.push(`${at}atTurnStart.${key} : clé inconnue`);
  }
  return errors;
}

export const PILOT_COSTS = Object.freeze(["action", "bonus", "free"]);
export const PULSE_MOMENTS = Object.freeze(["turnEnd", "enter", "moves"]);
export const PILOT_ON_CAST = Object.freeze(["use", "command"]);

function validateSummon(summon, at, errors) {
  if ( !isObject(summon) || !["after", "own", "none"].includes(summon.initiative) ) return errors.push(`${at}.initiative : « after », « own » ou « none »`);
  if ( ("endsSpell" in summon) && (summon.endsSpell !== true) ) errors.push(`${at}.endsSpell : true ou absent`);
  for ( const flag of ["endsAtZero", "mimic", "endsIfIncapacitated", "castFrom"] ) {
    if ( (flag in summon) && (summon[flag] !== true) ) errors.push(`${at}.${flag} : true ou absent`);
  }
  if ( "lasts" in summon ) {
    const l = summon.lasts;
    if ( !isObject(l) || !["string", "number"].includes(typeof l.value) || (String(l.value).trim() === "")
      || (typeof l.units !== "string") || !l.units ) errors.push(`${at}.lasts : { value, units }`);
  }
  if ( "pulse" in summon ) {
    const u = summon.pulse;
    if ( !isObject(u) ) errors.push(`${at}.pulse : un objet`);
    else {
      if ( (typeof u.item !== "string") || !u.item ) errors.push(`${at}.pulse.item : identifiant d'item requis`);
      if ( !(Number.isFinite(u.radius) && (u.radius > 0)) ) errors.push(`${at}.pulse.radius : nombre positif`);
      if ( (typeof u.units !== "string") || !u.units ) errors.push(`${at}.pulse.units : unité requise`);
      if ( ("on" in u) && (!Array.isArray(u.on) || !u.on.length || !u.on.every(m => PULSE_MOMENTS.includes(m))) ) errors.push(`${at}.pulse.on : ${PULSE_MOMENTS.join(", ")}`);
      if ( ("affects" in u) && !["any", "enemy"].includes(u.affects) ) errors.push(`${at}.pulse.affects : any, enemy`);
      for ( const key of Object.keys(u) ) if ( !["item", "radius", "units", "on", "affects"].includes(key) ) errors.push(`${at}.pulse.${key} : clé inconnue`);
    }
  }
  if ( "pilot" in summon ) {
    const p = summon.pilot;
    if ( !isObject(p) ) errors.push(`${at}.pilot : un objet`);
    else {
      if ( !PILOT_COSTS.includes(p.cost) ) errors.push(`${at}.pilot.cost : ${PILOT_COSTS.join(", ")}`);
      if ( !(Number.isFinite(p.distance) && (p.distance >= 0)) ) errors.push(`${at}.pilot.distance : nombre positif ou nul`);
      if ( (typeof p.units !== "string") || !p.units ) errors.push(`${at}.pilot.units : unité requise`);
      if ( ("onCast" in p) && !PILOT_ON_CAST.includes(p.onCast) ) errors.push(`${at}.pilot.onCast : ${PILOT_ON_CAST.join(", ")}`);
      if ( ("occupies" in p) && (p.occupies !== false) ) errors.push(`${at}.pilot.occupies : false ou absent`);
      for ( const flag of ["shared", "leash"] ) if ( (flag in p) && (p[flag] !== true) ) errors.push(`${at}.pilot.${flag} : true ou absent`);
      for ( const key of ["cluster", "tether"] ) {
        if ( !(key in p) ) continue;
        const c = p[key];
        if ( !isObject(c) || !(Number.isFinite(c.distance) && (c.distance > 0)) || (typeof c.units !== "string") || !c.units ) errors.push(`${at}.pilot.${key} : { distance, units }`);
      }
      for ( const key of Object.keys(p) ) if ( !["cost", "distance", "units", "onCast", "occupies", "shared", "cluster", "leash", "tether"].includes(key) ) errors.push(`${at}.pilot.${key} : clé inconnue`);
    }
  }
  for ( const key of Object.keys(summon) ) if ( !["initiative", "pilot", "endsSpell", "endsAtZero", "pulse", "mimic", "endsIfIncapacitated", "castFrom", "lasts"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
}

function validateAbsorb(absorb, at, errors) {
  if ( !isObject(absorb) ) return errors.push(`${at} : un objet`);
  if ( ("activeAfter" in absorb) && !isId(absorb.activeAfter) ) errors.push(`${at}.activeAfter : id d'activité (16 caractères) attendu`);
  if ( "recharge" in absorb ) {
    const r = absorb.recharge;
    if ( !isObject(r) || (typeof r.school !== "string") || !r.school ) errors.push(`${at}.recharge.school : école requise`);
    else if ( !(Number.isFinite(r.perLevel) && (r.perLevel > 0)) ) errors.push(`${at}.recharge.perLevel : nombre positif`);
  }
  for ( const key of Object.keys(absorb) ) if ( !["activeAfter", "recharge"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
}

function validateTeleport(teleport, at, errors) {
  if ( !isObject(teleport) ) return errors.push(`${at} : un objet`);
  if ( !(Number.isFinite(teleport.distance) && (teleport.distance > 0)) ) errors.push(`${at}.distance : nombre positif`);
  if ( (typeof teleport.units !== "string") || !teleport.units ) errors.push(`${at}.units : unité requise`);
  if ( ("activity" in teleport) && !isId(teleport.activity) ) errors.push(`${at}.activity : id d'activité (16 caractères) attendu`);
  if ( ("then" in teleport) && !isId(teleport.then) ) errors.push(`${at}.then : id d'activité (16 caractères) attendu`);
  for ( const key of Object.keys(teleport) ) if ( !["distance", "units", "activity", "then"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
}

function validateTargets(targets, at, facts, errors) {
  if ( !isObject(targets) ) return errors.push(`${at} : un objet`);
  if ( "types" in targets ) {
    if ( !Array.isArray(targets.types) || !targets.types.length ) errors.push(`${at}.types : liste non vide de types de créature`);
    else for ( const t of targets.types ) if ( !CREATURE_TYPES.includes(t) ) errors.push(`${at}.types : « ${t} » inconnu (${CREATURE_TYPES.join(", ")})`);
  }
  if ( "unaffectedIf" in targets ) for ( const key of unknownFacts(targets.unaffectedIf, facts) ) errors.push(`${at}.unaffectedIf : fait « ${key} » inconnu`);
  for ( const key of Object.keys(targets) ) if ( !["types", "unaffectedIf"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
}

function validateChoice(choice, at, errors) {
  if ( !isObject(choice) ) return errors.push(`${at} : un objet`);
  // §53 : `pool` seul relie des effets de l'item à une activité, sans rien à choisir (Héroïsme : la Bénédiction).
  if ( (!("pool" in choice) || ("effects" in choice)) && !CHOICE_EFFECTS.includes(choice.effects) ) errors.push(`${at}.effects : ${CHOICE_EFFECTS.join(", ")}`);
  if ( ("prompt" in choice) && (typeof choice.prompt !== "string") ) errors.push(`${at}.prompt : chaîne`);
  if ( ("pool" in choice) && !(isObject(choice.pool) && Object.entries(choice.pool).every(([a, ids]) => isId(a) && Array.isArray(ids) && ids.length && ids.every(isId))) ) {
    errors.push(`${at}.pool : { <id d'activité> : [ids d'effets] } (16 caractères)`);
  }
  for ( const key of Object.keys(choice) ) if ( !["effects", "prompt", "pool"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
}

function validateLight(l, at, errors) {
  if ( !isObject(l) ) return errors.push(`${at} : un objet`);
  if ( !LIGHT_ON.includes(l.on) ) errors.push(`${at}.on : ${LIGHT_ON.join(", ")}`);
  for ( const key of ["bright", "dim"] ) {
    if ( (key in l) && !(Number.isFinite(l[key]) && (l[key] >= 0)) ) errors.push(`${at}.${key} : nombre positif ou nul`);
  }
  if ( (("bright" in l) || ("dim" in l)) && ((typeof l.units !== "string") || !l.units) ) errors.push(`${at}.units : unité requise`);
  if ( (l.on === "effect") && !(l.dim > 0) && !(l.bright > 0) ) errors.push(`${at} : un effet lumineux donne un rayon`);
  if ( (l.on === "area") && !l.darkness && !(l.dim > 0) && !(l.bright > 0) ) errors.push(`${at} : une zone lumineuse donne un rayon`);
  for ( const flag of ["darkness", "carried", "single"] ) if ( (flag in l) && (l[flag] !== true) ) errors.push(`${at}.${flag} : true ou absent`);
  if ( l.darkness && (l.on !== "area") ) errors.push(`${at}.darkness : seulement sur une zone`);
  if ( ("dispels" in l) && !(Number.isInteger(l.dispels) && (l.dispels >= 0)) ) errors.push(`${at}.dispels : niveau de sort (entier)`);
  if ( (l.carried || l.single) && (l.on !== "summon") ) errors.push(`${at} : carried et single valent pour une invocation`);
  for ( const key of Object.keys(l) ) {
    if ( !["on", "bright", "dim", "units", "darkness", "dispels", "carried", "single"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
  }
}

/** §52 : une source de lumière portée. */
function validateCarriedLight(l, at, errors) {
  if ( !isObject(l) ) return errors.push(`${at} : un objet`);
  for ( const key of ["bright", "dim"] ) if ( !(Number.isFinite(l[key]) && (l[key] >= 0)) ) errors.push(`${at}.${key} : nombre positif ou nul`);
  if ( (typeof l.units !== "string") || !l.units ) errors.push(`${at}.units : unité requise`);
  if ( ("angle" in l) && !(Number.isFinite(l.angle) && (l.angle > 0) && (l.angle < 360)) ) errors.push(`${at}.angle : degrés, entre 0 et 360`);
  if ( ("animation" in l) && (!isObject(l.animation) || (typeof l.animation.type !== "string")) ) errors.push(`${at}.animation : { type, speed?, intensity? }`);
  for ( const key of Object.keys(l) ) if ( !["bright", "dim", "units", "angle", "animation"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
}

function validateEmanation(e, at, errors) {
  if ( !isObject(e) ) return errors.push(`${at} : un objet`);
  if ( !EMANATION_MOMENTS.includes(e.on) ) errors.push(`${at}.on : ${EMANATION_MOMENTS.join(", ")}`);
  if ( ("affects" in e) && !["any", "enemy"].includes(e.affects) ) errors.push(`${at}.affects : any, enemy`);
  if ( ("sees" in e) && (e.sees !== true) ) errors.push(`${at}.sees : true ou absent`);
  if ( ("radius" in e) && !(Number.isFinite(e.radius) && (e.radius > 0)) ) errors.push(`${at}.radius : nombre positif`);
  if ( ("radius" in e) && ((typeof e.units !== "string") || !e.units) ) errors.push(`${at}.units : unité requise avec un rayon`);
  if ( ("activity" in e) && !isId(e.activity) ) errors.push(`${at}.activity : id d'activité (16 caractères)`);
  for ( const key of Object.keys(e) ) if ( !["on", "affects", "sees", "radius", "units", "activity"].includes(key) ) errors.push(`${at}.${key} : clé inconnue`);
}

/** §20 : les parts de plus de l'Attaque sournoise et les Frappes rusées. */
function validateRogue(entry, at, errors) {
  if ( "sneakAttack" in entry ) {
    const s = entry.sneakAttack;
    if ( (s !== true) && !isObject(s) ) errors.push(`${at}sneakAttack : true, ou { dice?, anyWeapon?, alwaysVs? }`);
    else if ( isObject(s) ) {
      if ( ("dice" in s) && !/^\d+d\d+$/.test(String(s.dice)) ) errors.push(`${at}sneakAttack.dice : des dés (« 5d6 »)`);
      if ( ("anyWeapon" in s) && (s.anyWeapon !== true) ) errors.push(`${at}sneakAttack.anyWeapon : true ou absent`);
      if ( ("alwaysVs" in s) && (!Array.isArray(s.alwaysVs) || !s.alwaysVs.every(x => (typeof x === "string") && x)) ) errors.push(`${at}sneakAttack.alwaysVs : liste de types de créature`);
      for ( const key of Object.keys(s) ) if ( !["dice", "anyWeapon", "alwaysVs"].includes(key) ) errors.push(`${at}sneakAttack.${key} : clé inconnue`);
    }
  }
  if ( "sneakBonus" in entry ) {
    const b = entry.sneakBonus;
    if ( !isObject(b) || (typeof b.formula !== "string") || !b.formula.trim() ) errors.push(`${at}sneakBonus : { formula, firstRound? }`);
    else {
      if ( ("firstRound" in b) && (b.firstRound !== true) ) errors.push(`${at}sneakBonus.firstRound : true ou absent`);
      for ( const key of Object.keys(b) ) if ( !["formula", "firstRound"].includes(key) ) errors.push(`${at}sneakBonus.${key} : clé inconnue`);
    }
  }
  if ( "cunningStrikes" in entry ) {
    const c = entry.cunningStrikes;
    if ( !isObject(c) || !Object.keys(c).length ) errors.push(`${at}cunningStrikes : { clé: { cost, activity?, requires?, sizeAtMost?, withdraw? } }`);
    else for ( const [key, s] of Object.entries(c) ) {
      const here = `${at}cunningStrikes.${key}`;
      if ( !isObject(s) ) { errors.push(`${here} : un objet`); continue; }
      if ( !(Number.isInteger(s.cost) && (s.cost > 0)) ) errors.push(`${here}.cost : entier positif (dés)`);
      if ( ("activity" in s) && !isId(s.activity) ) errors.push(`${here}.activity : id d'activité (16 caractères)`);
      if ( ("requires" in s) && ((typeof s.requires !== "string") || !s.requires) ) errors.push(`${here}.requires : identifiant d'item`);
      if ( ("sizeAtMost" in s) && !SIZES.includes(s.sizeAtMost) ) errors.push(`${here}.sizeAtMost : ${SIZES.join(", ")}`);
      if ( ("withdraw" in s) && (s.withdraw !== true) ) errors.push(`${here}.withdraw : true ou absent`);
      if ( !("activity" in s) && !s.withdraw ) errors.push(`${here} : une activité ou withdraw`);
      for ( const k of Object.keys(s) ) if ( !["cost", "activity", "requires", "sizeAtMost", "withdraw"].includes(k) ) errors.push(`${here}.${k} : clé inconnue`);
    }
  }
  if ( "movesAfter" in entry ) {
    const m = entry.movesAfter;
    const ok = ((typeof m === "string") && m) || (isObject(m) && (typeof m.item === "string") && m.item
      && (!("disengage" in m) || (typeof m.disengage === "boolean")) && Object.keys(m).every(k => ["item", "disengage"].includes(k)));
    if ( !ok ) errors.push(`${at}movesAfter : identifiant d'item, ou { item, disengage? }`);
  }
  if ( "effectEnds" in entry ) {
    const e = entry.effectEnds;
    if ( !isObject(e) || !Object.keys(e).length ) errors.push(`${at}effectEnds : { id d'effet: ${EFFECT_ENDS.join(" | ")} }`);
    else for ( const [id, when] of Object.entries(e) ) {
      if ( !isId(id) ) errors.push(`${at}effectEnds.${id} : id d'effet (16 caractères)`);
      if ( !EFFECT_ENDS.includes(when) ) errors.push(`${at}effectEnds.${id} : ${EFFECT_ENDS.join(", ")}`);
    }
  }
  if ( "actionEnds" in entry ) {
    const e = entry.actionEnds;
    if ( !isObject(e) || !Object.keys(e).length ) errors.push(`${at}actionEnds : { id d'effet: { by, roll?, verb? } }`);
    else for ( const [id, rule] of Object.entries(e) ) {
      const ok = isId(id) && isObject(rule) && ACTION_END_BY.includes(rule.by)
        && (!("roll" in rule) || ACTION_END_ROLLS.includes(rule.roll)) && !((rule.by === "other") && (rule.roll === "save"))
        && (!("verb" in rule) || ACTION_END_VERBS.includes(rule.verb))
        && (!("status" in rule) || ((rule.by === "bearer") && ACTION_END_STATUSES.includes(rule.status)))
        && Object.keys(rule).every(k => ["by", "roll", "verb", "status"].includes(k));
      if ( !ok ) errors.push(`${at}actionEnds.${id} : { by: ${ACTION_END_BY.join(" | ")}, roll?: ${ACTION_END_ROLLS.join(" | ")} (pas « save » pour « other »), verb?: ${ACTION_END_VERBS.join(" | ")}, status?: ${ACTION_END_STATUSES.join(" | ")} (porteur) }`);
    }
  }
  if ( "effectThen" in entry ) {
    const e = entry.effectThen;
    if ( !isObject(e) || !Object.keys(e).length ) errors.push(`${at}effectThen : { id d'effet: id d'effet }`);
    else for ( const [id, next] of Object.entries(e) ) {
      if ( !isId(id) || !isId(next) || (id === next) ) errors.push(`${at}effectThen.${id} : deux ids d'effets distincts (16 caractères)`);
    }
  }
  if ( ("smite" in entry) && !(isObject(entry.smite) && isId(entry.smite.damage)
    && ["fiends", "save", "effect"].every(k => !(k in entry.smite) || isId(entry.smite[k]))
    && Object.keys(entry.smite).every(k => ["damage", "fiends", "save", "effect"].includes(k))) ) errors.push(`${at}smite : { damage, fiends?, save?, effect? } (ids d'activités, id d'effet)`);
  if ( ("metamagic" in entry) && !(isObject(entry.metamagic) && isId(entry.metamagic.activity) && METAMAGIC_KINDS.includes(entry.metamagic.kind)
    && Object.keys(entry.metamagic).every(k => ["activity", "kind"].includes(k))) ) errors.push(`${at}metamagic : { activity, kind: ${METAMAGIC_KINDS.join(" | ")} }`);
  if ( ("rollBonus" in entry) && !(isObject(entry.rollBonus) && isId(entry.rollBonus.activity) && Array.isArray(entry.rollBonus.on)
    && entry.rollBonus.on.length && entry.rollBonus.on.every(k => ["save", "check"].includes(k))
    && Object.keys(entry.rollBonus).every(k => ["activity", "on"].includes(k))) ) errors.push(`${at}rollBonus : { activity, on: ["save" | "check"] }`);
  if ( ("transpose" in entry) && !(isObject(entry.transpose) && (typeof entry.transpose.summon === "string") && entry.transpose.summon
    && Object.keys(entry.transpose).every(k => k === "summon")) ) errors.push(`${at}transpose : { summon } (identifiant de l'item d'invocation)`);
  if ( ("portent" in entry) && !(isObject(entry.portent) && Number.isInteger(entry.portent.dice) && (entry.portent.dice > 0)
    && Object.keys(entry.portent).every(k => k === "dice")) ) errors.push(`${at}portent : { dice } (entier positif)`);
  if ( ("hitRider" in entry) && !(isObject(entry.hitRider) && Object.keys(entry.hitRider).length
    && Object.keys(entry.hitRider).every(k => ["damage", "effect", "status", "sizeAtMost", "slot", "weapon", "oncePerTurn", "save", "item"].includes(k))
    && (!("slot" in entry.hitRider) || (entry.hitRider.slot === "pact"))
    && (!("weapon" in entry.hitRider) || (typeof entry.hitRider.weapon === "string"))
    && (!("oncePerTurn" in entry.hitRider) || (entry.hitRider.oncePerTurn === true))
    && ["damage", "effect", "save"].every(k => !(k in entry.hitRider) || isId(entry.hitRider[k]))
    && (!("item" in entry.hitRider) || (typeof entry.hitRider.item === "string"))
    && (!("status" in entry.hitRider) || (typeof entry.hitRider.status === "string"))
    && (!("sizeAtMost" in entry.hitRider) || SIZES.includes(entry.hitRider.sizeAtMost))) ) {
    errors.push(`${at}hitRider : { damage?, effect?, status?, sizeAtMost?, slot?: "pact", weapon?, oncePerTurn?: true, save?, item? }`);
  }
  if ( ("flurry" in entry) && !(isObject(entry.flurry) && isId(entry.flurry.activity) && Number.isInteger(entry.flurry.strikes) && (entry.flurry.strikes > 0)
    && (!("weapons" in entry.flurry) || (typeof entry.flurry.weapons === "boolean"))
    && Object.keys(entry.flurry).every(k => ["activity", "strikes", "weapons"].includes(k))) ) {
    errors.push(`${at}flurry : { activity, strikes, weapons? }`);
  }
  if ( ("stunningStrike" in entry) && !(isObject(entry.stunningStrike) && isId(entry.stunningStrike.activity) && (typeof entry.stunningStrike.focus === "string")) ) {
    errors.push(`${at}stunningStrike : { activity, focus }`);
  }
  if ( ("openHand" in entry) && !(isObject(entry.openHand) && Object.keys(entry.openHand).length && Object.values(entry.openHand).every(isId)) ) {
    errors.push(`${at}openHand : { clé: id d'activité }`);
  }
  if ( ("byWounds" in entry) && !(isObject(entry.byWounds) && isId(entry.byWounds.healthy) && isId(entry.byWounds.wounded)
    && (Object.keys(entry.byWounds).length === 2)) ) errors.push(`${at}byWounds : { healthy, wounded } (ids d'activités)`);
  if ( ("rage" in entry) && !(isObject(entry.rage) && isId(entry.rage.effect) && (Object.keys(entry.rage).length === 1)) ) errors.push(`${at}rage : { effect } (id d'effet)`);
  if ( ("relentless" in entry) && !(isObject(entry.relentless) && isId(entry.relentless.activity) && (Object.keys(entry.relentless).length === 1)) ) {
    errors.push(`${at}relentless : { activity } (id d'activité)`);
  }
  if ( ("thrownDamage" in entry) && !(Number.isInteger(entry.thrownDamage) && (entry.thrownDamage > 0)) ) errors.push(`${at}thrownDamage : entier positif`);
  if ( ("cunningStrikeMax" in entry) && !(Number.isInteger(entry.cunningStrikeMax) && (entry.cunningStrikeMax >= 1)) ) {
    errors.push(`${at}cunningStrikeMax : entier ≥ 1`);
  }
}

/** Les erreurs d'une table entière `{ identifiant: entrée }`. */
export function validateTable(table, { facts={} }={}) {
  if ( !isObject(table) ) return ["la table est un objet { identifiant: entrée }"];
  return Object.entries(table).flatMap(([id, entry]) => validateEntry(entry, { facts, at: `${id}.` }));
}

/**
 * Combine les couches, de la moins à la plus spécifique (module → monde → item). Par clé :
 * `triggers` est REMPLACÉ (une liste se réécrit entière), `aura`, `onHit`, `choice` et `targets` sont fusionnés
 * champ par champ (corriger un rayon sans redire le reste).
 * @param {Array<object|null|undefined>} layers
 * @returns {object|null}  null si aucune couche ne dit rien.
 */
export function mergeEntries(layers) {
  let out = null;
  for ( const layer of layers ) {
    if ( !isObject(layer) || !Object.keys(layer).length ) continue;
    out ??= {};
    if ( "triggers" in layer ) out.triggers = Array.isArray(layer.triggers) ? [...layer.triggers] : [layer.triggers];
    if ( "aura" in layer ) out.aura = { ...(out.aura ?? {}), ...layer.aura };
    if ( "onHit" in layer ) out.onHit = { ...(out.onHit ?? {}), ...layer.onHit };
    if ( "choice" in layer ) out.choice = { ...(out.choice ?? {}), ...layer.choice };
    if ( "targets" in layer ) out.targets = { ...(out.targets ?? {}), ...layer.targets };
    if ( "trace" in layer ) out.trace = (typeof layer.trace === "object") ? { ...((typeof out.trace === "object") ? out.trace : {}), ...layer.trace } : layer.trace;
    if ( "enchantTarget" in layer ) out.enchantTarget = layer.enchantTarget;
    if ( "ranges" in layer ) out.ranges = { ...(out.ranges ?? {}), ...layer.ranges };
    if ( "tether" in layer ) out.tether = { ...(out.tether ?? {}), ...layer.tether };
    if ( "pact" in layer ) out.pact = { ...(out.pact ?? {}), ...layer.pact };
    if ( "damageShield" in layer ) out.damageShield = { ...(out.damageShield ?? {}), ...layer.damageShield };
    if ( "hitDiceHeal" in layer ) out.hitDiceHeal = { ...(out.hitDiceHeal ?? {}), ...layer.hitDiceHeal };
    if ( "teleport" in layer ) out.teleport = { ...(out.teleport ?? {}), ...layer.teleport };
    if ( "lineDash" in layer ) out.lineDash = { ...(out.lineDash ?? {}), ...layer.lineDash };
    if ( "absorb" in layer ) out.absorb = { ...(out.absorb ?? {}), ...layer.absorb };
    if ( "summon" in layer ) out.summon = { ...(out.summon ?? {}), ...layer.summon };
    if ( "movable" in layer ) out.movable = { ...(out.movable ?? {}), ...layer.movable };
    if ( "burst" in layer ) out.burst = { ...(out.burst ?? {}), ...layer.burst };
    if ( "recast" in layer ) out.recast = layer.recast;
    if ( "obscures" in layer ) out.obscures = layer.obscures;
    if ( "revealsInvisible" in layer ) out.revealsInvisible = layer.revealsInvisible;
    if ( "effectsExpire" in layer ) out.effectsExpire = layer.effectsExpire;
    if ( "usageLimits" in layer ) out.usageLimits = { ...(out.usageLimits ?? {}), ...layer.usageLimits };
    if ( "healMax" in layer ) out.healMax = layer.healMax;
    if ( "duplicates" in layer ) out.duplicates = layer.duplicates;
    if ( "reactiveSpell" in layer ) out.reactiveSpell = layer.reactiveSpell;
    if ( "saveAdvantage" in layer ) out.saveAdvantage = [...layer.saveAdvantage];
    if ( "onFell" in layer ) out.onFell = { ...(out.onFell ?? {}), ...layer.onFell };
    if ( "bonusAttack" in layer ) out.bonusAttack = { ...(out.bonusAttack ?? {}), ...layer.bonusAttack };
    if ( "projectiles" in layer ) out.projectiles = { ...(out.projectiles ?? {}), ...layer.projectiles };
    if ( "leap" in layer ) out.leap = { ...(out.leap ?? {}), ...layer.leap };
    if ( "bolt" in layer ) out.bolt = { ...(out.bolt ?? {}), ...layer.bolt };
    if ( "light" in layer ) out.light = { ...(out.light ?? {}), ...layer.light };
    if ( "atTurnStart" in layer ) out.atTurnStart = { ...(out.atTurnStart ?? {}), ...layer.atTurnStart };
    // §16.47
    if ( "breaksOn" in layer ) out.breaksOn = [...layer.breaksOn];
    if ( "noReactions" in layer ) out.noReactions = layer.noReactions;
    if ( "actionOrBonus" in layer ) out.actionOrBonus = layer.actionOrBonus;   // §77
    if ( "cures" in layer ) out.cures = [...layer.cures];
    if ( "curesAll" in layer ) out.curesAll = [...layer.curesAll];
    if ( "potionEffect" in layer ) out.potionEffect = layer.potionEffect;
    if ( "castTargets" in layer ) out.castTargets = layer.castTargets;
    if ( "effectChanges" in layer ) out.effectChanges = { ...(out.effectChanges ?? {}), ...layer.effectChanges };
    if ( "advantageIfFighting" in layer ) out.advantageIfFighting = layer.advantageIfFighting;
    if ( "emanation" in layer ) out.emanation = { ...(out.emanation ?? {}), ...layer.emanation };
    if ( "regeneration" in layer ) out.regeneration = layer.regeneration;
    if ( "fortitude" in layer ) out.fortitude = layer.fortitude;
    if ( "noOpportunity" in layer ) out.noOpportunity = layer.noOpportunity;
    if ( "drain" in layer ) out.drain = layer.drain;
    if ( "swallow" in layer ) out.swallow = layer.swallow;
    if ( "savedEffects" in layer ) out.savedEffects = [...layer.savedEffects];
    if ( "ignoresCloseCombat" in layer ) out.ignoresCloseCombat = layer.ignoresCloseCombat;
    if ( "sharedHp" in layer ) out.sharedHp = layer.sharedHp;
    if ( "failMargins" in layer ) out.failMargins = { ...(out.failMargins ?? {}), ...layer.failMargins };
    if ( "resize" in layer ) out.resize = { ...(out.resize ?? {}), ...layer.resize };
    if ( "orders" in layer ) out.orders = [...layer.orders];
    if ( "reactions" in layer ) out.reactions = { ...layer.reactions };
    if ( "lastStand" in layer ) out.lastStand = { ...layer.lastStand };
    if ( "counter" in layer ) out.counter = { ...layer.counter };
    if ( "difficultTerrain" in layer ) out.difficultTerrain = { ...layer.difficultTerrain };   // §69
    if ( "storm" in layer ) out.storm = { ...layer.storm };   // §70
    if ( "stableAtZero" in layer ) out.stableAtZero = layer.stableAtZero;   // §71
    if ( "wardsAtZero" in layer ) out.wardsAtZero = layer.wardsAtZero;   // §73
    if ( "zoneCharges" in layer ) out.zoneCharges = layer.zoneCharges;   // §75
    if ( "noDamage" in layer ) out.noDamage = [...layer.noDamage];   // §81
    if ( "selfZone" in layer ) out.selfZone = JSON.parse(JSON.stringify(layer.selfZone));   // §86
    if ( "zoneAffects" in layer ) out.zoneAffects = layer.zoneAffects;   // §86
    if ( "effectsIf" in layer ) out.effectsIf = layer.effectsIf;   // §71
    if ( "contest" in layer ) out.contest = { ...layer.contest };   // §72
    if ( "forOneAttack" in layer ) out.forOneAttack = layer.forOneAttack;
    if ( "basicActions" in layer ) out.basicActions = { ...(out.basicActions ?? {}), ...layer.basicActions };
    if ( "secondPhase" in layer ) out.secondPhase = { ...(out.secondPhase ?? {}), ...layer.secondPhase };
    if ( "changesForm" in layer ) out.changesForm = { ...(out.changesForm ?? {}), ...layer.changesForm };   // §76
    // §19.9
    if ( "empower" in layer ) out.empower = { ...(out.empower ?? {}), ...layer.empower };
    if ( "discharge" in layer ) out.discharge = { ...(out.discharge ?? {}), ...layer.discharge };
    if ( "healsDownedMax" in layer ) out.healsDownedMax = layer.healsDownedMax;
    // §20
    for ( const key of ["sneakAttack", "evasion", "elusive", "holdsStill", "cunningStrikeMax", "grantsAction", "movesAfter", "studiedAttacks",
      "heroicWarrior", "greatWeaponFighting", "thrownDamage", "rage", "persistentRage", "reckless", "relentless", "blocksHealing",
      "noOpportunityAttacks", "byWounds", "oneAttack", "martialArts", "flurry", "stunningStrike", "openHand", "smite", "supremeHealing", "discipleOfLife", "blessedHealer", "potentCantrip", "sculptSpells", "endurance", "replacesAttack", "hitRider", "metamagic", "portent", "dispel", "zoneEffects", "rollBonus", "transpose", "stabilizes", "carriedLight", "kindles"] ) if ( key in layer ) out[key] = layer[key];
    if ( "effectEnds" in layer ) out.effectEnds = { ...(out.effectEnds ?? {}), ...layer.effectEnds };
    if ( "effectThen" in layer ) out.effectThen = { ...(out.effectThen ?? {}), ...layer.effectThen };
    if ( "actionEnds" in layer ) out.actionEnds = { ...(out.actionEnds ?? {}), ...layer.actionEnds };
    if ( "sneakBonus" in layer ) out.sneakBonus = { ...(out.sneakBonus ?? {}), ...layer.sneakBonus };
    if ( "cunningStrikes" in layer ) out.cunningStrikes = { ...(out.cunningStrikes ?? {}), ...layer.cunningStrikes };
  }
  return out;
}
