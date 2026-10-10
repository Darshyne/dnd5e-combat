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
  "haste": { effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" }, effectEnds: { S5XcFawnnNHO8bUr: "bearerTurnEnd" } },
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
  "web": { difficultTerrain: { types: ["webs"] } },
  "grease": { difficultTerrain: {} },
  "sleet-storm": { difficultTerrain: {} },
  "evards-black-tentacles": { difficultTerrain: {} },
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
  "conjure-woodland-beings": {
    selfZone: { dnd5eactivity000: { type: "radius", size: 10, units: "ft" } },
    zoneAffects: "enemy",
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "UkXLSgFbCBI9CHMf" }] }]
  }
});
