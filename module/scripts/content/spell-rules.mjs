/**
 * Sorts du Manuel des joueurs 2024 à règles multiples (SPEC §37), une entrée complète par identifiant dnd5e, fusionnée par-dessus
 * les tables par brique comme les classes. Items `phbspl…` du pack `spells` du module premium `dnd-players-handbook` 2.2.0.
 */

/**
 * Malédiction (niveau 3, Clerc, Barde, Magicien…), `phbsplBestowCurs`. Quatre activités de sauvegarde de Sagesse, une par malédiction
 * (le lanceur la choisit en choisissant l'activité) ; la durée et la concentration sont celles des effets et du sort (dnd5e).
 *  - « Curse Ability » ne relie AUCUN des six effets « Cursed <caractéristique> » (Désavantage aux tests et sauvegardes, par
 *    `system.abilities.<x>.check|save.roll.mode`) : la réserve `choice.pool` les propose, le lanceur en choisit un. Défaut des
 *    données : « Cursed Wisdom » porte deux fois le Désavantage aux sauvegardes et pas celui aux tests.
 *  - « Cursed Attacks » (`u7Yc7mxHYPDvipS1`, sans changement) : « Désavantage aux jets d'attaque contre vous ».
 *  - « Cursed Actions » (`T3x6XvQbSkg6kW6u`) : « en combat, un jet de sauvegarde de Sagesse au début de chacun de ses tours, ou
 *    l'action Esquiver » — la sauvegarde de l'activité qui l'a posé ; réussie, la malédiction reste.
 *  - « Cursed Resilience » (`DRsQi8p3Zvhte2G0`) : « si vous lui infligez des dégâts par un jet d'attaque ou un sort, 1d8 dégâts
 *    nécrotiques de plus » — sur l'item du lanceur, comme Maléfice.
 */
const BESTOW_CURSE = {
  choice: {
    effects: "one",
    pool: { PYFPZ4aLWjKJ1tLZ: ["m5aRx9iXnJi2WWPU", "pG5HdDpW8VELR1O3", "BXWN6AGeNbxrRBUZ", "eA7PgIuucNGqZ1AS", "qLBTtRHOpGfv4IAb", "2Xjz5PKhyDferpZ7"] }
  },
  triggers: [
    { on: "preAttackRoll", via: "effect", fromEffect: "u7Yc7mxHYPDvipS1",
      if: { "source.hasEffectFromTarget": { item: "bestow-curse", effect: "u7Yc7mxHYPDvipS1" } }, do: [{ type: "disadvantage" }] },
    { on: "startOfTurn", via: "effect", fromEffect: "T3x6XvQbSkg6kW6u", do: [{ type: "resave", keep: true, onFail: "dodge" }] },
    { on: "preDamageRoll",
      if: { any: [{ "activity.isAttack": true }, { "activity.isSpell": true }], "target.hasEffectFrom": { item: "bestow-curse", effect: "DRsQi8p3Zvhte2G0" } },
      do: [{ type: "damage", formula: "1d8", damageType: "necrotic" }] }
  ]
};

