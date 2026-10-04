/**
 * Contenu livré avec le module (SPEC §13.4) : ce que les données d'un item dnd5e ne disent pas et
 * que le texte de la règle dit — quand une réaction s'ouvre, quand une zone rejoue son sort, quels
 * dégâts bonus s'ajoutent. Indexé par `system.identifier` (celui du compendium du système, gardé
 * par les copies sur les fiches) : rien n'est écrit sur les items, mettre à jour ce fichier met à
 * jour tout le monde. Un item peut porter le sien dans `flags["dnd5e-combat"].triggers`, qui
 * l'emporte. Forme et vocabulaire : `core/triggers.mjs` ; faits disponibles : `adapter/triggers.mjs`.
 *
 * Étapes connues (le schéma complet est dans core/content.mjs, les briques au SPEC §16) :
 *   { type: "use", target?: "source" }   réaction : proposer l'activité de réaction de l'item ;
 *                                        `target: "source"` = elle vise qui a provoqué la fenêtre
 *   { type: "replay", activity? }        zone qui dure : rejouer l'activité (ou une sœur) contre la créature
 *   { type: "damage", formula, damageType }   part de dégâts ajoutée au jet (preDamageRoll) ; "weapon" = type de l'arme
 *   { type: "move", mode, distance, units }   la cible est repoussée / attirée (moments hit, failedSave)
 *   { type: "status", status }           un état natif posé sur la cible (moments hit, failedSave)
 *   { type: "resave" }                   avec `via: "effect"` : le porteur de l'effet rejoue la sauvegarde
 *   { type: "remove" }                   avec `via: "effect"` : l'effet cesse (isDamaged : Sommeil, Motif hypnotique)
 *   { type: "advantage" | "disadvantage" }   une raison d'avantage / désavantage à l'attaque (preAttackRoll)
 *   { type: "ward", activity? }          avec `via: "effect"` : l'attaquant du porteur doit réussir la sauvegarde (isAttacked)
 *
 * Identifiants vérifiés dans packs/_source/spells24 de dnd5e 6.0.3 (`system.identifier`), et pour les
 * items hors SRD dans le module premium PHB 2.2.0 ou les fiches de `dandd` (INVENTAIRE_PJ.md).
 */

