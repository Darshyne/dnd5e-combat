/**
 * Le Druide du Manuel des joueurs 2024 (SPEC §30), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbdrd…`).
 * Déjà là : Forme sauvage (§19.x, runtime/wildshape.mjs), Compagnon sauvage, Regain sauvage.
 *
 * Ce que dnd5e fait déjà seul : Formes du cercle (transformation), Formes du cercle améliorées (sauvegardes de Constitution),
 * Protégé de dame Nature, Plénitude stellaire, Enfant de la tempête, Affinité aquatique (effets), Forme stellaire (Archer, Calice,
 * Dragon : activités et effets), Aval de la terre (sauvegarde et soin), Ressourcement, Archidruide.
 */

/** Attaques primitives : « un jet d'attaque avec une arme ou une attaque de Bête sous Forme sauvage ». */
const primalHit = { any: [{ "activity.isWeapon": true }, { "source.wildShaped": true, "activity.isAttack": true }] };
const primalStrike = (formula, improved) => ({ on: "preDamageRoll", oncePerTurn: true,
  if: { all: [primalHit, improved ? { "source.hasFeature": "improved-elemental-fury" } : { not: { "source.hasFeature": "improved-elemental-fury" } }] },
  do: [{ type: "damage", formula, damageType: "fire" }] });

/**
 * Incantation puissante, l'autre option de Fureur élémentaire : « ajoutez votre modificateur de Sagesse aux dégâts de tout sort
 * mineur de Druide ». Comme les Impacts bénis du Clerc (§27), la fiche ne dit pas l'option retenue : Attaques primitives par
 * défaut ; pour un druide à Incantation puissante, la surcouche du monde remplace les déclarations de l'item :
 *   game.modules.get("dnd5e-combat").api.content.set("elemental-fury", { triggers: DRUID_POTENT_SPELLCASTING })
 */
export const DRUID_POTENT_SPELLCASTING = Object.freeze([{ on: "preDamageRoll", if: { "activity.cantripOf": "druid" },
  do: [{ type: "damage", formula: "@abilities.wis.mod", damageType: "weapon" }] }]);

/** Courroux des mers (Mers 3) : sur une sauvegarde ratée, outre les dégâts de froid, une cible de taille G au plus est poussée de
 * 4,50 m en s'éloignant du druide. Enfant de la tempête (Mers 14) reprend la même sauvegarde (son activité). */
const seaPush = { triggers: [{ on: "failedSave", if: { "target.sizeAtMost": "lg" }, do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }] };

export const DRUID = Object.freeze({
  // Présage cosmique (Astres 6) : en Réaction, face au Test d20 d'une créature visible à 9 m ou moins, le druide lance un d6 et
  // le soustrait (Péril, contre le jet d'attaque d'un ennemi, §34) ou ajoutez-le (Fortune, au jet
  // d'attaque d'un allié, §36). La fiche ne garde pas le présage du jour (pair ou impair) : chaque fenêtre propose l'activité qui
  // lui convient, au joueur de ne prendre que la sienne. Les tests autres qu'une attaque restent au joueur.
  "cosmic-omen": { triggers: [
    { on: "enemyAttacks", if: { "source.nearSelf": { distance: 30, units: "ft" }, "self.seesSource": true },
      do: [{ type: "use", activity: "RUVw6UxNL4FIdDrJ" }, { type: "penalty", formula: "1d6" }] },
    { on: "allyAttacks", if: { "source.nearSelf": { distance: 30, units: "ft" }, "self.seesSource": true },
      do: [{ type: "use", activity: "nu3AqVu9lyqeFwr3" }, { type: "bonus", formula: "1d6" }] }
  ] },
  "wrath-of-the-sea": seaPush,
  "stormborn": seaPush,
  // Fureur élémentaire (niveau 7), option Attaques primitives : « une fois à chacun de vos tours, 1d8 dégâts de feu, de foudre, de
  // froid ou de tonnerre » — feu d'office (le choix n'est pas demandé) ; 2d8 avec Fureur élémentaire améliorée (niveau 15).
  "elemental-fury": { triggers: [primalStrike("1d8", false), primalStrike("2d8", true)] },
  // Forme lunaire (Lune 10), Radiance lunaire améliorée : un coup porté sous Forme sauvage ajoute 2d10 radiants, au plus une
  // fois par tour.
  "lunar-form": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "source.wildShaped": true, "activity.isAttack": true },
    do: [{ type: "damage", formula: "2d10", damageType: "radiant" }] }] },
  // Foulée sélène (Lune 6) : téléportation de 9 m au plus, puis Avantage à la prochaine attaque du druide dans ce même tour —
  // la destination se choisit aussitôt (§16.10) ; la trace posée sur le druide porte l'Avantage, consommé.
  "moonlight-step": {
    teleport: { distance: 30, units: "ft", activity: "dnd5eactivity000" },
    // L'effet de l'item (« suivre l'Avantage ») est désactivé et l'activité vise une case : le moteur pose sa trace sur le druide,
    // comme la Visée stable (§20).
    trace: { activity: "dnd5eactivity000", show: true },
    triggers: [
      { on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "moonlight-step" }, do: [{ type: "advantage" }, { type: "consume", side: "source" }] },
      { on: "endOfTurn", via: "effect", do: [{ type: "remove" }] }   // « avant la fin de ce tour », comme Visée stable (§20)
    ]
  }
});
