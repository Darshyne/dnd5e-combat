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
  "earthquake": { actionEnds: { "6UanNy7OTib1zFSq": { by: "bearer", roll: "check" } } },
  // Secouer un dormeur : « quelqu'un prend une action pour la secouer » — Sommeil (à 1,50 m), Motif hypnotique, Mauvais œil
  // (« Asleep »), Symbole (« Sleeping »).
  "sleep": { actionEnds: { "04Wa4xUzjA31kPno": { by: "other", verb: "wake" } } },
  "hypnotic-pattern": { actionEnds: { mjAs8ssQlgp0AQOp: { by: "other", verb: "wake" } } },
  "eyebite": { actionEnds: { "5btX5iwwleMMzkvj": { by: "other", verb: "wake" } } },
  "symbol": { actionEnds: { A1VA7t5gB7ODNsr6: { by: "other", verb: "wake" } } },
  // Frappe piégeuse : la cible, ou toute créature qui l'atteint, peut dépenser une action en test de Force (Athlétisme) contre le
  // DD du lanceur — la cible passe par l'évasion d'une entrave (§16.54) ; ceci ouvre le test à une autre créature.
  "ensnaring-strike": { actionEnds: { tFGMG3cjQTEeAhv2: { by: "other", roll: "check" } } },
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
  "evards-black-tentacles": { difficultTerrain: {} }
});