export const TRIGGERS = Object.freeze({
  // Réactions (règles 2024)
  "shield": [{ on: "isHit", do: [{ type: "use" }] }],
  // Esquive instinctive (PHB, roublard 5) : « quand un attaquant que vous voyez vous touche avec un jet d'attaque, vous
  // pouvez utiliser votre réaction pour réduire de moitié les dégâts de l'attaque » (§16.11, B14).
  // §74 : Parade du Monster Manual 2024 (`mmParry000000000`, Noble, Chevalier…) — « touché par un jet d'attaque de corps à corps
  // alors qu'il tient une arme : ajoute son bonus de maîtrise à sa CA contre cette attaque, ce qui peut la faire échouer ». L'item n'a
  // aucun effet : le bonus passe par le rejugement du coup (`penalty` : retiré au jet, c'est-à-dire ajouté à la CA, §33). « Tient
  // une arme » n'est pas contrôlé.
  "parry": [{ on: "isHit", if: { "activity.isMelee": true }, do: [{ type: "use" }, { type: "penalty", formula: "@prof" }] }],
  "uncanny-dodge": [{ on: "isHit", if: { "target.seesSource": true }, do: [{ type: "use" }, { type: "halve" }] }],
  // Lien protecteur (PHB) : « chaque fois qu'elle subit des dégâts, vous subissez le même montant » — porté par l'effet
  // « Bonded » de la cible, qui fait déjà résistance, +1 à la CA et aux sauvegardes (§16.11).
  "warding-bond": [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "origin" }] }],
  // « …par une créature à 60 ft que vous pouvez voir » : la vision (P1) tient la condition.
  "hellish-rebuke": [{ on: "isDamaged", if: { "target.seesSource": true }, do: [{ type: "use", target: "source" }] }],

  // Zones qui durent : « sauvegarde en entrant ou en finissant son tour dedans, une fois par tour »
  "moonbeam": [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],
  "spirit-guardians": [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],
  "cloud-of-daggers": [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],
  // §75 : Cordon de flèches (version simple, demandée par l'utilisateur) — la sphère de 9 m que pose l'action du sort ; une créature qui y
  // entre ou y termine son tour reçoit un projectile : la sauvegarde de Dextérité de l'activité sœur (2d4 perforants). Quatre
  // projectiles (`zoneCharges`, content/spell-rules.mjs), puis le sort prend fin. Les créatures désignées à épargner : au MJ.
  "cordon-of-arrows": [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dnd5eactivity000" }] }],
  // Croissance d'épines (§16.20) : « 2d4 perforants pour chaque tranche de 1,50 m parcourue » en y entrant ou dedans.
  "spike-growth": [{ on: "moves", do: [{ type: "replay" }] }],
  "wall-of-fire": [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],

  // Dégâts bonus : chaque attaque qui touche la cible maudite ajoute 1d6 nécrotiques.
  "hex": [{
    on: "preDamageRoll",
    if: { "activity.isAttack": true, "target.hasEffectFrom": "hex" },
    do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }]
  }],
  // Voile spirituel (Tasha, item « Automatisations Darsh » de l'occultiste de la table) : +1d8 aux attaques qui touchent
  // une créature à 10 ft ou moins du lanceur, tant que celui-ci porte l'effet du sort. Le type (radiant, nécrotique, froid) est choisi à l'incantation : nécrotique
  // ici, l'item de la fiche pourra le corriger dans son flag `triggers`.
  "spirit-shroud": [{
    on: "preDamageRoll",
    if: { "activity.isAttack": true, "source.hasEffect": "spirit-shroud", "target.within": { distance: 10, units: "ft" } },
    do: [{ type: "damage", formula: "1d8", damageType: "necrotic" }]
  }],
  // Grand maître d'armes 2024 (PHB, feats) : un coup porté avec une arme Lourde ajoute le bonus de maîtrise aux
  // dégâts, du type de l'arme.
  "great-weapon-master": [{
    on: "preDamageRoll",
    if: { "activity.isAttack": true, "activity.isWeapon": true, "activity.hasProperty": "hvy" },
    do: [{ type: "damage", formula: "@prof", damageType: "weapon" }]
  }],

  // Zone posée par une activité, rejouée par une sœur : « Créer un nuage » (utilitaire) pose la sphère,
  // « Sauvegarde de début de tour » (dnd5eactivity000, spells24) agit sur qui commence son tour dedans.
  "stinking-cloud": [{ on: "turnStart", do: [{ type: "replay", activity: "dnd5eactivity000" }] }],
  // Tempête de neige : « pénètre dans le Cylindre pour la première fois d'un tour ou y commence son tour » :
  // sauvegarde de Dextérité, À terre sur un échec (l'item n'a pas d'effet : l'état est posé par le moteur).
  "sleet-storm": [
    { on: ["enter", "turnStart"], do: [{ type: "replay" }] },
    { on: "failedSave", do: [{ type: "status", status: "prone" }] }
  ],

  // Déplacement forcé (SPEC §16) : « le choc l'éloigne de 3 m de vous » sur un échec…
  // Main de Bigby (items de la main invoquée, PHB 2.2.0, §16.15) : « une créature de taille TG ou inférieure… la main la
  // pousse de 1,50 m plus cinq fois votre modificateur » ; « … ou elle a l'état Agrippé, DD d'évasion = votre DD de sort ».
  "forceful-hand": [{ on: "failedSave", if: { "target.sizeAtMost": "huge" }, do: [{ type: "move", mode: "push", distance: "5 + 5 * @flags.dnd5e.summon.mod", units: "ft", follow: true }] }],
  "grasping-hand": [{ on: "failedSave", if: { "target.sizeAtMost": "huge" }, do: [{ type: "status", status: "grappled" }] }],
  // Invoquer la duplicité (§16.18) : Avantage contre une créature qui voit l'illusion, si le clerc et son double sont
  // tous deux à 1,50 m d'elle.
  "invoke-duplicity": [{
    on: "preAttackRoll",
    if: { "target.within": { distance: 5, units: "ft" }, "source.summonNearTarget": { item: "invoke-duplicity", distance: 5, units: "ft" } },
    do: [{ type: "advantage" }]
  }],
  // Frappe occulte (PHB 2.2.0, invocation) : la cible de taille TG au plus peut en plus être jetée À terre —
  // une activité de dégâts utilisée après le toucher (§16.19) ; facultatif dans la règle, toujours appliqué ici.
  "eldritch-smite": [{ on: "hit", if: { "target.sizeAtMost": "huge" }, do: [{ type: "status", status: "prone" }] }],
  "thunderwave": [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }],
  // Bourrasque (PHB, `phbsplGustofWind`, §37.3) : sauvegarde de Force pour chaque créature de la Ligne, repoussée de 4,50 m le
  // long de la Ligne en cas d'échec ; qui finit son tour dans la Ligne la refait. La pose
  // est la sauvegarde de l'activité ; la zone dure et rejoue en fin de tour. Au joueur : le déplacement doublé vers le lanceur, le
  // changement de direction par action Bonus.
  "gust-of-wind": [
    { on: "turnEnd", do: [{ type: "replay" }] },
    { on: "failedSave", do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }
  ],
  // …Télékinésiste (PHB, feats, identifiant `telekinetic` ; ses trois activités sont des sauvegardes de Force) :
  // repoussé de 1,50 m. L'item du magicien de la table (`telekinetic-shove`, CPR) sera remplacé par celui du compendium (INVENTAIRE §E)…
  "telekinetic": [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }],
  // …Fouet d'épines (PHB, spells) : une cible de taille G au plus est tirée de 3 m au plus vers le lanceur.
  "thorn-whip": [{ on: "hit", if: { "target.sizeAtMost": "lg" }, do: [{ type: "move", mode: "pull", distance: 10, units: "ft" }] }],

  // Sauvegarde répétée (SPEC §16) : « la cible réitère le JS à la fin de chacun de ses tours et met un terme
  // au sort sur elle-même en cas de réussite ». Portée par l'effet posé (Paralysé, Cécité, Surdité).
  "hold-person": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // …et sur dégâts : « chaque fois qu'elle subit des dégâts, elle réitère le JS » (Domination de bête, de personne,
  // de monstre). Fou rire de Tasha : les deux — la fin de chacun de ses tours ET chaque fois qu'elle subit des dégâts
  // (l'avantage que la règle donne au jet provoqué par les dégâts n'est pas repris).
  "dominate-beast": [{ on: "isDamaged", via: "effect", do: [{ type: "resave" }] }],
  "dominate-person": [{ on: "isDamaged", via: "effect", do: [{ type: "resave" }] }],
  "dominate-monster": [{ on: "isDamaged", via: "effect", do: [{ type: "resave" }] }],
  "hideous-laughter": [{ on: ["endOfTurn", "isDamaged"], via: "effect", do: [{ type: "resave" }] }],
  // §42.2 : le même sort dans le Manuel des joueurs s'appelle « tashas-hideous-laughter » (« hideous-laughter » est son nom du
  // SRD, celui du pack de dnd5e) — sans cette clé, la règle ne valait pour aucune fiche de joueur (relevé le 2026-10-01).
  "tashas-hideous-laughter": [{ on: ["endOfTurn", "isDamaged"], via: "effect", do: [{ type: "resave" }] }],
  // §42.2 : les autres sorts du Manuel des joueurs dont « la cible réitère le JS à la fin de chacun de ses tours et met un
  // terme au sort sur elle-même en cas de réussite » — Immobilisation de monstre, Lenteur, Confusion, Éclat du soleil, et la
  // peur du Châtiment courroucé.
  "hold-monster": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "slow": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "confusion": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "sunburst": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // §43.1 : Contagion — « la cible réitère le JS à la fin de chacun de ses tours jusqu'à obtenir trois réussites ou trois
  // échecs : trois réussites, le sort prend fin ; trois échecs, il dure 7 jours » (la durée de l'effet). Compteur.
  "contagion": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", tally: { successes: 3, failures: 3 } }] }],
  // §43.1 : Pétrification — l'effet « Turning to Stone » (Xt8AUh0PfYhGYBvY, Entravé) : « un autre JS de Constitution à la fin
  // de chacun de ses tours ; trois réussites, le sort prend fin ; trois échecs, elle est Pétrifiée ».
  "flesh-to-stone": [{ on: "endOfTurn", via: "effect", fromEffect: "Xt8AUh0PfYhGYBvY",
    do: [{ type: "resave", tally: { successes: 3, failures: 3, status: "petrified" } }] }],
  "wrathful-smite": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Assassin imaginaire : « un JS de Sagesse à la fin de chacun de ses tours ; raté, elle subit de nouveau les dégâts
  // psychiques ; réussi, le sort prend fin » — les dégâts sont ceux de l'activité du sort, au niveau lancé.
  "phantasmal-killer": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "dnd5eactivity000" }] }],
  // Ennemi subconscient : « une cible Effrayée fait un JS de Sagesse à la fin de chacun de ses tours ; raté, 5d10 dégâts
  // psychiques ; réussi, le sort prend fin sur elle » — l'activité « End of Turn Save » (nuStSySOEkwOUnXf) porte les 5d10.
  "weird": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "nuStSySOEkwOUnXf" }] }],
  // Terreur : « si la créature termine son tour dans un espace d'où elle n'a pas de ligne de vue sur vous, elle fait un JS de
  // Sagesse ; réussi, le sort prend fin sur elle ». (La fuite — action Foncer, s'éloigner — reste au joueur ou au MJ.)
  "fear": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", unlessSeesOrigin: true }] }],
  // Châtiment de fournaise : la cible brûle (1d6 feu) au début de chacun de ses tours, puis tente un JS de Constitution qui, réussi,
  // éteint le sort — l'effet « Seared » (A0tTvLeRetrC708K) est posé par le châtiment (`smite.effect`) ; les
  // dégâts d'abord (activité « Damage », au niveau lancé), la sauvegarde ensuite : deux déclarations, dans cet ordre.
  "searing-smite": [
    { on: "startOfTurn", via: "effect", fromEffect: "A0tTvLeRetrC708K", do: [{ type: "damage", to: "bearer", activity: "M4KS57lcf4K6fUMU" }] },
    { on: "startOfTurn", via: "effect", fromEffect: "A0tTvLeRetrC708K", do: [{ type: "resave" }] }
  ],
  // Châtiment de cécité : la cible reste Aveuglée tant que dure le sort, avec un JS de Constitution en fin de chacun de ses tours
  // pour s'en libérer — l'effet « Blinded » (5FPaEGhqJ5yPP2Ln) posé par le châtiment, la sauvegarde « End of Turn Save ».
  "blinding-smite": [{ on: "endOfTurn", via: "effect", fromEffect: "5FPaEGhqJ5yPP2Ln", do: [{ type: "resave" }] }],

  // Effet qui cesse sur dégâts (SPEC §16, B8) : « le sort prend fin pour une cible qui subit des dégâts ». Porté par
  // l'effet posé (Neutralisé ; Charmé et Neutralisé). Secouer la créature (une action d'un autre) reste à la main.
  "sleep": [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }],
  "hypnotic-pattern": [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }],
  // §65 : Suggestion — « la suggestion prend fin si vous ou vos alliés infligez des dégâts à la cible » : seulement ces dégâts-là.
  "suggestion": [{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }],
  // §42.2 : Apaisement des émotions — « cette indifférence prend fin si la cible subit des dégâts » : le seul effet
  // « Indifference » (cb3KFq1j9UkOUV2l) ; l'autre option (Charmé et Effrayé supprimés) ne cesse pas sur dégâts.
  "calm-emotions": [{ on: "isDamaged", via: "effect", fromEffect: "cb3KFq1j9UkOUV2l", do: [{ type: "remove" }] }],
  // Renvoi des morts-vivants (§16.25) : « pendant 1 minute ou jusqu'à ce qu'il subisse des dégâts » — l'effet « Turned »
  // (iUeSbfduM7K8XrCF) ; Calcination (OftTd0Eiwnls76cX) : « ces dégâts ne mettent pas fin au renvoi » — ils sont appliqués
  // avant que l'effet soit posé, la déclaration ne le voit pas encore (runtime/triggers.mjs, `onDamaged`).
  "channel-divinity": [{ on: "isDamaged", via: "effect", fromEffect: "iUeSbfduM7K8XrCF", do: [{ type: "remove" }] }],
  "channel-divinity-cleric": [{ on: "isDamaged", via: "effect", fromEffect: "iUeSbfduM7K8XrCF", do: [{ type: "remove" }] }],
  "sear-undead": [{ on: "isDamaged", via: "effect", fromEffect: "OftTd0Eiwnls76cX", do: [{ type: "remove" }] }],

  // Riposte (SPEC §16.9, B9) : « si une créature vous touche avec une attaque au corps à corps… ».
  // Bouclier de feu (spells24 et PHB, mêmes ids d'effets) : « située dans un rayon de 1,50 m », 2d8 — de feu avec le
  // bouclier chaud (effet YbUr13GTnMrootmf, résistance au froid), de froid avec le bouclier froid (CMEUOmIT16kjGT5J).
  "fire-shield": [
    { on: "isHit", via: "effect", fromEffect: "YbUr13GTnMrootmf", if: { "activity.isMelee": true, "target.within": { distance: 5, units: "ft" } },
      do: [{ type: "damage", to: "source", formula: "2d8", damageType: "fire" }] },
    { on: "isHit", via: "effect", fromEffect: "CMEUOmIT16kjGT5J", if: { "activity.isMelee": true, "target.within": { distance: 5, units: "ft" } },
      do: [{ type: "damage", to: "source", formula: "2d8", damageType: "cold" }] }
  ],
  // Armure d'Agathys (PHB) : « tant que vous avez ces PV temporaires », 5 dégâts de froid par niveau de sort — l'activité
  // de dégâts de l'item (dnd5eactivity200), rejouée au niveau de lancement ; portée par la trace (content/traces.mjs),
  // qui tombe quand les PV temporaires sont épuisés (« le sort prend fin plus tôt »).
  "armor-of-agathys": [
    { on: "isHit", via: "effect", if: { "activity.isMelee": true, "target.hasTempHp": true }, do: [{ type: "damage", to: "source", activity: "dnd5eactivity200" }] },
    { on: "isDamaged", via: "effect", if: { "target.hasTempHp": false }, do: [{ type: "remove" }] }
  ],
  // Forme corrosive (pouding noir, MM 2024) : « une créature qui touche le pouding avec une attaque au corps à corps
  // en étant à 1,50 m ou moins subit 1d8 dégâts d'acide » — l'activité de dégâts du trait (OzlTY1z1gup4C2Qq), portée
  // par l'item du monstre lui-même. La corrosion des armes n'est pas reprise.
  "corrosive-form": [
    { on: "isHit", if: { "activity.isMelee": true, "target.within": { distance: 5, units: "ft" } }, do: [{ type: "damage", to: "source", activity: "OzlTY1z1gup4C2Qq" }] }
  ],
  "blindness-deafness": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Injonction (§16.59) : l'ordre vaut pour le prochain tour de la cible — l'effet tombe à la fin de ce tour.
  "command": [{ on: "endOfTurn", via: "effect", do: [{ type: "remove" }] }],
  // §19, sorts du PHB 2.2.0 lancés par des créatures d'un module tiers (valent pour tout le monde).
  // Couronne du dément : nouvelle sauvegarde en fin de chaque tour de la cible. (L'attaque imposée et le maintien par
  // une action Magie restent au MJ.)
  "crown-of-madness": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Causer la peur (Xanathar's, livré par un module de créatures tiers) : nouvelle sauvegarde en fin de chaque tour de la cible.
  "cause-fear": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Rayon affaiblissant : sur un échec, « Affaibli » (uaHZaHEalgWa6eoC : Désavantage aux tests de Force, -1d8 aux dégâts, dans
  // ses changements) et « la cible réitère le JS à la fin de chacun de ses tours » ; sur une réussite, « Désavantage à son
  // prochain jet d'attaque avant le début de votre prochain tour » (yril8uhQgO1dR507, posé par `savedEffects`, consommé).
  "ray-of-enfeeblement": [
    { on: "endOfTurn", via: "effect", fromEffect: "uaHZaHEalgWa6eoC", do: [{ type: "resave" }] },
    { on: "preAttackRoll", via: "effect", fromEffect: "yril8uhQgO1dR507", if: { "source.hasEffect": "ray-of-enfeeblement" },
      do: [{ type: "disadvantage" }, { type: "consume", side: "source" }] }
  ],
  // Flèche acide de Melf : « 2d4 dégâts d'acide à la fin de son prochain tour » — l'effet « Lingering Acid »
  // (NgglkyjzTbDh5Loa) posé au toucher, l'activité « Dégâts d'acide persistants » (uAyE5DrJp0YpElcw, au niveau de lancement).
  // (« Raté : la moitié des dégâts initiaux » n'est pas repris.)
  "melfs-acid-arrow": [{ on: "endOfTurn", via: "effect", fromEffect: "NgglkyjzTbDh5Loa",
    do: [{ type: "damage", to: "bearer", activity: "uAyE5DrJp0YpElcw" }, { type: "remove" }] }],
  // Sphère de vitriol : sur une sauvegarde ratée, 5d4 d'acide encore à la fin du tour suivant de la cible — l'effet
  // « Lingering Acid » (WHhf4PFHQBDkCAyb), l'activité « End of Turn Damage » (dnd5eactivity200), comme la Flèche acide.
  "vitriolic-sphere": [{ on: "endOfTurn", via: "effect", fromEffect: "WHhf4PFHQBDkCAyb",
    do: [{ type: "damage", to: "bearer", activity: "dnd5eactivity200" }, { type: "remove" }] }],
  // Mauvais œil, « Endormi » (5btX5iwwleMMzkvj) : « se réveille s'il subit des dégâts ». (Paniqué, Nauséeux : au MJ.)
  "eyebite": [{ on: "isDamaged", via: "effect", fromEffect: "5btX5iwwleMMzkvj", do: [{ type: "remove" }] }],
  // Absorption des éléments (Xanathar's, livré par un module de créatures tiers) : réaction à des dégâts d'acide, de froid,
  // de feu, de foudre ou de tonnerre.
  "absorb-elements": [{ on: "isDamaged", if: { "damage.hasType": ["acid", "cold", "fire", "lightning", "thunder"] }, do: [{ type: "use" }] }],

  // Avantage conditionnel (SPEC §16, B6). Lueurs féeriques : « les jets d'attaque contre une créature affectée
  // ont l'Avantage si l'assaillant voit la cible » — porté par l'effet « Nimbée » sur la cible.
  // Marque consommée (SPEC §16.12, B10) : Rayon traçant (PHB) — « la prochaine attaque contre elle avant la fin de votre
  // prochain tour a l'avantage » ; l'effet (Marqué, durée native) tombe au premier jet contre la cible.
  "guiding-bolt": [{
    on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "guiding-bolt" },
    do: [{ type: "advantage" }, { type: "consume", side: "target" }]
  }],
  // Moquerie cruelle (PHB) — « désavantage à sa prochaine attaque avant la fin de son prochain tour » ; l'effet « Mocked »
  // tombe à la première attaque de la créature.
  "vicious-mockery": [{
    on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "vicious-mockery" },
    do: [{ type: "disadvantage" }, { type: "consume", side: "source" }]
  }],
  // Voile défensif (§16.46) — « chaque fois qu'une créature effectue un jet d'attaque contre vous avant la fin du sort, elle en
  // soustrait 1d4 » : porté par la trace du sort sur le lanceur.
  "blade-ward": [{
    on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "blade-ward" },
    do: [{ type: "attackBonus", formula: "-1d4" }]
  }],
  "faerie-fire": [{
    on: "preAttackRoll", via: "effect",
    if: { "target.hasEffect": "faerie-fire", "source.seesTarget": true },
    do: [{ type: "advantage" }]
  }],
  // Tactique de meute (MM 2024, 18 créatures ; le Loup de la druide de la table) : un allié non Neutralisé à 5 ft de la cible.
  "pack-tactics": [{
    on: "preAttackRoll",
    if: { "source.allyNearTarget": { distance: 5, units: "ft" } },
    do: [{ type: "advantage" }]
  }],
  // Protection contre le mal et le bien : « les créatures de ces types ont le Désavantage aux jets d'attaque
  // contre la cible » — porté par l'effet sur la cible. (Charme, peur et possession : non jugés.)
  "protection-from-evil-and-good": [{
    on: "preAttackRoll", via: "effect",
    if: { "target.hasEffect": "protection-from-evil-and-good", "source.creatureType": ["aberration", "celestial", "elemental", "fey", "fiend", "undead"] },
    do: [{ type: "disadvantage" }]
  }],

  // Portes (SPEC §16, B5 bis). Contresort : « une créature en pleine incantation » — hostile, à 60 ft (portée de la
  // réaction), que l'on voit ; la réaction vise le lanceur, sa sauvegarde de Constitution décide.
  "counterspell": [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", target: "source" }] }],
  // Sanctuaire (module PHB) : l'attaquant du porteur de « Protégé » doit réussir la sauvegarde de Sagesse de la sœur
  // « Sauvegarde de la cible », ou perd son attaque. Sa fin (le porteur attaque, lance un sort, blesse) : `breaksOn`
  // (content/spells.mjs, §42.2).
  "sanctuary": [{ on: "isAttacked", via: "effect", if: { "target.hasEffect": "sanctuary" }, do: [{ type: "ward", activity: "6TdVnZPI3lxQrycI" }] }]
});
