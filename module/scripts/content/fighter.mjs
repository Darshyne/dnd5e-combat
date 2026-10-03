/**
 * Le Guerrier du Manuel des joueurs 2024 (SPEC §21), module premium `dnd-players-handbook` 2.2.0 (packs `classes`, items
 * `phbftr…`, et `feats` pour les styles de combat). Vocabulaire du PHB-fr : Fougue, Second souffle, Décalage tactique, Attaques
 * avisées, Héros du champ d'honneur, styles Armes à deux mains et Armes de jet.
 *
 * Ce que dnd5e fait déjà seul : Second souffle (soin 1d10 + niveau, action Bonus), Attaque supplémentaire (le budget du moteur
 * compte les attaques : adapter/turn.mjs, `attacksPerAction`), Critique amélioré (seuil 19, effet de l'item), styles Archerie,
 * Défense, Duel, Combat en aveugle (effets). Les bottes d'arme : runtime/mastery.mjs.
 */

export const FIGHTER = Object.freeze({
  // Fougue : « à votre tour, vous pouvez effectuer une action supplémentaire, hors action Magie » ; au niveau 17, deux utilisations
  // mais une seule par tour. L'activité (activation « spéciale ») ne coûte rien au budget ; le moteur y ajoute l'action.
  "action-surge": { grantsAction: true, usageLimits: { jtpVG47zPBUI0CZ5: { oncePerTurn: true } } },
  // Décalage tactique (niveau 5) : « chaque fois que vous activez Second souffle par une action Bonus, vous pouvez vous déplacer
  // jusqu'à la moitié de votre Vitesse sans provoquer d'attaque d'opportunité ».
  "tactical-shift": { movesAfter: "second-wind" },
  // Attaques avisées (niveau 13) : « si vous ratez une créature d'un jet d'attaque, vous avez l'Avantage à votre prochain jet
  // d'attaque contre elle avant la fin de votre prochain tour » — une marque, comme l'Ouverture (runtime/mastery.mjs).
  "studied-attacks": { studiedAttacks: true },
  // Héros du champ d'honneur (Champion 10) : « en combat, vous pouvez vous donner l'Inspiration héroïque chaque fois que vous
  // commencez votre tour sans elle ».
  "heroic-warrior": { heroicWarrior: true },
  // Style Armes à deux mains : « quand vous lancez les dégâts d'une attaque avec une arme de corps à corps tenue à deux mains, vous
  // pouvez considérer tout 1 ou 2 sur un dé de dégâts comme un 3 — l'arme doit avoir la propriété Deux mains ou Polyvalente ».
  "great-weapon-fighting": { greatWeaponFighting: true },
  // Style Armes de jet : +2 aux dégâts d'un coup à distance porté avec une arme de Lancer.
  "thrown-weapon-fighting": { thrownDamage: 2 }
});
