/**
 * Le Roublard du Manuel des joueurs 2024 (SPEC §20), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbrge…`). Ids d'activités et d'effets relevés dans ce pack ; identifiants dnd5e gardés par les copies sur les fiches.
 *
 * Ce que dnd5e fait déjà seul : Expertise, Talent fiable (effet : 10 au minimum aux tests de compétence maîtrisés), Esprit
 * fuyant (maîtrises de sauvegarde), Bottes d'arme ; Assassinat : l'Avantage à l'Initiative (effet de l'item).
 */

/** Frappes rusées (niveau 5) : Poison (trousse d'empoisonneur), Croc-en-jambe (G ou moins), Repli — 1d6 chacune. */
const CUNNING_STRIKES = Object.freeze({
  poison: { cost: 1, activity: "n64fvJMT9fPUy7DH", requires: "poisoners-kit" },
  trip: { cost: 1, activity: "dWcCw1vTWRMx4YzD", sizeAtMost: "lg" },
  withdraw: { cost: 1, withdraw: true }
});

/** Frappes sournoises (niveau 14) : Hébétement (2d6), Assommer (6d6), Aveugler (3d6). */
const DEVIOUS_STRIKES = Object.freeze({
  daze: { cost: 2, activity: "4TnBjQTJzt9UjUos" },
  knockOut: { cost: 6, activity: "3eq7lcmpkJJBU2KO" },
  obscure: { cost: 3, activity: "ki4lIPVGNA0HjEzH" }
});

export const ROGUE = Object.freeze({
  // Attaque sournoise : les dés de l'item (`@scale.rogue.sneak-attack`), une fois par tour (core/sneak.mjs).
  "sneak-attack": { sneakAttack: true },

  // Ruse (niveau 2) : « à votre tour, vous pouvez effectuer l'une des actions suivantes par une action Bonus : Foncer, Se
  // désengager ou Se cacher ». Les trois activités de l'item coûtent déjà l'action Bonus ; le moteur y pose l'état du tour (Foncer,
  // Se désengager) ou fait le test de Discrétion de Se cacher (runtime/hide.mjs) — l'effet « Hiding » de l'item n'est pas posé.
  "cunning-action": { basicActions: { NtS3iThuWWwm8O62: "dash", AeCciDTvw3kS583a: "disengage", NiI5qEhg9TepZxMh: "hide" } },

  // Visée stable (niveau 3) : action Bonus qui donne l'Avantage à la prochaine attaque du tour ; seulement si le roublard n'a pas
  // encore bougé ce tour-ci, et sa Vitesse tombe à 0 jusqu'à la fin du tour. La trace de l'item porte l'Avantage, consommé au premier jet d'attaque, retiré à la fin du tour.
  "steady-aim": {
    usageLimits: { VGVYnecMRcu0f5Sq: { unmoved: true } },
    holdsStill: true,
    trace: { activity: "VGVYnecMRcu0f5Sq", show: true },
    triggers: [
      { on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "steady-aim" }, do: [{ type: "advantage" }, { type: "consume", side: "source" }] },
      { on: "endOfTurn", via: "effect", do: [{ type: "remove" }] }
    ]
  },

  // Frappes rusées : l'auteur les choisit avant ses dégâts ; Poison se rejoue à la fin de chaque tour de la cible.
  "cunning-strike": {
    cunningStrikes: CUNNING_STRIKES,
    triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "RazTM6biKVtNtjEW", do: [{ type: "resave" }] }]
  },
  // Frappe rusée améliorée (niveau 11) : « jusqu'à deux effets de Frappe rusée ».
  "improved-cunning-strike": { cunningStrikeMax: 2 },
  // Frappes sournoises (niveau 14). Assommer : « Inconscient pendant 1 minute ou jusqu'à ce qu'elle subisse des dégâts ; elle
  // réitère le JS à la fin de chacun de ses tours ». Hébétement : l'effet de l'item ne fait que le montrer (au MJ).
  "devious-strikes": {
    cunningStrikes: DEVIOUS_STRIKES,
    triggers: [
      { on: "endOfTurn", via: "effect", fromEffect: "C2IGgt4PnRMxZVey", do: [{ type: "resave" }] },
      { on: "isDamaged", via: "effect", fromEffect: "C2IGgt4PnRMxZVey", do: [{ type: "remove" }] }
    ]
  },

  // Dérobade (niveau 7) et Insaisissable (niveau 18).
  "evasion": { evasion: true },
  "elusive": { elusive: true },

  // Assassin (niveau 3), Assassinat : au premier round d'un combat, Avantage contre qui n'a pas encore agi ; une Attaque sournoise
  // réussie pendant ce round ajoute autant de dégâts (type de l'arme) que le niveau de Roublard.
  "assassinate": {
    sneakBonus: { formula: "@classes.rogue.levels", firstRound: true },
    triggers: [{ on: "preAttackRoll", if: { "target.hasNotActed": true }, do: [{ type: "advantage" }] }]
  }
});
