/**
 * Le Rôdeur du Manuel des joueurs 2024 (SPEC §26), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbrgr…`),
 * et la Marque du chasseur (pack `spells`), que d'autres classes peuvent aussi lancer.
 *
 * Ce que dnd5e fait déjà seul : Ennemi juré (Marque du chasseur lancée sans emplacement, utilisations de l'item), Infatigable (PV
 * temporaires), Voile de la nature (effet Invisible), Arpenteur, Sens sauvages, Vision ombreuse, Mental d'acier, Séduction mystique
 * (effets), Vagabond des brumes et Renforts féeriques (utilisations), le Compagnon primitif (convocation).
 */

/** « Quand vous touchez la créature marquée avec un jet d'attaque ». */
const marked = { "activity.isAttack": true, "target.hasEffectFrom": "hunters-mark" };

/** Vagabondage : les trois changements de l'effet de la donnée. */
const ROVING = {
  bonus: { key: "system.attributes.movement.bonus", value: 10, type: "add" },
  climb: { key: "system.attributes.movement.speeds.climb", value: "@attributes.movement.speed", type: "upgrade" },
  swim: { key: "system.attributes.movement.speeds.swim", value: "@attributes.movement.speed", type: "upgrade" }
};

export const RANGER = Object.freeze({
  // Voile de la nature (niveau 14) — « par une action Bonus, vous vous donnez l'état Invisible jusqu'à la fin de votre prochain
  // tour » : l'effet de l'item n'a pas de durée dans la donnée et ne cessait jamais.
  "natures-veil": { effectEnds: { NOSQczI2MCQ5Ha8F: "casterTurnEnd" } },
  // Chasseur implacable (niveau 13) : « subir des dégâts ne peut pas rompre votre concentration sur la Marque du chasseur ».
  // Vagabondage (SRD 5.2) : « votre Vitesse augmente de 3 m tant que vous ne portez pas d'armure lourde. Vous avez aussi une
  // Vitesse d'escalade et de nage égales à votre Vitesse ». La donnée met les trois dans un seul effet sans condition : l'escalade
  // et la nage passent dans un effet à part, qui reste, et le +3 m suit l'armure.
  "roving": {
    dataFixes: [
      { effect: "dasRovingSpeeds0", create: { name: "Roving: Climb and Swim", type: "base", transfer: true, disabled: false,
        system: { changes: [ROVING.climb, ROVING.swim] } } },
      { effect: "J9RWCSmYGnP0fkn1", path: "system.changes", from: [ROVING.bonus, ROVING.climb, ROVING.swim], value: [ROVING.bonus] }
    ],
    effectWhile: { J9RWCSmYGnP0fkn1: { if: { notArmor: ["heavy"] } } }
  },
  "relentless-hunter": { keepsConcentration: ["hunters-mark"] },
  // Esquive des ombres (Traqueur des ténèbres 11) : en Réaction, le rôdeur donne le Désavantage à un jet d'attaque qui le vise
  // (§34 : fenêtre avant le jet) ; la téléportation de 9 m qui suit reste au joueur.
  "shadowy-dodge": { triggers: [{ on: "isAttacked", do: [{ type: "use", activity: "0DMuCuULnpS5lIR5" }, { type: "disadvantage" }] }] },
  // Marque du chasseur : « 1d6 dégâts de force supplémentaires chaque fois que vous touchez la cible avec un jet d'attaque » —
  // 1d10 avec Tueur implacable (niveau 20), déclaré sur son item.
  "hunters-mark": { triggers: [{ on: "preDamageRoll", if: { ...marked, not: { "source.hasFeature": "foe-slayer" } },
    do: [{ type: "damage", formula: "1d6", damageType: "force" }] }] },
  "foe-slayer": { triggers: [{ on: "preDamageRoll", if: marked, do: [{ type: "damage", formula: "1d10", damageType: "force" }] }] },
  // Chasseur précis (niveau 17) : « l'Avantage à vos jets d'attaque contre la créature affectée par votre Marque du chasseur ».
  "precise-hunter": { triggers: [{ on: "preAttackRoll", if: { "target.hasEffectFrom": "hunters-mark" }, do: [{ type: "advantage" }] }] },

  // Proie du chasseur (Chasseur 3), option Tueur de colosses — celle dont l'item porte l'activité : « une fois par tour, quand vous
  // touchez une créature avec une arme et qu'il lui manque des points de vie, 1d8 dégâts supplémentaires », du type de l'arme.
  // L'autre option (Briseur de hordes, une attaque de plus) reste au joueur : rien dans les données ne dit laquelle est retenue.
  "hunters-prey": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isWeapon": true, "target.wounded": true },
    do: [{ type: "damage", formula: "1d8", damageType: "weapon" }] }] },

  // C12-e : Tactiques défensives (Chasseur 7), option Défense multiattaque — celle dont l'item porte l'activité : « quand une créature
  // vous touche avec un jet d'attaque, elle a le Désavantage à tous ses autres jets d'attaque contre vous pendant ce tour ». (Cauchemar
  // de la horde, l'autre option, reste au joueur : rien dans les données ne dit laquelle est retenue.)
  "defensive-tactics": { hitDefense: true },

  // Embuscade effrayante (Traqueur des ténèbres 3), Frappe effroyable : « vous pouvez » ajouter 2d6 psychiques à un coup d'arme, au
  // plus une fois par tour (2d8 avec Rafale du traqueur : l'échelle de la sous-classe), autant de fois que le modificateur de Sagesse
  // par repos long — §223 (#12) : proposée avant le jet de dégâts, une utilisation de l'activité dépensée.
  // §438 : Manuel 3.0.0 — deux activités, « (2d6) » jusqu'au niveau 10, « (2d8) » ensuite, qui consomment les utilisations de l'item
  // (et non plus les leurs) : la visible à ce niveau compte (adapter/uses.mjs).
  "dread-ambusher": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, ask: { uses: ["DMVf7FTyTC2HCAf9", "NGiX54LWGJGvMMwL"] }, if: { "activity.isWeapon": true },
    do: [{ type: "damage", formula: "2d(6 + 2 * min(1, floor(@classes.ranger.levels / 11)))", damageType: "psychic" }] }] },
  // Frappes effroyables (Vagabond féerique 3) : un coup d'arme ajoute 1d4 psychiques, limité à une fois par tour et par cible,
  // 1d6 au niveau 11 — le moteur les limite à une fois par tour.
  "dreadful-strikes": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isWeapon": true },
    do: [{ type: "damage", formula: "1d(4 + 2 * min(1, floor(@classes.ranger.levels / 11)))", damageType: "psychic" }] }] }
});
