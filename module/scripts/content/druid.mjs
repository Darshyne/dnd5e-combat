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
/** Attaque primitive, pas pour un druide qui a reçu l'option Incantation puissante (item du Manuel ; relevé des trous, 2026-10-22). */
const primalStrike = (formula, improved) => ({ on: "preDamageRoll", oncePerTurn: true,
  if: { all: [primalHit, { not: { "source.hasFeature": "elemental-fury-potent-spellcasting" } },
    improved ? { "source.hasFeature": "improved-elemental-fury" } : { not: { "source.hasFeature": "improved-elemental-fury" } }] },
  do: [{ type: "damage", formula, damageType: "fire" }] });

/**
 * Incantation puissante, l'autre option de Fureur élémentaire : « ajoutez votre modificateur de Sagesse aux dégâts de tout sort
 * mineur de Druide ». L'avancement du Druide ne donne que « Fureur élémentaire » (Attaques primitives par défaut) ; le Manuel a un item
 * par option (« Elemental Fury: Potent Spellcasting », `elemental-fury-potent-spellcasting`) : posé sur la fiche, il porte la règle et
 * retire l'Attaque primitive. Même règle pour le Clerc (relevé des trous, 2026-10-22 — avant, il fallait la surcouche du monde, et l'Attaque restait).
 */
export const potentSpellcasting = cls => ({ triggers: [{ on: "preDamageRoll", if: { "activity.cantripOf": cls },
  do: [{ type: "damage", formula: "@abilities.wis.mod", damageType: "weapon" }] }] });

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
  "elemental-fury-potent-spellcasting": potentSpellcasting("druid"),
  // §236 : Fureur élémentaire améliorée (niveau 15) — l'Attaque primitive passe à 2d8 (« elemental-fury ») ; Incantation puissante : « un
  // sort mineur de Druide d'une portée d'au moins 3 m porte 90 m plus loin » (adapter/turn.mjs, `rangeOf`).
  "improved-elemental-fury": { cantripRange: { class: "druid", add: { value: 300, units: "ft" }, requires: "elemental-fury-potent-spellcasting" } },
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
