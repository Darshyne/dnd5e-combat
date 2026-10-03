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

export const RANGER = Object.freeze({
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

  // Embuscade effrayante (Traqueur des ténèbres 3), Frappe effroyable : un coup d'arme ajoute 2d6 psychiques, au plus une fois
  // par tour (2d8 avec Rafale du traqueur : l'échelle de la sous-classe).
  "dread-ambusher": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isWeapon": true },
    do: [{ type: "damage", formula: "@scale.gloom.dreadful-strike", damageType: "psychic" }] }] },
  // Frappes effroyables (Vagabond féerique 3) : un coup d'arme ajoute 1d4 psychiques, limité à une fois par tour et par cible,
  // 1d6 au niveau 11 — le moteur les limite à une fois par tour.
  "dreadful-strikes": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isWeapon": true },
    do: [{ type: "damage", formula: "@scale.fey.dreadful-strike", damageType: "psychic" }] }] }
});