export const SPELL_RULES = Object.freeze({
  // §43.1 : Pétrification — l'effet d'une sauvegarde réussie (Vitesse 0) tombe au début du prochain tour du lanceur.
  "flesh-to-stone": { effectEnds: { sFyjp6wt9bjyIl9W: "casterTurnStart" } },
  // §43.2 — une action met fin à l'effet.
  // Danse irrésistible d'Otto : « à chacun de ses tours, la cible peut prendre une action pour se ressaisir et réitérer la
  // sauvegarde » ; la danse d'une sauvegarde réussie cesse à la fin du prochain tour de la cible.
  "ottos-irresistible-dance": { actionEnds: { MpToumiJ2o3S16K7: { by: "bearer", roll: "save" } }, effectEnds: { UhFtBDEZEDpVgz9G: "bearerTurnEnd" } },
  // Forme gazeuse : « ou si elle prend une action Magie pour mettre fin au sort sur elle-même ».
  "gaseous-form": { actionEnds: { QeYsfnjEj2T9A3C8: { by: "bearer" } } },
  // Tremblement de terre, « Buried in Rubble » : « un test de Force (Athlétisme) DD 20 par une action pour s'en extraire ».
  // §91 : « à l'incantation et à la fin de chacun de vos tours, chaque créature au contact du sol de la zone fait un JS de Dextérité ;
  // en cas d'échec, À terre et sa Concentration rompue » — la sauvegarde de l'incantation rejouée à la fin des tours du lanceur, sur
  // les créatures au sol ; terrain difficile. Crevasses et structures : au MJ (activités de la donnée).
  "earthquake": {
    actionEnds: { "6UanNy7OTib1zFSq": { by: "bearer", roll: "check" } },
    casterPulse: { at: "turnEnd", ground: true, by: [{ from: 1, to: 10, activity: "Z1voDdIYLdJfGwMH" }] },
    difficultTerrain: {},
    triggers: [{ on: "failedSave", if: { "activity.id": "Z1voDdIYLdJfGwMH" }, do: [{ type: "status", status: "prone" }, { type: "breakConcentration" }] }]
  },
  // §91 : Boule de feu à retardement — « les dégâts augmentent de 1d6 chaque fois que votre tour prend fin tandis que le sort persiste » :
  // à la fin des tours du lanceur, « Augmenter les dégâts de fin de tour » est UTILISÉE (elle ajoute une utilisation au sort, que
  // l'explosion lit : 12d6 + (@item.uses.value)d6) ; « lorsque le sort prend fin, la bille explose » : la zone tombe, l'explosion
  // (sphère de 6 m) part de son centre. La bille touchée ou lancée : au MJ (« Bille touchée »).
  "delayed-blast-fireball": {
    casterPulse: { at: "turnEnd", by: [{ from: 1, to: 10, activity: "9i14Jmun9em69EnX", use: true }] },
    zoneEnd: { activity: "M15GlfjeWy7Cdiqn" }
  },
  // §91 : Tsunami — « au début de chacun de vos tours suivants, le mur s'éloigne de 15 m de vous ; les créatures dans l'espace où il
  // se déplace font un JS de Force ou 5d10 contondants » : la zone s'éloigne, « Effet de début du tour » paie une utilisation (le
  // compteur des rounds, que ses dés lisent : (@item.uses.value)d10) et rejoue sur ce qui est dedans ; plus d'utilisation, le sort
  // prend fin. Créatures emportées, nage, taille TG au plus : au MJ.
  "tsunami": {
    casterPulse: { at: "turnStart", away: { distance: 50, units: "ft" }, untilSpent: true, by: [{ from: 1, to: 6, activity: "o7MOuS6uL1ZV3dhe", pay: true }] }
  },
  // §91 : Interdiction — la barrière n'a pas de zone dans la donnée : un carré de 60 m (3 600 m²) fourni, posé à la souris ; « une
  // créature désignée qui entre dans la zone pour la première fois d'un tour ou y termine son tour subit 5d10 dégâts nécrotiques ou
  // radiants » — rejeu de « Dégâts créature interdite » ; désignées : les six types que le sort permet (le choix d'un sous-ensemble, le
  // type de dégâts — demandé au jet —, le mot de passe, le voyage planaire et la téléportation : au MJ).
  "forbiddance": {
    selfZone: { T2XK004SAb09LvvP: { type: "cube", size: 200, units: "ft" } },
    targets: { types: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"] },
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "9IBiOeIf2PC1wcLp" }] }]
  },
  // §91 : Tempête vengeresse — la pose (Constitution, 2d6 tonnerre, Assourdi) ; puis au début des tours suivants du lanceur, sur ce
  // qui est sous le nuage : tour 2 pluie acide (4d6), tour 3 six éclairs (Dextérité, 10d6 ; les ennemis d'abord), tour 4 grêle
  // (2d6), tours 5 à 10 bourrasque (1d6 froid). Terrain difficile, fortement obscurci ; « attaques à distance avec une arme
  // impossibles » : au MJ.
  "storm-of-vengeance": {
    casterPulse: { at: "turnStart", by: [
      { from: 1, activity: "WOo8u0FLAzNMpMJN" }, { from: 2, activity: "Fd8ZGgmDyNmJJuj3", max: 6 },
      { from: 3, activity: "H4uCtCkANBkttnov" }, { from: 4, to: 9, activity: "yt2oWWelZl1zV4CB" }] },
    difficultTerrain: {},
    obscures: true
  },
  // Secouer un dormeur : « quelqu'un prend une action pour la secouer » — Sommeil (à 1,50 m), Motif hypnotique, Mauvais œil
  // (« Asleep »), Symbole (« Sleeping »).
  "sleep": { actionEnds: { "04Wa4xUzjA31kPno": { by: "other", verb: "wake" } } },
  "hypnotic-pattern": { actionEnds: { mjAs8ssQlgp0AQOp: { by: "other", verb: "wake" } } },
  "eyebite": { actionEnds: { "5btX5iwwleMMzkvj": { by: "other", verb: "wake" } } },
  // §91 : Symbole, Discorde — « ses tests de caractéristique s'effectuent avec le Désavantage » (l'effet de la donnée est vide).
  "symbol": {
    actionEnds: { A1VA7t5gB7ODNsr6: { by: "other", verb: "wake" } },
    effectChanges: { YAwLt85sPQpUCIBI: ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.check.roll.mode`, type: "add", value: "-1" })) }
  },
  // Frappe piégeuse : la cible, ou toute créature qui l'atteint, peut dépenser une action en test de Force (Athlétisme) contre le
  // DD du lanceur — la cible passe par l'évasion d'une entrave (§16.54) ; ceci ouvre le test à une autre créature.
  // §81 : la sauvegarde du lancement (dnd5eactivity000) porte 1d6 perforants dans la donnée (PHB premium et SRD de dnd5e), que le
  // texte 2024 ne donne pas : les dégâts ne tombent qu'au début des tours de la cible entravée (« Start of Turn Damage », §80).
  "ensnaring-strike": { actionEnds: { tFGMG3cjQTEeAhv2: { by: "other", roll: "check" } }, noDamage: ["dnd5eactivity000"] },
  // Hâte (niveau 3), `phbsplHaste00000` : « quand le sort prend fin, la cible est Neutralisée et sa Vitesse est de 0 jusqu'à la fin
  // de son prochain tour » — l'effet « Lethargy » (S5XcFawnnNHO8bUr) posé quand « Hasted » (NEFWcyysYgsE6de3) cesse, d'où que
  // vienne la fin (durée, concentration rompue, dissipation) ; §42.2, runtime/endings.mjs.
  // §157 : « une action supplémentaire à chacun de ses tours, qui ne peut servir qu'à Attaquer (une seule attaque), Foncer, Se
  // désengager, Se cacher ou Utiliser » — `limitedAction` sur l'effet « Hasted ».
  "haste": { limitedAction: "NEFWcyysYgsE6de3", effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" }, effectEnds: { S5XcFawnnNHO8bUr: "bearerTurnEnd" } },
  "bestow-curse": BESTOW_CURSE,
  // Dissipation de la magie (niveau 3, Clerc, Druide…), `phbsplDispelMagi` : une activité utilitaire sans effet ; le moteur fait
  // cesser les sorts en cours sur les cibles désignées (§37.2, runtime/dispel.mjs).
  "dispel-magic": { dispel: true },
  // Silence (niveau 2, Clerc, Barde, Rôdeur), `phbsplSilence000` : « une créature entièrement dans la Sphère est immunisée contre les
  // dégâts de tonnerre et Assourdie ; on ne peut pas y lancer de sort à composante verbale » — l'effet « Silenced » de l'item (Assourdi,
  // `silenced` que la légalité lit déjà, §17 ; immunité au tonnerre), porté dans la zone (§37.4).
  "silence": { zoneEffects: true },
  // §69 : terrain difficile de la zone, perdu par les données du Manuel des joueurs premium (`behaviors` vide ; le SRD de dnd5e
  // l'a). Enchevêtrement (« le sol de la zone devient un Terrain difficile », plantes), Croissance d'épines (plantes), Toile
  // d'araignée (toiles), Graisse, Tempête de neige (« Terrain difficile »), Tentacules noirs d'Evard. Croissance végétale et Mur
  // d'épines (4 m de déplacement par mètre) ne sont pas du terrain difficile ordinaire : non repris.
  // §70 : Appel de la foudre — le nuage (cylindre de 18 m) reste ; chaque lancement vise un éclair de 1,50 m dessous ; « dehors, par
  // temps d'orage » : +1d10 (question à l'incantation). La relance sans emplacement (`recast`) et l'éclair (`bolt`) : content/bursts.mjs.
  "call-lightning": { storm: { bonus: "1d10" } },
  // §120 : Caresse du vampire (niveau 3) — « vous regagnez des PV égaux à la moitié des dégâts nécrotiques infligés » (runtime/lifesteal.mjs) ;
  // « tant que le sort dure, vous pouvez refaire l’attaque à chacun de vos tours par une action Magie » : la relance sans emplacement (content/bursts.mjs).
  "vampiric-touch": { lifesteal: { damageType: "necrotic", fraction: 0.5 } },
  // §73 : Protection contre la mort (niveau 4) — « la première fois que la cible devrait tomber à 0 PV, elle tombe à 1 PV, et le sort
  // prend fin » (adapter/ward.mjs). L'effet qui tuerait sur le coup sans dégâts : au MJ.
  "death-ward": { wardsAtZero: true },
  // §75 : Cordon de flèches — quatre projectiles, puis le sort prend fin (content/triggers.mjs).
  "cordon-of-arrows": { zoneCharges: 4 },
  // §71 : Dague des ombres (Familier de vampire, Monster Manual 2024, `mmUmbralDagger00`) — « si la cible tombe à 0 point de vie en
  // raison de cette attaque, elle se retrouve Stabilisée mais subit l'état Empoisonné pendant 1 heure ; tant qu'elle est Empoisonnée,
  // elle est Paralysée » : l'effet « Empoisonné et Paralysé » de l'item ne passe que si la cible est à 0 PV après les dégâts, et
  // elle est stabilisée (ni jet contre la mort ni mort, même un PNJ).
  "umbral-dagger": { stableAtZero: true, effectsIf: { "target.atZero": true } },
  "entangle": { difficultTerrain: { types: ["plants"] } },
  "spike-growth": { difficultTerrain: { types: ["plants"] } },
  // §158 (relevé des sorts, lot 2 : zones qui durent). Toile d'araignée : « … qui y entre pour la première fois d'un tour ou y
  // commence son tour fait un JS de Dextérité ; raté, Entravée tant qu'elle est dans la toile ou jusqu'à ce qu'elle se libère » ; « une
  // action pour un test de Force (Athlétisme) contre votre DD ». Les 2d4 de feu de la donnée sont ceux d'une toile qui brûle : pas
  // lancés au rejeu (la combustion reste au MJ). Zone légèrement obscurcie : non reprise.
  "web": {
    difficultTerrain: { types: ["webs"] },
    noDamage: ["dnd5eactivity000"],
    triggers: [{ on: ["enter", "turnStart"], do: [{ type: "replay" }] }, { on: "failedSave", do: [{ type: "status", status: "restrained" }] }],
    actionEnds: { "status:restrained": { by: "bearer", roll: "check" } }
  },
  // Graisse : « … qui y entre ou y termine son tour fait un JS de Dextérité ou a l'état À terre ».
  "grease": {
    difficultTerrain: {},
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }, { on: "failedSave", do: [{ type: "status", status: "prone" }] }]
  },
  "sleet-storm": { difficultTerrain: {} },
  // Tentacules noirs d'Evard : « … qui y entre pour la première fois d'un tour ou y termine son tour » rejoue la sauvegarde ; « une action
  // pour un test de Force (Athlétisme) contre votre DD » met fin à Entravé.
  "evards-black-tentacles": {
    difficultTerrain: {},
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],
    actionEnds: { NDytclFrNmC418CS: { by: "bearer", roll: "check" } }
  },
  // Brume mortelle, Nuage incendiaire : la sphère rejoue sa sauvegarde à l'entrée et en fin de tour, et « s'éloigne de 3 m de vous au
  // début de chacun de vos tours » (fortement obscurcie : content/bursts.mjs).
  "cloudkill": { triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }], casterPulse: { at: "turnStart", by: [], away: { distance: 10, units: "ft" } } },
  "incendiary-cloud": { triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }], casterPulse: { at: "turnStart", by: [], away: { distance: 10, units: "ft" } } },
  // Fléau d'insectes : rejeu à l'entrée et en fin de tour, terrain difficile (légèrement obscurci : non repris).
  "insect-plague": { difficultTerrain: {}, triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }] },
  // Barrière de lames : mur ou anneau, rejeu à l'entrée et en fin de tour, terrain difficile. (L'abri des trois quarts à travers le
  // mur : non repris.)
  // §172 : posée sur une rangée de cases ; « le mur offre un abri aux trois quarts ».
  "blade-barrier": { difficultTerrain: {}, cellWall: true, coverThrough: "threeQuarters", triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }] },
  // Tempête radieuse de Jallarzi : « tant qu'elle est dans le Cylindre, une créature est Aveuglée et Assourdie et ne peut lancer de
  // sort à composante verbale » — porté par la zone, pas par la sauvegarde ; dégâts à l'entrée et en fin de tour.
  "jallarzis-storm-of-radiance": { zoneEffects: true, triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }] },
  // Faim de Hadar : terrain difficile (Ténèbres : content/lights.mjs).
  "hunger-of-hadar": { difficultTerrain: {} },
  // Nuage nauséabond : « Empoisonnée jusqu'à la fin du tour en cours ; ainsi Empoisonnée, elle ne peut prendre ni action ni action
  // Bonus » (l'effet « Stinking Poison »).
  "stinking-cloud": { noActions: "gFid0DG5HydORpr3" },
  // §86 : Présence royale de Yolande — « Surround Self » (OJHRKWz8JvLzyl9R) n'a pas d'émanation dans la donnée : 10 ft sur soi,
  // posée d'office ; « une créature que vous voyez… vous pouvez la forcer » : les alliés épargnés. Qui y entre (ou que
  // l'émanation recouvre) ou y finit son tour : « Emanation Save » (dzeoGwKOPG7PHbyE, Sagesse, 4d6 psychiques), une fois par tour ;
  // ratée, À terre. « Vous pouvez la pousser de 3 m » : au MJ.
  "yolandes-regal-presence": {
    selfZone: { OJHRKWz8JvLzyl9R: { type: "radius", size: 10, units: "ft" } },
    zoneAffects: "enemy",
    triggers: [
      { on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dzeoGwKOPG7PHbyE" }] },
      { on: "failedSave", do: [{ type: "status", status: "prone" }] }
    ]
  },
  // §86 : Invocation d'êtres sylvestres — « Cast » (dnd5eactivity000, la sauvegarde de la pose) sans émanation dans la donnée :
  // 10 ft sur soi ; alliés épargnés ; entrée et fin de tour : « Emanation Save » (UkXLSgFbCBI9CHMf, Sagesse, 5d8 de force), une
  // fois par tour. (« Se désengager par une action Bonus » : l'activité « Disengage » de l'item.)
  // §157 (relevé des sorts, lot 1). Flou : l'effet « Blurred » (PsuBObX6WLcNEvUw, sans changement) n'est relié à aucune activité —
  // posé sur le lanceur ; « une créature dotée de vision aveugle ou de vision véritable n'est pas affectée ».
  "blur": {
    choice: { pool: { dnd5eactivity000: ["PsuBObX6WLcNEvUw"] } },
    triggers: [{ on: "preAttackRoll", via: "effect",
      if: { "target.hasEffect": "blur", not: { "source.hasSense": ["blindsight", "truesight"] } }, do: [{ type: "disadvantage" }] }]
  },
  // État cadavérique : l'effet « Cataleptic » (LEOWoE0nlVC8VRka : Aveuglé, Neutralisé, Vitesse 0, résistances) n'est relié à aucune
  // activité.
  "feign-death": { choice: { pool: { dnd5eactivity000: ["LEOWoE0nlVC8VRka"] } } },
  // Duel forcé : « Désavantage aux jets d'attaque contre toute créature autre que vous » — l'effet « Compelled » est vide. (La laisse
  // de 9 m et les fins du sort : au MJ.)
  "compelled-duel": {
    triggers: [{ on: "preAttackRoll", via: "effect",
      if: { "source.hasEffect": "compelled-duel", not: { "source.hasEffectFromTarget": "compelled-duel" } }, do: [{ type: "disadvantage" }] }]
  },
  // Châtiment de révélation : « les jets d'attaque contre elle ont l'Avantage » (effet posé par `smite.effect`, content/paladin.mjs).
  "shining-smite": {
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "shining-smite" }, do: [{ type: "advantage" }] }]
  },
  // Châtiment de tonnerre : « repoussée de 3 m et À terre » sur une sauvegarde ratée — À terre par l'effet de la donnée.
  "thunderous-smite": { triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }] },
  // Châtiment de stupeur : « Étourdie jusqu'à la fin de votre prochain tour » — la sauvegarde de la donnée ne pose rien.
  "staggering-smite": {
    triggers: [{ on: "failedSave", do: [{ type: "status", status: "stunned" }] }],
    effectEnds: { "status:stunned": "casterTurnEnd" }
  },
  // Métal brûlant : qui garde l'objet a « le Désavantage aux jets d'attaque et aux tests de caractéristique jusqu'au début de votre
  // prochain tour » — l'effet « Heated Metal » (VVQbCUE5W44bF4QU) est vide.
  "heat-metal": {
    effectChanges: { VVQbCUE5W44bF4QU: ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.check.roll.mode`, type: "add", value: "-1" })) },
    effectEnds: { VVQbCUE5W44bF4QU: "casterTurnStart" },
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "VVQbCUE5W44bF4QU", if: { "source.hasEffect": "heat-metal" }, do: [{ type: "disadvantage" }] }]
  },
  // Repli expéditif : « vous effectuez l'action Foncer, et jusqu'à la fin du sort vous pouvez la refaire par une action Bonus » —
  // l'utilisation prend Foncer ; la relancer pendant la concentration ne dépense pas d'emplacement.
  "expeditious-retreat": { basicActions: { dnd5eactivity000: "dash" }, recast: true },
  // Flèche acide de Melf : « sur un échec, la flèche éclabousse la cible d'acide pour la moitié des dégâts initiaux seulement ».
  "melfs-acid-arrow": { halfOnMiss: true },
  // Héroïsme : « au début de chacun de ses tours, elle gagne des PV temporaires égaux à votre modificateur de caractéristique
  // d'incantation » — l'activité de soin (PV temporaires) rejouée sur le porteur de « Bravery » (zCpsdUyNz8bL3LF5).
  "heroism": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "zCpsdUyNz8bL3LF5", do: [{ type: "damage", to: "bearer", activity: "dnd5eactivity000" }] }] },
  // Fracassement : « une Créature artificielle a le Désavantage au jet de sauvegarde ».
  "shatter": { saveDisadvantageFor: ["construct"] },
  // §159 : Aura de vie — « un allié à 0 PV qui commence son tour dans l'aura regagne 1 PV » ; Aura de pureté — « Avantage aux JS
  // pour éviter ou finir Aveuglé, Charmé, Assourdi, Effrayé, Paralysé, Empoisonné ou Étourdi » ; Cercle de pouvoir — « Avantage aux
  // JS contre les sorts et autres effets magiques » (« aucun dégât sur une réussite à moitié » : non repris). Portés par l'effet
  // de l'aura (content/auras.mjs).
  "aura-of-life": { triggers: [{ on: "startOfTurn", via: "effect", if: { "target.atZero": true }, do: [{ type: "damage", to: "bearer", formula: "1", damageType: "healing" }] }] },
  "aura-of-purity": { saveAdvantage: ["blinded", "charmed", "deafened", "frightened", "paralyzed", "poisoned", "stunned"] },
  "circle-of-power": { saveAdvantage: ["magic"] },
  // §160 (relevé des sorts, lot 4 : soins, états, seuils de PV). Guérison : « met fin à Aveuglé, Assourdi et Empoisonné » ; Guérison
  // de groupe : idem, sur chaque cible (la réserve de 700 PV à répartir : au MJ — chaque cible regagne jusqu'à 700) ; Mot de pouvoir
  // guérisseur : « Charmé, Effrayé, Paralysé, Empoisonné, Étourdi prennent fin » (se relever par sa Réaction : au joueur).
  "heal": { curesAll: ["blinded", "deafened", "poisoned"] },
  "mass-heal": { curesAll: ["blinded", "deafened", "poisoned"] },
  "power-word-heal": { curesAll: ["charmed", "frightened", "paralyzed", "poisoned", "stunned"] },
  // Délivrance des malédictions : « toutes les malédictions qui affectent une créature prennent fin » — celles des sorts.
  "remove-curse": { endsCurses: ["bestow-curse", "hex"] },
  // Régénération : « la cible regagne 1 PV au début de chacun de ses tours » (l'effet « Regenerating » est vide).
  "regenerate": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "O73gdwM6cCbr9LXn", do: [{ type: "damage", to: "bearer", formula: "1", damageType: "healing" }] }] },
  // Mot de pouvoir fortifiant : 120 PV temporaires répartis à parts égales entre les cibles (jusqu'à six).
  "power-word-fortify": { tempHpPool: 120 },
  // Résurrection, Résurrection suprême : « revient à la vie avec tous ses PV » (l'état Mort cesse : content/spells.mjs, `cures`).
  "resurrection": { revivesFull: true },
  "true-resurrection": { revivesFull: true },
  // Mot de pouvoir mortel : « 100 PV ou moins : elle meurt ; sinon, 12d12 dégâts psychiques ».
  "power-word-kill": { hpTiers: [{ atMost: 100, damage: false, statuses: ["dead"] }, {}] },
  // Mot de pouvoir étourdissant : « 150 PV ou moins : Étourdie ; sinon, Vitesse 0 jusqu'au début de votre prochain tour ». (La
  // sauvegarde de Constitution en fin de tour de l'Étourdie : la donnée n'a pas d'activité de sauvegarde — au MJ.)
  "power-word-stun": { hpTiers: [{ atMost: 150, effects: ["o7XJceFSBTiIIPFo"] }, { effects: ["B5dLPDfw1fDtfRW1"] }], effectEnds: { B5dLPDfw1fDtfRW1: "casterTurnStart" } },
  // Parole divine, sur une sauvegarde ratée : 20 PV ou moins, morte ; 30, Aveuglée, Assourdie, Étourdie ; 40, Aveuglée et Assourdie ;
  // 50, Assourdie ; au-delà, rien. Deux effets de la donnée n'ont pas leurs états. (Durées propres à chaque palier, bannissement des
  // Célestes, Élémentaires, Fées, Fiélons : au MJ.)
  "divine-word": {
    hpTiers: [{ atMost: 20, effects: [], statuses: ["dead"] }, { atMost: 30, effects: ["grWj3oo8iH8egvi1"] },
      { atMost: 40, effects: ["8O8KymREuOZFi45g"] }, { atMost: 50, effects: ["qZvAfjU2H6Fg6y6M"] }],
    effectStatuses: { "8O8KymREuOZFi45g": ["blinded", "deafened"], qZvAfjU2H6Fg6y6M: ["deafened"] }
  },
  // §161 (relevé des sorts, lot 5a). Détection de l'invisibilité : « vous voyez les créatures et objets Invisibles comme s'ils étaient
  // visibles » (le plan Éthéré : non repris).
  "see-invisibility": { seesInvisible: true },
  // Injonction (Compulsion) : « à la fin de chacun de ses tours, la cible refait le JS de Sagesse » (le déplacement dans la direction
  // choisie par une action Bonus : au MJ).
  "compulsion": { triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }] },
  // Télékinésie : sur un JS de Force raté, « … Entravée jusqu'à la fin de votre prochain tour » ; relancée par une action Magie pendant
  // la concentration, sans emplacement (le déplacement de 9 m dans la direction choisie : au MJ).
  "telekinesis": {
    recast: true,
    triggers: [{ on: "failedSave", do: [{ type: "status", status: "restrained" }] }],
    effectEnds: { "status:restrained": "casterTurnEnd" }
  },
  // Sphère résiliente d'Otiluke : « rien — objets physiques, énergie ou effets de sorts — ne la traverse » : la cible enfermée est
  // immunisée contre tous les dégâts (l'effet « Enclosed in Sphere » est vide). Qu'elle ne puisse rien atteindre dehors : au MJ.
  "otilukes-resilient-sphere": { effectChanges: { U5UciD171a5jcc7s: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"].map(t => ({ key: "system.traits.di.value", type: "add", value: t })) } },
  // Globe d'invulnérabilité : « un sort de niveau 5 ou moins lancé de l'extérieur ne peut affecter quoi que ce soit dans l'Émanation de
  // 3 m » (la montée d'emplacement du globe : non reprise).
  "globe-of-invulnerability": { globe: { radius: 10, units: "ft", maxLevel: 5 } },
  // Clignotement : 1d6 en fin de tour, 4–6 → Éthéré jusqu'au début du tour suivant (runtime/blink.mjs).
  "blink": { blink: "La5ofK0TnPSTL3iq" },
  // Invocation d'élémentaires mineurs : « tant que le sort dure, vos attaques infligent 2d8 dégâts de plus (acide, froid, feu ou foudre,
  // au choix) à une créature dans l'Émanation de 4,50 m » (le terrain difficile pour les ennemis : non repris).
  "conjure-minor-elementals": { triggers: [{ on: "preDamageRoll",
    if: { "activity.isAttack": true, "source.hasEffect": "conjure-minor-elementals", "target.within": { distance: 15, units: "ft" } },
    do: [{ type: "damage", formula: "2d8", damageType: ["acid", "cold", "fire", "lightning"] }] }] },
  // §162 : les murs se posent par points (ui/pointer.mjs, `aimWall`) et lèvent les murs du cœur qu'ils sont. Mur de force, Mur de glace,
  // Cage de force : rien ne les traverse (la vue, si : le Mur de force est invisible, la glace et la cage laissent voir) ; Mur de
  // pierre : ni le déplacement ni la vue ; Mur prismatique, Mur d'épines : la vue est arrêtée, on peut les traverser (et en subir les
  // effets). (Les sections de CA et de PV des murs de glace et de pierre, les créatures prises dans le mur : au MJ.)
  // §169 : « opaque » — des murs du cœur qui arrêtent la vue, pas le déplacement ; face brûlante à 3 m.
  "wall-of-fire": { walls: { move: false, sight: true }, wallSide: { distance: 10, units: "ft" } },
  // §173 : murs fins — posés sans diagonale, les créatures qui touchent le mur à l'apparition, un globe en anneau fin.
  "wall-of-force": { walls: {}, thinWall: true },
  "wall-of-ice": { walls: { activities: ["c4ttlpiIpyf3dFdf", "zjpb29Tww0iuv1P3"] }, thinWall: true },
  "forcecage": { walls: {} },
  "wall-of-stone": { walls: { sight: true }, thinWall: true },
  // §173 : la traversée — les sept couches d'un coup (une sauvegarde : simplification), l'aveuglement à 6 m, rien ne passe au travers ;
  // « vous et les créatures que vous désignez » : le lanceur et ses alliés épargnés.
  "prismatic-wall": { walls: { move: false, sight: true, activities: ["5f0JerdDSOQQXiTe", "fOYr1bgsB1VXROcm"] }, thinWall: true, zoneAffects: "enemy",
    coverThrough: "total", prismatic: { indigo: "CbAuJQPoOViKebWs", violet: "EIaFpuWAfQKSkFyp", all: true, activities: ["fxEIn0sNwZReZJhV"] },
    wallAura: { distance: 20, units: "ft", activity: "Pm0Re9Gt8pJNaF1C", on: ["enter", "turnStart"] },
    triggers: [{ on: ["enter"], do: [{ type: "replay", activity: "fxEIn0sNwZReZJhV" }] }] },
  // §173 : « les flèches, carreaux et autres projectiles ordinaires lancés sur des cibles derrière le mur […] ratent automatiquement ».
  "wind-wall": { thinWall: true, coverThrough: { degree: "total", against: "rangedWeapon" } },
  // §172 : posé sur une rangée de cases ; « pour chaque tranche de 30 cm parcourue dans le mur, il faut dépenser 1,20 m » : ×4.
  "wall-of-thorns": { walls: { move: false, sight: true }, cellWall: true, difficultTerrain: { cost: 4 } },
  // §163 : Champ antimagie — « les sorts n'affectent rien dans l'Émanation, et on n'y en lance pas » (la suspension des effets et objets
  // magiques déjà là, la téléportation : au MJ) ; Coquille antivie — « empêche les créatures autres que les Créatures artificielles et
  // les Morts-vivants d'y entrer ou d'atteindre à travers » (le sort qui prend fin quand le lanceur force une créature à la traverser : au MJ).
  // §164 (relevé des sorts, lot 5c). Esprits d'Invocation d'élémentaire (items de l'esprit invoqué) : « une créature Entravée refait la
  // sauvegarde au début de chacun de ses tours ; ratée, 4d8 ; réussie, elle se libère ». Le feu : son effet Entravé n'est relié à rien.
  "air-element": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "NGnrAr3HdReYoTjS", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "OeBjTLqhK4uDBBuD" }] }] },
  "earth-element": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "i5T6yzxlsSnXxGGa", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "BpPMuUAvi25WtIqp" }] }] },
  "fire-element": { choice: { pool: { kKPSUm9WDEDhhQtt: ["BWZxm9qxlXDSF6Dy"] } }, triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "BWZxm9qxlXDSF6Dy", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "5PCXGij7otAlYyL2" }] }] },
  "water-element": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "fwIobATMREr7g26x", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "K1lCqatPi2PsSDio" }] }] },
  // Invocation de céleste : le Cylindre rejoue, une fois par tour, quand une créature y entre ou y finit son tour — Lumière guérisseuse
  // pour un allié, Lumière brûlante pour un ennemi (déplaçable : content/movables.mjs).
  "conjure-celestial": { triggers: [
    { on: ["enter", "turnEnd"], if: { "target.allied": true }, do: [{ type: "replay", activity: "ke8eykrnAdAq5nfZ" }] },
    { on: ["enter", "turnEnd"], if: { "target.allied": false }, do: [{ type: "replay", activity: "naMU3mLP7jLZu1IG" }] }
  ] },
  // Vif carquois : « quand vous lancez le sort, et par une action Bonus à chacun de vos tours suivants, deux attaques avec une arme à
  // munitions » — deux attaques gratuites ouvertes (comme le Déluge de coups), la relance à l'action Bonus. (Seulement une arme à
  // munitions : au joueur.)
  "swift-quiver": { flurry: { activity: "DE7WqJFIWGteZ8xU", strikes: 2, weapons: true }, recast: true, recastCost: "bonus" },
  // Lévitation : la cible s'élève de 6 m, redescend quand le sort prend fin (se déplacer par une action Magie : au MJ).
  "levitate": { levitate: { effect: "axhLHcJQHprSpHRD", height: 20, units: "ft" } },
  // Inversion de la gravité : sur un échec, la créature tombe vers le haut, au sommet du Cylindre (30 m) ; le sort fini, elle chute.
  "reverse-gravity": { triggers: [{ on: "failedSave", do: [{ type: "lift", height: 100, units: "ft" }] }] },
  // Embruns prismatiques : un d8 par cible pour la couleur (la sauvegarde rejouée de l'indigo, la téléportation du violet : au MJ).
  "prismatic-spray": { prismatic: { indigo: "cCQh7iXKnT8PKmc1", violet: "jFAGct9YCYvLJodW" } },
  // Grêle d'épines : « immédiatement après avoir touché une créature avec une arme à distance » ; la cible et chaque créature à 1,50 m
  // d'elle font la sauvegarde.
  "hail-of-thorns": { smite: { save: "dnd5eactivity000", ranged: true, burst: { radius: 5, units: "ft" } } },
  "antimagic-field": { globe: { radius: 10, units: "ft", maxLevel: 9, everywhere: true } },
  "antilife-shell": { barrier: { radius: 10, units: "ft", exceptTypes: ["construct", "undead"] } },
  "arcane-gate": { pointWall: false },
  "gate": { pointWall: false },
  "demiplane": { pointWall: false },
  "mordenkainens-magnificent-mansion": { pointWall: false },
  "conjure-woodland-beings": {
    selfZone: { dnd5eactivity000: { type: "radius", size: 10, units: "ft" } },
    zoneAffects: "enemy",
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "UkXLSgFbCBI9CHMf" }] }]
  }
});
